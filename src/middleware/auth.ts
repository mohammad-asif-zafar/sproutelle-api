import { safeCleanupDb } from "../db/cleanup";

import type { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify, decodeJwt, errors as joseErrors } from 'jose';
import type { AppEnv } from '../config/env';
import { getDbClient } from '../db/client';
import type { ApiResponse, UserSession } from '../types/contract';

// Module-level remote JWKS set cache per JWKS URL
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(jwksUrl: string) {
  if (!jwksCache.has(jwksUrl)) {
    const jwks = createRemoteJWKSet(new URL(jwksUrl), {
      cacheMaxAge: 600000, // 10 minutes cache
      cooldownDuration: 30000, // 30s cooldown on fetch errors
    });
    jwksCache.set(jwksUrl, jwks);
  }
  return jwksCache.get(jwksUrl)!;
}

export class AuthVerificationError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = 'UNAUTHORIZED', status = 401) {
    super(message);
    this.name = 'AuthVerificationError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Derives valid expected JWT issuer strings from Neon Auth configuration
 */
export function getExpectedIssuers(baseUrl?: string): string[] | undefined {
  if (!baseUrl || baseUrl.trim() === '') return undefined;

  const issuers = new Set<string>();
  const trimmed = baseUrl.trim().replace(/\/$/, '');

  issuers.add(trimmed);
  issuers.add(`${trimmed}/`);

  try {
    const origin = new URL(trimmed).origin;
    issuers.add(origin);
    issuers.add(`${origin}/`);
  } catch {
    // Ignore URL parsing errors if any
  }

  // Neon Auth & Better Auth default issuer identifiers
  issuers.add('better-auth');
  issuers.add('neon-auth');

  return Array.from(issuers);
}

/**
 * Derives valid expected JWT audience strings from Neon Auth configuration
 */
export function getExpectedAudiences(baseUrl?: string): string[] {
  const audiences = new Set<string>();

  audiences.add('authenticated');
  audiences.add('better-auth');
  audiences.add('neon-auth');

  if (baseUrl && baseUrl.trim() !== '') {
    const trimmed = baseUrl.trim().replace(/\/$/, '');
    audiences.add(trimmed);
    audiences.add(`${trimmed}/`);

    try {
      const origin = new URL(trimmed).origin;
      audiences.add(origin);
      audiences.add(`${origin}/`);
    } catch {
      // Ignore URL parsing errors if any
    }
  }

  return Array.from(audiences);
}

/**
 * Extracts and verifies a Neon Managed Auth JWT token from the Authorization header.
 * Uses ONLY Cloudflare Worker environment bindings (c.env). No process.env fallbacks.
 * Validates: Signature, Issuer, Audience (if claim present), Expiration, Not-Before, and Subject claims.
 */
export async function verifyNeonJWT(c: Context<AppEnv>): Promise<UserSession> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthVerificationError('Unauthorized: Missing Authorization Bearer header', 'UNAUTHORIZED', 401);
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw new AuthVerificationError('Unauthorized: Empty Bearer token', 'UNAUTHORIZED', 401);
  }

  // Strict binding enforcement using c.env only
  const jwksUrl = c.env.NEON_AUTH_JWKS_URL;
  const baseUrl = c.env.NEON_AUTH_BASE_URL;

  if (!jwksUrl) {
    console.error('Configuration Error: NEON_AUTH_JWKS_URL binding is missing.');
    throw new AuthVerificationError('Authentication service misconfigured', 'SERVICE_UNAVAILABLE', 503);
  }

  let JWKS: ReturnType<typeof createRemoteJWKSet>;
  try {
    JWKS = getJWKS(jwksUrl);
  } catch (jwksErr: any) {
    console.error('JWKS initialization failed:', jwksErr?.message || jwksErr);
    throw new AuthVerificationError('Authentication service temporarily unavailable', 'SERVICE_UNAVAILABLE', 503);
  }

  try {
    const expectedIssuers = getExpectedIssuers(baseUrl);
    const expectedAudiences = getExpectedAudiences(baseUrl);

    // Decode unverified header/payload first to check if an audience claim is present
    let hasAudience = false;
    try {
      const decoded = decodeJwt(token);
      hasAudience = decoded && decoded.aud !== undefined && decoded.aud !== null;
    } catch {
      // Decode error will be caught by jwtVerify
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: expectedIssuers,
      audience: hasAudience ? expectedAudiences : undefined,
      clockTolerance: 10, // 10s clock skew tolerance
    });

    const userId = payload.sub;
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new AuthVerificationError('Unauthorized: Token payload is missing required subject claim (sub)', 'UNAUTHORIZED', 401);
    }

    const email = (payload.email as string || '').toLowerCase().trim();
    const name = (payload.name as string || email || 'Admin User');

    return {
      id: userId,
      email: email,
      name: name,
      isAdmin: false,
      image: (payload.image as string) || null,
    };
  } catch (err: any) {
    if (err instanceof AuthVerificationError) {
      throw err;
    }

    // Catch JWKS fetch or network failures specifically
    if (
      err instanceof joseErrors.JWKSNoMatchingKey ||
      err?.code === 'ERR_JWKS_FETCH_FAILED' ||
      err?.name === 'JWKSFetchError' ||
      err?.message?.includes('fetch failed') ||
      err?.message?.includes('JSON Web Key Set')
    ) {
      console.error('JWKS remote endpoint fetch failure:', err?.message || err);
      throw new AuthVerificationError('Authentication service key lookup failed', 'SERVICE_UNAVAILABLE', 503);
    }

    console.warn('JWT verification rejected token:', err?.message || err);
    throw new AuthVerificationError('Unauthorized: Invalid or expired authentication token', 'UNAUTHORIZED', 401);
  }
}

