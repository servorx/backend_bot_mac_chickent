CREATE TABLE "conversation_controls" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pausedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_controls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_controls_chatId_key" ON "conversation_controls"("chatId");
