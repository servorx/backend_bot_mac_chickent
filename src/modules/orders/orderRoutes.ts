import { Router } from "express";

import { requireAdmin } from "../../middleware/auth.js";
import { requireInternalApiKey } from "../../middleware/internalApiKey.js";
import { createOrder, getOrderById, listOrders, updateOrderStatus } from "./orderService.js";
import { cancelOrderSchema, createOrderSchema, updateStatusSchema } from "./orderSchemas.js";
import { toAdminOrder } from "./orderMapper.js";

export const adminOrderRouter = Router();
export const internalOrderRouter = Router();

adminOrderRouter.use(requireAdmin);

adminOrderRouter.get("/orders/:kind(incoming|accepted|rejected|delivered|all)", async (req, res, next) => {
  try {
    const orders = await listOrders(req.params.kind);
    res.json({ data: orders.map(toAdminOrder) });
  } catch (error) {
    next(error);
  }
});

adminOrderRouter.get("/orders/:id", async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id);
    res.json({ data: toAdminOrder(order) });
  } catch (error) {
    next(error);
  }
});

adminOrderRouter.patch("/orders/:id/accept", async (req, res, next) => {
  try {
    const order = await updateOrderStatus(req.params.id, { status: "PREPARING" });
    res.json({ data: toAdminOrder(order) });
  } catch (error) {
    next(error);
  }
});

adminOrderRouter.patch("/orders/:id/reject", async (req, res, next) => {
  try {
    const input = cancelOrderSchema.parse(req.body);
    const order = await updateOrderStatus(req.params.id, {
      status: "CANCELLED",
      reason: input.reason,
    });
    res.json({ data: toAdminOrder(order) });
  } catch (error) {
    next(error);
  }
});

adminOrderRouter.patch("/orders/:id/status", async (req, res, next) => {
  try {
    const input = updateStatusSchema.parse(req.body);
    const order = await updateOrderStatus(req.params.id, input);
    res.json({ data: toAdminOrder(order) });
  } catch (error) {
    next(error);
  }
});

internalOrderRouter.use(requireInternalApiKey);

internalOrderRouter.post("/orders", async (req, res, next) => {
  try {
    const input = createOrderSchema.parse(req.body);
    const order = await createOrder(input);
    res.status(201).json({ data: toAdminOrder(order) });
  } catch (error) {
    next(error);
  }
});
