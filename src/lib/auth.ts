import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { env } from "../config/env.js";
import { allowedFrontendOrigins, isAllowedFrontendOrigin } from "../config/origins.js";
import { prisma } from "./prisma.js";

export const auth = betterAuth({
  baseURL: env.APP_BASE_URL,
  trustedOrigins: (request) => {
    const requestOrigin = request?.headers.get("origin") ?? request?.headers.get("referer") ?? "";
    if (isAllowedFrontendOrigin(requestOrigin)) {
      return [requestOrigin];
    }
    return allowedFrontendOrigins();
  },
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
