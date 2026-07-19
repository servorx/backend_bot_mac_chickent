import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";
import { WebSocketServer } from "ws";

import { isAllowedFrontendOrigin } from "../config/origins.js";
import { auth } from "../lib/auth.js";

type RealtimeEvent =
  | { type: "orders.changed"; orderId?: string }
  | { type: "orders.created"; orderId: string; status: string; fulfillmentType: string }
  | { type: "catalog.changed" }
  | { type: "conversations.changed"; chatId?: string; orderId?: string };

let wss: WebSocketServer | null = null;

export function attachRealtime(server: HttpServer) {
  wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (request, socket, head) => {
    if (!isRealtimeRequest(request) || !(await isAuthorizedRealtimeRequest(request))) {
      socket.destroy();
      return;
    }
    wss?.handleUpgrade(request, socket, head, (ws) => {
      wss?.emit("connection", ws, request);
    });
  });
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

function isRealtimeRequest(request: IncomingMessage) {
  return request.url?.split("?")[0] === "/ws";
}

async function isAuthorizedRealtimeRequest(request: IncomingMessage) {
  if (!isAllowedFrontendOrigin(request.headers.origin)) {
    return false;
  }
  const session = await auth.api.getSession({ headers: headersFromRequest(request) });
  return Boolean(session?.user);
}

function headersFromRequest(request: IncomingMessage) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    }
  }
  return headers;
}
