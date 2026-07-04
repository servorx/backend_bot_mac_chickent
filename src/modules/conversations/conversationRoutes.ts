import { Router } from "express";

import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../../middleware/auth.js";
import { requireInternalApiKey } from "../../middleware/internalApiKey.js";
import { publish } from "../../realtime/events.js";
import { sendBotMessage } from "./botClient.js";
import { incomingMessageSchema, sendMessageSchema } from "./conversationSchemas.js";

export const adminConversationRouter = Router();
export const internalConversationRouter = Router();

adminConversationRouter.use(requireAdmin);

adminConversationRouter.get("/orders/:orderId/messages", async (req, res, next) => {
  try {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: req.params.orderId },
      select: { id: true, chatId: true },
    });
    const messages = await prisma.conversationMessage.findMany({
      where: { OR: [{ orderId: order.id }, { chatId: order.chatId ?? "" }] },
      orderBy: { sentAt: "asc" },
    });
    res.json({ data: messages });
  } catch (error) {
    next(error);
  }
});

adminConversationRouter.post("/orders/:orderId/messages", async (req, res, next) => {
  try {
    const input = sendMessageSchema.parse(req.body);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: req.params.orderId },
      select: { id: true, chatId: true, customerId: true },
    });

    if (!order.chatId) {
      return res.status(409).json({
        error: { code: "missing_chat_id", message: "Order has no chat id" },
      });
    }

    const message = await prisma.conversationMessage.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        chatId: order.chatId,
        direction: "OUTBOUND",
        sender: "ADMIN",
        body: input.body,
      },
    });

    let delivered = true;
    try {
      await sendBotMessage({ chatId: order.chatId, body: input.body });
    } catch (error) {
      delivered = false;
      console.error(error);
    }

    publish({ type: "conversations.changed", chatId: order.chatId, orderId: order.id });
    res.status(delivered ? 201 : 202).json({ data: { ...message, delivered } });
  } catch (error) {
    next(error);
  }
});

internalConversationRouter.use(requireInternalApiKey);

internalConversationRouter.post("/messages/incoming", async (req, res, next) => {
  try {
    const input = incomingMessageSchema.parse(req.body);
    const customer = input.phone
      ? await prisma.customer.findUnique({ where: { phone: input.phone } })
      : null;
    const message = await prisma.conversationMessage.create({
      data: {
        orderId: input.orderId,
        customerId: customer?.id,
        chatId: input.chatId,
        direction: "INBOUND",
        sender: "CUSTOMER",
        body: input.body,
        externalMessageId: input.externalMessageId,
      },
    });
    publish({ type: "conversations.changed", chatId: input.chatId, orderId: input.orderId });
    res.status(201).json({ data: message });
  } catch (error) {
    next(error);
  }
});
