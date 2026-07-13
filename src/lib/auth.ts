import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { env } from "../config/env.js";
import { prisma } from "./prisma.js";

export const auth = betterAuth({
  baseURL: env.APP_BASE_URL,
  trustedOrigins: [env.FRONTEND_ORIGIN],
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
    defaultCookieAttributes:
      env.NODE_ENV === "production"
        ? {
            sameSite: "none",
            secure: true,
          }
        : undefined,
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    minPasswordLength: 8,
  },
});
