import type { Order, OrderItem } from "@prisma/client";

type OrderWithItems = Order & {
  items: OrderItem[];
};

export function toAdminOrder(order: OrderWithItems) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    invoiceNumber: order.invoiceNumber,
    status: order.status,
    customer: {
      fullName: order.customerName,
      phone: order.customerPhone,
      address: order.customerAddress,
      neighborhood: "Incluido en direccion",
    },
    paymentMethod: order.paymentMethod,
    observations: order.observations ?? undefined,
    items: order.items.map((item) => ({
      id: item.id,
      productCode: item.productCode ?? undefined,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPriceCop,
      subtotal: item.subtotalCop,
    })),
    subtotal: order.subtotalCop,
    deliveryFee: order.deliveryFeeCop,
    total: order.totalCop,
    createdAt: order.createdAt.toISOString(),
    acceptedAt: order.preparingAt?.toISOString(),
    rejectedAt: order.cancelledAt?.toISOString(),
    deliveredAt: order.deliveredAt?.toISOString(),
    rejectionReason: order.cancellationReason ?? undefined,
  };
}
