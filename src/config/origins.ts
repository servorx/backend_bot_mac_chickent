import { env } from "./env.js";

const VERCEL_PREVIEW_ORIGIN = /^https:\/\/frontend-bot-mac-chickent(?:-[a-z0-9-]+)?\.vercel\.app$/;

export function allowedFrontendOrigins() {
  return [env.FRONTEND_ORIGIN];
}

export function isAllowedFrontendOrigin(origin: string | undefined) {
  if (!origin) {
    return false;
  }
  return allowedFrontendOrigins().includes(origin) || VERCEL_PREVIEW_ORIGIN.test(origin);
}
