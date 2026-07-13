import { env } from "../../config/env.js";

export type StockControl = {
  code: string;
  label: string;
  groupLabel: string;
  productCode: string | null;
  variantLabel: string | null;
  isAvailable: boolean;
};

export async function sendBotMessage(input: { chatId: string; body: string }) {
  const response = await fetch(`${env.BOT_API_BASE_URL}/internal/messages/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": env.INTERNAL_API_KEY,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Bot message send failed with status ${response.status}`);
  }

  return response.json().catch(() => ({}));
}

export async function getBotStockControls() {
  const response = await fetch(`${env.BOT_API_BASE_URL}/internal/catalog/stock-controls`, {
    method: "GET",
    headers: {
      "X-Internal-Api-Key": env.INTERNAL_API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Bot stock controls request failed with status ${response.status}`);
  }

  return (await response.json()) as { data: StockControl[] };
}

export async function updateBotStockControl(input: { code: string; isAvailable: boolean }) {
  const response = await fetch(`${env.BOT_API_BASE_URL}/internal/catalog/stock-controls/${input.code}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": env.INTERNAL_API_KEY,
    },
    body: JSON.stringify({ isAvailable: input.isAvailable }),
  });

  if (!response.ok) {
    throw new Error(`Bot stock control update failed with status ${response.status}`);
  }

  return (await response.json()) as { data: StockControl };
}
