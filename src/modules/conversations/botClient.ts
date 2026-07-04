import { env } from "../../config/env.js";

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
