import type { NextFunction, Request, Response } from "express";

import { ApiError } from "../lib/errors.js";
import { auth } from "../lib/auth.js";
import { requestHeaders } from "../lib/http.js";

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const session = await auth.api.getSession({
    headers: requestHeaders(req),
  });

  if (!session?.user) {
    return next(new ApiError(401, "unauthorized", "Authentication required"));
  }

  return next();
}
