import type { Prisma } from "@prisma/client";

import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { publish } from "../../realtime/events.js";
import type { createOrderSchema, updateStatusSchema } from "./orderSchemas.js";
import type { z } from "zod";

type CreateOrderInput = z.infer<typeof createOrderSchema>;
type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

const orderInclude = {
  items: true,
} satisfies Prisma.OrderInclude;

export async function listOrders(kind: string) {
  const status = kindToStatus(kind);
  return prisma.order.findMany({
    where: status ? { status } : undefined,
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

function kindToStatus(kind: string) {
  if (kind === "incoming") return "CONFIRMED";
  if (kind === "accepted") return "PREPARING";
  if (kind === "rejected") return "CANCELLED";
  if (kind === "delivered") return "DELIVERED";
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
