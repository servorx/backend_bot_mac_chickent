import { z } from "zod";

const orderItemSchema = z.object({
  productId: z.string().optional(),
  productCode: z.string().optional(),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCop: z.number().int().min(0),
  notes: z.string().optional().nullable(),
});

export const createOrderSchema = z.object({
  externalBotId: z.string().optional(),
  chatId: z.string().min(1),
  customer: z.object({
    fullName: z.string().min(1),
    phone: z.string().min(1),
    address: z.string().min(1),
  }),
  paymentMethod: z.string().min(1),
  observations: z.string().optional().nullable(),
  deliveryFeeCop: z.number().int().min(0).default(0),
  items: z.array(orderItemSchema).min(1),
  inboundMessage: z.string().optional(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().optional().nullable(),
});

export const updateStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "DELIVERED", "CANCELLED"]),
  reason: z.string().optional().nullable(),
});
