import { Router } from "express";

import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../../middleware/auth.js";
import { requireInternalApiKey } from "../../middleware/internalApiKey.js";
import { publish } from "../../realtime/events.js";
import { sendBotMessage } from "./botClient.js";
import {
  chatIdSchema,
  incomingMessageSchema,
  outgoingBotMessageSchema,
  sendMessageSchema,
  updateConversationControlSchema,
} from "./conversationSchemas.js";

export const adminConversationRouter = Router();
export const internalConversationRouter = Router();

adminConversationRouter.use(requireAdmin);

adminConversationRouter.get("/", async (_req, res, next) => {
  try {
    const messages = await prisma.conversationMessage.findMany({
      include: { customer: true, order: true },
      orderBy: { sentAt: "desc" },
      take: 1000,
    });
    const controls = await prisma.conversationControl.findMany();
    const controlByChatId = new Map(controls.map((control) => [control.chatId, control]));
    const byChat = new Map<string, (typeof messages)[number]>();
    for (const message of messages) {
      if (!byChat.has(message.chatId)) {
        byChat.set(message.chatId, message);
      }
    }
    const data = Array.from(byChat.values()).map((message) => {
      const control = controlByChatId.get(message.chatId);
      return {
        chatId: message.chatId,
        customerId: message.customerId,
        customerName: message.customer?.fullName ?? message.order?.customerName ?? null,
        customerPhone: message.customer?.phone ?? message.order?.customerPhone ?? message.chatId,
        lastMessage: {
          id: message.id,
          body: message.body,
          direction: message.direction,
          sender: message.sender,
          sentAt: message.sentAt,
        },
        aiEnabled: control?.aiEnabled ?? true,
        aiPausedUntil: control?.pausedUntil ?? null,
      };
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

adminConversationRouter.get("/orders/:orderId/messages", async (req, res, next) => {
  try {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: req.params.orderId },
      select: { id: true, chatId: true, createdAt: true },
    });
    const nextOrder = order.chatId
      ? await prisma.order.findFirst({
          where: {
            chatId: order.chatId,
            createdAt: { gt: order.createdAt },
          },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        })
      : null;
    const messages = await prisma.conversationMessage.findMany({
      where: {
        OR: [
          { orderId: order.id },
          ...(order.chatId
            ? [
                {
                  orderId: null,
                  chatId: order.chatId,
                  sentAt: nextOrder
                    ? { gte: order.createdAt, lt: nextOrder.createdAt }
                    : { gte: order.createdAt },
                },
              ]
            : []),
        ],
      },
      orderBy: { sentAt: "asc" },
    });
    res.json({ data: messages });
  } catch (error) {
    next(error);
  }
});

adminConversationRouter.get("/:chatId/messages", async (req, res, next) => {
  try {
    const chatId = chatIdSchema.parse(req.params.chatId);
    const messages = await prisma.conversationMessage.findMany({
      where: { chatId },
      orderBy: { sentAt: "asc" },
    });
    res.json({ data: messages });
  } catch (error) {
    next(error);
  }
});

adminConversationRouter.get("/:chatId/control", async (req, res, next) => {
  try {
    const chatId = chatIdSchema.parse(req.params.chatId);
    const control = await getOrCreateControl(chatId);
    res.json({ data: toControlResponse(control) });
  } catch (error) {
    next(error);
  }
});

adminConversationRouter.put("/:chatId/control", async (req, res, next) => {
  try {
    const chatId = chatIdSchema.parse(req.params.chatId);
    const input = updateConversationControlSchema.parse(req.body);
    const control = await prisma.conversationControl.upsert({
      where: { chatId },
      update: {
        aiEnabled: input.aiEnabled,
        pausedUntil: input.aiEnabled ? null : undefined,
      },
      create: { chatId, aiEnabled: input.aiEnabled },
    });
    publish({ type: "conversations.changed", chatId });
    res.json({ data: toControlResponse(control) });
  } catch (error) {
    next(error);
  }
});

adminConversationRouter.post("/:chatId/messages", async (req, res, next) => {
  try {
    const chatId = chatIdSchema.parse(req.params.chatId);
    const input = sendMessageSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { phone: chatId } });
    const latestOrder = await prisma.order.findFirst({
      where: { chatId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const message = await prisma.conversationMessage.create({
      data: {
        orderId: latestOrder?.id,
        customerId: customer?.id,
        chatId,
        direction: "OUTBOUND",
        sender: "ADMIN",
        body: input.body,
      },
    });

    let delivered = true;
    try {
      await sendBotMessage({ chatId, body: input.body });
      await pauseAi(chatId);
    } catch (error) {
      delivered = false;
      console.error(error);
    }

    publish({ type: "conversations.changed", chatId, orderId: latestOrder?.id });
    res.status(delivered ? 201 : 202).json({ data: { ...message, delivered } });
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
      await pauseAi(order.chatId);
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

internalConversationRouter.get("/conversations/:chatId/control", async (req, res, next) => {
  try {
    const chatId = chatIdSchema.parse(req.params.chatId);
    const control = await getOrCreateControl(chatId);
    res.json({ data: toControlResponse(control) });
  } catch (error) {
    next(error);
  }
});

internalConversationRouter.post("/messages/incoming", async (req, res, next) => {
  try {
    const input = incomingMessageSchema.parse(req.body);
    const existing = await findMessageByExternalId(input.externalMessageId);
    if (existing) {
      return res.status(200).json({ data: existing });
    }
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
        attachment: input.attachment,
        externalMessageId: input.externalMessageId,
        sentAt: parseSyncedSentAt(input.sentAt),
      },
    });
    publish({ type: "conversations.changed", chatId: input.chatId, orderId: input.orderId });
    res.status(201).json({ data: message });
  } catch (error) {
    next(error);
  }
});

internalConversationRouter.post("/messages/outgoing-bot", async (req, res, next) => {
  try {
    const input = outgoingBotMessageSchema.parse(req.body);
    const existing = await findMessageByExternalId(input.externalMessageId);
    if (existing) {
      return res.status(200).json({ data: existing });
    }
    const customer = await prisma.customer.findUnique({ where: { phone: input.chatId } });
    const message = await prisma.conversationMessage.create({
      data: {
        orderId: input.orderId,
        customerId: customer?.id,
        chatId: input.chatId,
        direction: "OUTBOUND",
        sender: "BOT",
        body: input.body,
        externalMessageId: input.externalMessageId,
        sentAt: parseSyncedSentAt(input.sentAt),
      },
    });
    publish({ type: "conversations.changed", chatId: input.chatId, orderId: input.orderId });
    res.status(201).json({ data: message });
  } catch (error) {
    next(error);
  }
});

async function getOrCreateControl(chatId: string) {
  return prisma.conversationControl.upsert({
    where: { chatId },
    update: {},
    create: { chatId },
  });
}

async function pauseAi(chatId: string) {
  const pausedUntil = new Date(Date.now() + 30 * 60 * 1000);
  return prisma.conversationControl.upsert({
    where: { chatId },
    update: { pausedUntil },
    create: { chatId, pausedUntil },
  });
}

function toControlResponse(control: { aiEnabled: boolean; pausedUntil: Date | null }) {
  const now = Date.now();
  const pausedUntil = control.pausedUntil?.toISOString() ?? null;
  return {
    aiEnabled: control.aiEnabled,
    pausedUntil,
    aiActive: control.aiEnabled && (!control.pausedUntil || control.pausedUntil.getTime() <= now),
  };
}

async function findMessageByExternalId(externalMessageId?: string) {
  if (!externalMessageId) {
    return null;
  }
  return prisma.conversationMessage.findFirst({ where: { externalMessageId } });
}

function parseSyncedSentAt(value?: string) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
