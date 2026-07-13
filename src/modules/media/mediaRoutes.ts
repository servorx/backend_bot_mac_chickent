import { Router } from "express";

import { env } from "../../config/env.js";
import { requireAdmin } from "../../middleware/auth.js";

export const mediaRouter = Router();

mediaRouter.use(requireAdmin);

mediaRouter.get("/whatsapp/:mediaId", async (req, res, next) => {
  try {
    const mediaId = encodeURIComponent(req.params.mediaId);
    const response = await fetch(`${env.BOT_API_BASE_URL}/internal/media/${mediaId}`, {
      headers: {
        "X-Internal-Api-Key": env.INTERNAL_API_KEY,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "No se pudo cargar el archivo de WhatsApp." });
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const cacheControl = response.headers.get("cache-control") ?? "private, max-age=300";
    const content = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    res.send(content);
  } catch (error) {
    next(error);
  }
});
