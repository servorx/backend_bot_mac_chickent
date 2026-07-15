import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import morgan from "morgan";
import { toNodeHandler } from "better-auth/node";

import { env } from "./config/env.js";
import { isAllowedFrontendOrigin } from "./config/origins.js";
import { auth } from "./lib/auth.js";
import { errorHandler } from "./lib/errors.js";
import { prisma } from "./lib/prisma.js";
import { allowOnlyFirstSignup } from "./middleware/firstAdminSignup.js";
import { adminCatalogRouter, internalCatalogRouter } from "./modules/catalog/catalogRoutes.js";
import { adminConversationRouter, internalConversationRouter } from "./modules/conversations/conversationRoutes.js";
import { deliveryRouter } from "./modules/delivery/deliveryRoutes.js";
import { mediaRouter } from "./modules/media/mediaRoutes.js";
import { adminOrderRouter, internalOrderRouter } from "./modules/orders/orderRoutes.js";
import { attachRealtime } from "./realtime/events.js";

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedFrontendOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(helmet());
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.post("/api/auth/sign-up/email", allowOnlyFirstSignup);
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", service: "asadero-mc-backend" });
});

app.use("/api/admin", adminOrderRouter);
app.use("/api/admin/catalog", adminCatalogRouter);
app.use("/api/admin/conversations", adminConversationRouter);
app.use("/api/admin/delivery", deliveryRouter);
app.use("/api/media", mediaRouter);
app.use("/api/v1/internal", internalOrderRouter);
app.use("/api/v1/internal", internalCatalogRouter);
app.use("/api/v1/internal", internalConversationRouter);

app.use(errorHandler);

const server = createServer(app);
attachRealtime(server);

server.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
});
