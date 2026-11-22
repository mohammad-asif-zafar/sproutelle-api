import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { getPocDb } from './poc-db';
import type { AppEnv } from '../config/env';
import * as schema from './poc-schema';

export function getPocAuth(env: AppEnv['Bindings']) {
  const connectionString = env.NEON_HTTP_URL || process.env.NEON_HTTP_URL || '';
  if (!connectionString) {
    throw new Error('NEON_HTTP_URL is missing for PoC Auth.');
  }

  const db = getPocDb(connectionString);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL || 'http://localhost:8787',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
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
