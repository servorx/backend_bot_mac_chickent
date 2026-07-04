import { z } from "zod";

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(1200),
});

export const incomingMessageSchema = z.object({
  chatId: z.string().min(1),
  phone: z.string().optional(),
  body: z.string().trim().min(1),
  externalMessageId: z.string().optional(),
  orderId: z.string().optional(),
});
