import { Router } from "express";
import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { requireAdmin } from "../../middleware/auth.js";
import { requireInternalApiKey } from "../../middleware/internalApiKey.js";
import { publish } from "../../realtime/events.js";
import { getBotStockControls, updateBotStockControl } from "../conversations/botClient.js";
import { productRuleSchema, upsertCategorySchema, upsertProductSchema } from "./catalogSchemas.js";

export const adminCatalogRouter = Router();
export const internalCatalogRouter = Router();

adminCatalogRouter.use(requireAdmin);

adminCatalogRouter.get("/categories", async (_req, res, next) => {
  try {
    const categories = await prisma.productCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json({ data: categories });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.post("/categories", async (req, res, next) => {
  try {
    const input = upsertCategorySchema.parse(req.body);
    const category = await prisma.productCategory.create({ data: input });
    publish({ type: "catalog.changed" });
    res.status(201).json({ data: category });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.get("/products", async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      include: { category: true, rules: true },
      orderBy: { name: "asc" },
    });
    res.json({ data: products });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.get("/stock-controls", async (_req, res, next) => {
  try {
    const response = await getBotStockControls();
    res.json(response);
  } catch (error) {
    next(new ApiError(502, "bot_stock_controls_unavailable", "No se pudo consultar la disponibilidad del bot."));
  }
});

adminCatalogRouter.patch("/stock-controls/:code", async (req, res, next) => {
  try {
    const isAvailable = Boolean(req.body?.isAvailable);
    const response = await updateBotStockControl({
      code: req.params.code,
      isAvailable,
    });
    publish({ type: "catalog.changed" });
    res.json(response);
  } catch (error) {
    next(new ApiError(502, "bot_stock_control_update_failed", "No se pudo actualizar la disponibilidad del bot."));
  }
});

adminCatalogRouter.post("/products", async (req, res, next) => {
  try {
    const input = upsertProductSchema.parse(req.body);
    const product = await prisma.product.create({ data: input });
    publish({ type: "catalog.changed" });
    res.status(201).json({ data: product });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.patch("/products/:id", async (req, res, next) => {
  try {
    const input = upsertProductSchema.partial().parse(req.body);
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: input,
    });
    publish({ type: "catalog.changed" });
    res.json({ data: product });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.post("/products/:id/rules", async (req, res, next) => {
  try {
    const input = productRuleSchema.parse(req.body);
    const rule = await prisma.productRule.create({
      data: {
        productId: req.params.id,
        type: input.type,
        config: input.config as Prisma.InputJsonValue,
        isActive: input.isActive,
      },
    });
    publish({ type: "catalog.changed" });
    res.status(201).json({ data: rule });
  } catch (error) {
    next(error);
  }
});

internalCatalogRouter.use(requireInternalApiKey);

internalCatalogRouter.get("/catalog", async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true, isAvailable: true },
      include: {
        category: true,
        rules: { where: { isActive: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json({ data: products });
  } catch (error) {
    next(error);
  }
});
