import { Router } from "express";
import { z } from "zod";

import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../../middleware/auth.js";

const settingsSchema = z.object({
  name: z.string().min(1),
  publicPhone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  deliveryBasePriceCop: z.number().int().min(0).default(0),
  deliveryPricePerKmCop: z.number().int().min(0).default(0),
  deliveryMaxKm: z.number().int().min(1).max(100).default(30),
});

export const deliveryRouter = Router();

deliveryRouter.use(requireAdmin);

deliveryRouter.get("/settings", async (_req, res, next) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
});

deliveryRouter.put("/settings", async (req, res, next) => {
  try {
    const input = settingsSchema.parse(req.body);
    const current = await getOrCreateSettings();
    const settings = await prisma.restaurantSetting.update({
      where: { id: current.id },
      data: input,
    });
    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
});

async function getOrCreateSettings() {
  const existing = await prisma.restaurantSetting.findFirst();
  if (existing) {
    return existing;
  }

  return prisma.restaurantSetting.create({
    data: {
      name: "ASADERO MC CHICKEN EXPRESS",
      deliveryBasePriceCop: 0,
      deliveryPricePerKmCop: 0,
      deliveryMaxKm: 30,
    },
  });
}
