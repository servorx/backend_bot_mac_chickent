import type { Prisma } from "@prisma/client";

import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { publish } from "../../realtime/events.js";
import { sendBotMessage, upsertBotDeliveryZonePrice } from "../conversations/botClient.js";
import type { createOrderSchema, updateDeliverySchema, updateStatusSchema } from "./orderSchemas.js";
import type { z } from "zod";

type CreateOrderInput = z.infer<typeof createOrderSchema>;
type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
type UpdateDeliveryInput = z.infer<typeof updateDeliverySchema>;
export type DailyProductReport = {
  date: string;
  generatedAt: string;
  items: {
    productCode: string | null;
    productName: string;
    quantity: number;
    totalCop: number;
  }[];
  totalQuantity: number;
  totalCop: number;
};

const orderInclude = {
  items: true,
} satisfies Prisma.OrderInclude;

export async function listOrders(kind: string) {
  const where = kindToWhere(kind);
  return prisma.order.findMany({
    where,
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getOrderById(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });

  if (!order) {
    throw new ApiError(404, "order_not_found", "Order not found");
  }

  return order;
}

export async function getOrderByExternalBotId(externalBotId: string) {
  const order = await prisma.order.findUnique({
    where: { externalBotId },
    include: orderInclude,
  });

  if (!order) {
    throw new ApiError(404, "order_not_found", "Order not found");
  }

  return order;
}

export async function createOrder(input: CreateOrderInput) {
  if (input.externalBotId) {
    const existing = await prisma.order.findFirst({
      where: { externalBotId: input.externalBotId },
      include: orderInclude,
    });
    if (existing) {
      return existing;
    }
  }

  const subtotalCop = input.items.reduce(
    (total, item) => total + item.quantity * item.unitPriceCop,
    0,
  );
  const totalCop = subtotalCop + input.deliveryFeeCop;

  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      const previousOrder = await tx.order.findFirst({
        where: { chatId: input.chatId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      const customer = await tx.customer.upsert({
        where: { phone: input.customer.phone },
        update: {
          fullName: input.customer.fullName,
          address: input.customer.address,
        },
        create: {
          fullName: input.customer.fullName,
          phone: input.customer.phone,
          address: input.customer.address,
        },
      });

      const created = await tx.order.create({
        data: {
          orderNumber: await nextOrderNumber(tx),
          invoiceNumber: await nextInvoiceNumber(tx),
          externalBotId: input.externalBotId,
          chatId: input.chatId,
          fulfillmentType: input.fulfillmentType,
          customerId: customer.id,
          customerName: customer.fullName,
          customerPhone: customer.phone,
          customerAddress: customer.address,
          paymentMethod: input.paymentMethod,
          observations: input.observations,
          subtotalCop,
          deliveryFeeCop: input.deliveryFeeCop,
          totalCop,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              productCode: item.productCode,
              productName: item.productName,
              quantity: item.quantity,
              unitPriceCop: item.unitPriceCop,
              subtotalCop: item.quantity * item.unitPriceCop,
              notes: item.notes,
            })),
          },
        },
        include: orderInclude,
      });

      if (input.inboundMessage) {
        await tx.conversationMessage.create({
          data: {
            orderId: created.id,
            customerId: customer.id,
            chatId: input.chatId,
            direction: "INBOUND",
            sender: "CUSTOMER",
            body: input.inboundMessage,
          },
        });
      }

      await tx.conversationMessage.updateMany({
        where: {
          chatId: input.chatId,
          orderId: null,
          ...(previousOrder ? { sentAt: { gt: previousOrder.createdAt } } : {}),
        },
        data: {
          orderId: created.id,
          customerId: customer.id,
        },
      });

      await tx.auditLog.create({
        data: {
          orderId: created.id,
          actor: "bot",
          action: "order.created",
          metadata: { externalBotId: input.externalBotId ?? null },
        },
      });

      return created;
    });
  } catch (error) {
    if (input.externalBotId && isUniqueExternalBotIdError(error)) {
      const existing = await prisma.order.findFirst({
        where: { externalBotId: input.externalBotId },
        include: orderInclude,
      });
      if (existing) {
        return existing;
      }
    }
    throw error;
  }

  publish({
    type: "orders.created",
    orderId: order.id,
    status: order.status,
    fulfillmentType: order.fulfillmentType,
  });
  publish({ type: "orders.changed", orderId: order.id });
  publish({ type: "conversations.changed", chatId: input.chatId, orderId: order.id });
  return order;
}

