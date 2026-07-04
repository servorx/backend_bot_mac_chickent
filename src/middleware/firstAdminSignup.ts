import type { NextFunction, Request, Response } from "express";

import { prisma } from "../lib/prisma.js";

export async function allowOnlyFirstSignup(_req: Request, res: Response, next: NextFunction) {
  const users = await prisma.user.count();
  if (users > 0) {
    return res.status(403).json({
      error: {
        code: "signup_disabled",
        message: "Admin user already exists",
      },
    });
  }

  return next();
}
