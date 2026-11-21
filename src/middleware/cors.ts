import { cors } from 'hono/cors';
import type { AppEnv } from '../config/env';

export const corsMiddleware = cors({
  origin: (origin, c) => {
    const env = c.env as AppEnv['Bindings'];
    const allowedOrigins = env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [];

    if (origin && allowedOrigins.includes(origin)) {
      return origin;
    }
    return null; // Reject unconfigured
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
});
