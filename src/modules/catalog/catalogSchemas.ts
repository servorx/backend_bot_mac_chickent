import { z } from "zod";

export const upsertCategorySchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const upsertProductSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  priceCop: z.number().int().min(0),
  categoryId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  isAvailable: z.boolean().default(true),
});

export const productRuleSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.unknown()),
  isActive: z.boolean().default(true),
});