/**
 * Middleware requiring a valid verified Neon Auth JWT session
 */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  try {
    const userSession = await verifyNeonJWT(c);
    c.set('user', userSession);
    return await next();
  } catch (err: any) {
    const status = err instanceof AuthVerificationError ? err.status : 401;
    const code = err instanceof AuthVerificationError ? err.code : 'UNAUTHORIZED';
    const msg = err instanceof AuthVerificationError ? err.message : 'Unauthorized';

    const response: ApiResponse<never> = {
      success: false,
      error: {
        message: msg,
        code: code,
      },
    };
    return c.json(response, status as any);
  }
}

/**
 * Middleware requiring a valid verified Neon Auth JWT AND verified admin privileges in admin_users
 */
export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  let userSession: UserSession;
  try {
    userSession = await verifyNeonJWT(c);
  } catch (err: any) {
    const status = err instanceof AuthVerificationError ? err.status : 401;
    const code = err instanceof AuthVerificationError ? err.code : 'UNAUTHORIZED';
    const msg = err instanceof AuthVerificationError ? err.message : 'Unauthorized';

    const response: ApiResponse<never> = {
      success: false,
      error: {
        message: msg,
        code: code,
      },
    };
    return c.json(response, status as any);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    // Strictly verify admin authorization by User ID only in public.admin_users (NO EMAIL FALLBACK)
    const result = await dbClient.query(
      `SELECT is_admin FROM admin_users WHERE id = $1 AND is_admin = true LIMIT 1`,
      [userSession.id]
    );

    const isAdmin = result.rows.length > 0 && result.rows[0].is_admin === true;

    if (!isAdmin) {
      const response: ApiResponse<never> = {
        success: false,
        error: {
          message: 'Forbidden: Admin authorization required for this account',
          code: 'FORBIDDEN',
        },
      };
      return c.json(response, 403);
    }

    userSession.isAdmin = true;
    c.set('user', userSession);

    return await next();
  } catch (err: any) {
    console.error('requireAdmin database lookup error:', err);
    const response: ApiResponse<never> = {
      success: false,
      error: {
        message: 'Internal server error verifying authorization',
        code: 'INTERNAL_SERVER_ERROR',
      },
    };
    return c.json(response, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
}
