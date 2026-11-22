import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { getAuthDb } from './db';
import type { AppEnv } from '../config/env';
import * as schema from './schema';

/**
 * Creates a request-scoped Better Auth instance bound to Cloudflare Worker environment variables
 */
export function getAuth(env: AppEnv['Bindings']) {
  const connectionString = env.NEON_HTTP_URL;
  if (!connectionString) {
    throw new Error('NEON_HTTP_URL binding is not configured in Cloudflare Worker environment.');
  }

  const db = getAuthDb(connectionString);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL || 'http://localhost:8787',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
    },
    trustedOrigins: [
      'http://localhost:5173',
      'http://localhost:4173',
      'https://admin.sproutelle.com'
    ],
    advanced: {
      crossSubDomainCookies: {
        enabled: true,
        domain: 'sproutelle.com'
      }
    }
  });
}