export async function updateOrderStatus(id: string, input: UpdateStatusInput, actor = "admin") {
  const existing = await getOrderById(id);
  if (existing.status === input.status) {
    return existing;
  }
  const allowedNextStatuses: Record<string, string[]> = {
    CONFIRMED: ["PREPARING", "CANCELLED"],
    PREPARING: ["DELIVERED", "CANCELLED"],
    DELIVERED: [],
    CANCELLED: [],
  };
  if (!allowedNextStatuses[existing.status]?.includes(input.status)) {
    throw new ApiError(
      409,
      "invalid_order_status_transition",
      `Cannot move order from ${existing.status} to ${input.status}`,
    );
  }

  const order = await prisma.order.update({
    where: { id },
    data: {
      status: input.status,
      preparingAt: input.status === "PREPARING" ? new Date() : existing.preparingAt,
      deliveredAt: input.status === "DELIVERED" ? new Date() : existing.deliveredAt,
      cancelledAt: input.status === "CANCELLED" ? new Date() : existing.cancelledAt,
      cancellationReason: input.status === "CANCELLED" ? input.reason ?? "Cancelado por administrador" : null,
      auditLogs: {
        create: {
          actor,
          action: "order.status_updated",
          metadata: { from: existing.status, to: input.status, reason: input.reason ?? null },
        },
      },
    },
    include: orderInclude,
  });

  publish({ type: "orders.changed", orderId: order.id });
  return order;
}

export async function updateOrderStatusByExternalBotId(
  externalBotId: string,
  input: UpdateStatusInput,
  actor = "bot",
) {
  const order = await getOrderByExternalBotId(externalBotId);
  return updateOrderStatus(order.id, input, actor);
}

export async function updateOrderDelivery(id: string, input: UpdateDeliveryInput) {
  const existing = await getOrderById(id);
  if (existing.fulfillmentType !== "DELIVERY") {
    throw new ApiError(409, "pickup_order_has_no_delivery", "Pickup orders do not have delivery");
  }

  const totalCop = existing.subtotalCop + input.deliveryFeeCop;
  const messageBody = buildDeliveryCorrectionMessage({
    orderNumber: existing.orderNumber,
    customerAddress: input.customerAddress,
    items: existing.items,
    subtotalCop: existing.subtotalCop,
    deliveryFeeCop: input.deliveryFeeCop,
    totalCop,
  });
  const order = await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: existing.customerId },
      data: { address: input.customerAddress },
    });

    const updated = await tx.order.update({
      where: { id },
      data: {
        customerAddress: input.customerAddress,
        deliveryFeeCop: input.deliveryFeeCop,
        totalCop,
        auditLogs: {
          create: {
            actor: "admin",
            action: "order.delivery_updated",
            metadata: {
              previousAddress: existing.customerAddress,
              nextAddress: input.customerAddress,
              previousDeliveryFeeCop: existing.deliveryFeeCop,
              nextDeliveryFeeCop: input.deliveryFeeCop,
              previousTotalCop: existing.totalCop,
              nextTotalCop: totalCop,
              deliveryZone: input.deliveryZone ?? null,
            },
          },
        },
      },
      include: orderInclude,
    });

    if (existing.chatId) {
      await tx.conversationMessage.create({
        data: {
          orderId: existing.id,
          customerId: existing.customerId,
          chatId: existing.chatId,
          direction: "OUTBOUND",
          sender: "ADMIN",
          body: messageBody,
        },
      });
    }

    return updated;
  });

  let messageDelivered = false;
  if (existing.chatId) {
    try {
      await sendBotMessage({ chatId: existing.chatId, body: messageBody });
      await prisma.conversationControl.upsert({
        where: { chatId: existing.chatId },
        update: { aiEnabled: true, pausedUntil: null },
        create: { chatId: existing.chatId, aiEnabled: true, pausedUntil: null },
      });
      messageDelivered = true;
    } catch (error) {
      console.error(error);
    }
  }

  let deliveryZoneSaved = false;
  const deliveryZone = (input.deliveryZone || inferDeliveryZone(input.customerAddress)).trim();
  if (deliveryZone) {
    try {
      await upsertBotDeliveryZonePrice({
        neighborhood: deliveryZone,
        deliveryPriceCop: input.deliveryFeeCop,
      });
      deliveryZoneSaved = true;
    } catch (error) {
      console.error(error);
    }
  }

  publish({ type: "orders.changed", orderId: order.id });
  if (existing.chatId) {
    publish({ type: "conversations.changed", chatId: existing.chatId, orderId: order.id });
  }
  return { order, messageDelivered, deliveryZoneSaved };
}

