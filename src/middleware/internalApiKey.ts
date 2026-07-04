import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";

export function requireInternalApiKey(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.header("x-internal-api-key");
  if (!apiKey || apiKey !== env.INTERNAL_API_KEY) {
    return next(new ApiError(401, "invalid_internal_api_key", "Invalid internal API key"));
  }
  return next();
}
