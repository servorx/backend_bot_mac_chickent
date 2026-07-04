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

export async function createOrder(input: CreateOrderInput) {
  const subtotalCop = input.items.reduce(
    (total, item) => total + item.quantity * item.unitPriceCop,
    0,
  );
  const totalCop = subtotalCop + input.deliveryFeeCop;

  const order = await prisma.$transaction(async (tx) => {
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

  publish({ type: "orders.changed", orderId: order.id });
  publish({ type: "conversations.changed", chatId: input.chatId, orderId: order.id });
  return order;
}

export async function updateOrderStatus(id: string, input: UpdateStatusInput, actor = "admin") {
  const existing = await getOrderById(id);

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

function kindToStatus(kind: string) {
  if (kind === "incoming") return "CONFIRMED";
  if (kind === "accepted") return "PREPARING";
  if (kind === "rejected") return "CANCELLED";
  if (kind === "delivered") return "DELIVERED";
  return undefined;
}

async function nextOrderNumber(tx: Prisma.TransactionClient) {
  const count = await tx.order.count();
  return `PED-${String(count + 1).padStart(6, "0")}`;
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient) {
  const count = await tx.order.count();
  return `FAC-${String(count + 1).padStart(6, "0")}`;
}