export async function getDailyProductReport(date = todayInColombia()): Promise<DailyProductReport> {
  const { start, end } = bogotaDayBounds(date);
  const rows = await prisma.orderItem.groupBy({
    by: ["productCode", "productName"],
    where: {
      order: {
        createdAt: {
          gte: start,
          lt: end,
        },
        status: {
          not: "CANCELLED",
        },
      },
    },
    _sum: {
      quantity: true,
      subtotalCop: true,
    },
    orderBy: [
      {
        productName: "asc",
      },
    ],
  });

  const items = rows
    .map((row) => ({
      productCode: row.productCode,
      productName: row.productName,
      quantity: row._sum.quantity ?? 0,
      totalCop: row._sum.subtotalCop ?? 0,
    }))
    .filter((item) => item.quantity > 0);

  return {
    date,
    generatedAt: new Date().toISOString(),
    items,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalCop: items.reduce((sum, item) => sum + item.totalCop, 0),
  };
}

function kindToWhere(kind: string): Prisma.OrderWhereInput | undefined {
  if (kind === "incoming") return { status: "CONFIRMED" };
  if (kind === "pickup") return { status: "CONFIRMED", fulfillmentType: "PICKUP" };
  if (kind === "accepted") return { status: "PREPARING" };
  if (kind === "rejected") return { status: "CANCELLED" };
  if (kind === "delivered") return { status: "DELIVERED" };
  return undefined;
}

async function nextOrderNumber(tx: Prisma.TransactionClient) {
  const value = await nextSequentialValue(tx, "orderNumber", "PED-");
  return `PED-${String(value).padStart(6, "0")}`;
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient) {
  const value = await nextSequentialValue(tx, "invoiceNumber", "FAC-");
  return `FAC-${String(value).padStart(6, "0")}`;
}

async function nextSequentialValue(
  tx: Prisma.TransactionClient,
  field: "orderNumber" | "invoiceNumber",
  prefix: string,
) {
  const latest = await tx.order.findFirst({
    where: {
      [field]: {
        startsWith: prefix,
      },
    },
    orderBy: {
      [field]: "desc",
    },
    select: {
      [field]: true,
    },
  });
  const currentValue = latest?.[field];
  if (!currentValue) return 1;
  const suffix = Number(currentValue.slice(prefix.length));
  return Number.isFinite(suffix) ? suffix + 1 : 1;
}

function isUniqueExternalBotIdError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  if ((error as { code?: string }).code !== "P2002") {
    return false;
  }
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) && target.includes("externalBotId");
}

function buildDeliveryCorrectionMessage(input: {
  orderNumber: string;
  customerAddress: string;
  items: { productName: string; quantity: number; subtotalCop: number }[];
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
}) {
  const itemLines = input.items
    .map((item) => `- ${item.quantity} x ${item.productName}: ${formatCOP(item.subtotalCop)}`)
    .join("\n");

  return [
    "Te pedimos disculpas, el valor del domicilio de tu orden estaba mal.",
    "",
    `El valor real del domicilio es ${formatCOP(input.deliveryFeeCop)}. Este es el detalle actualizado de tu compra:`,
    "",
    `🧾 Orden ${input.orderNumber}`,
    "",
    itemLines,
    "",
    `📍 Direccion: ${input.customerAddress}`,
    "",
    `Subtotal: ${formatCOP(input.subtotalCop)}`,
    `Domicilio: ${formatCOP(input.deliveryFeeCop)}`,
    `Total: ${formatCOP(input.totalCop)}`,
    "",
    "Gracias por tu comprension.",
  ].join("\n");
}

function formatCOP(value: number) {
  return `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)}`;
}

function inferDeliveryZone(address: string) {
  const parts = address
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function todayInColombia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bogotaDayBounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError(400, "invalid_report_date", "Date must use YYYY-MM-DD format");
  }
  const start = new Date(`${date}T05:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
