import type { Server as HttpServer } from "http";
import { WebSocketServer } from "ws";

type RealtimeEvent =
  | { type: "orders.changed"; orderId?: string }
  | { type: "catalog.changed" }
  | { type: "conversations.changed"; chatId?: string; orderId?: string };

let wss: WebSocketServer | null = null;

export function attachRealtime(server: HttpServer) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connected" }));
  });
}

export function publish(event: RealtimeEvent) {
  if (!wss) {
    return;
  }

  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}
