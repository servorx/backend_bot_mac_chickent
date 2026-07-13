import { z } from "zod";

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(1200),
});

export const chatIdSchema = z.string().trim().min(7).max(20).regex(/^\d+$/);

export const updateConversationControlSchema = z.object({
  aiEnabled: z.boolean(),
});

export const incomingMessageSchema = z.object({
  chatId: z.string().min(1),
  phone: z.string().optional(),
  body: z.string().trim().min(1),
  externalMessageId: z.string().optional(),
  sentAt: z.string().optional(),
  orderId: z.string().optional(),
});

export const outgoingBotMessageSchema = z.object({
  chatId: z.string().min(1),
  body: z.string().trim().min(1),
  externalMessageId: z.string().optional(),
  sentAt: z.string().optional(),
  orderId: z.string().optional(),
});
