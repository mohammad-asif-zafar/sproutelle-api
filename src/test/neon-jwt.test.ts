import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import app from '../app';
import { getExpectedIssuers } from '../middleware/auth';

describe('Neon Managed Auth JWT Issuer Verification Unit Tests', () => {
  let privateKey: any;
  let publicKeyJwk: any;
  const mockBaseUrl = 'https://ep-lucky-lake-a1791kzv.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth';

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicKeyJwk = await exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = 'mock-key-id';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';
  });

  async function createMockJWT(
    payload: { sub?: string; email?: string; name?: string },
    options: { exp?: string; nbf?: string; issuer?: string; key?: any } = {}
  ) {
    const builder = new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-key-id' })
      .setIssuer(options.issuer ?? mockBaseUrl)
      .setIssuedAt();

    if (options.exp) builder.setExpirationTime(options.exp);
    if (options.nbf) builder.setNotBefore(options.nbf);

    return builder.sign(options.key ?? privateKey);
  }

  it('getExpectedIssuers() should derive valid issuers from NEON_AUTH_BASE_URL', () => {
    const derived = getExpectedIssuers(mockBaseUrl);
    expect(derived).toContain('https://ep-lucky-lake-a1791kzv.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth');
    expect(derived).toContain('https://ep-lucky-lake-a1791kzv.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth/');
    expect(derived).toContain('https://ep-lucky-lake-a1791kzv.neonauth.ap-southeast-1.aws.neon.tech');
    expect(derived).toContain('better-auth');
    expect(derived).toContain('neon-auth');
  });

  it('getExpectedIssuers() should handle undefined or empty baseUrl gracefully', () => {
    expect(getExpectedIssuers(undefined)).toBeUndefined();
    expect(getExpectedIssuers('')).toBeUndefined();
  });

  it('should reject request when Authorization header is missing (401)', async () => {
    const res = await app.request('/api/admin/dashboard/metrics', {}, {
      ENVIRONMENT: 'development',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      HYPERDRIVE: {} as any,
      NEON_AUTH_JWKS_URL: 'https://mock-neon-auth.tech/jwks.json',
      NEON_AUTH_BASE_URL: mockBaseUrl,
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject request when JWT is malformed (401)', async () => {
    const res = await app.request(
      '/api/admin/dashboard/metrics',
      {
        headers: {
          Authorization: 'Bearer invalid.malformed.jwt',
        },
      },
      {
        ENVIRONMENT: 'development',
        ALLOWED_ORIGINS: 'http://localhost:5173',
        HYPERDRIVE: {} as any,
        NEON_AUTH_JWKS_URL: 'https://mock-neon-auth.tech/jwks.json',
        NEON_AUTH_BASE_URL: mockBaseUrl,
      }
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should generate valid RS256 JWT format', async () => {
    const jwt = await createMockJWT({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      email: 'admin@sproutelle.com',
      name: 'Test Admin',
    });

    expect(typeof jwt).toBe('string');
    expect(jwt.split('.')).toHaveLength(3);
  });
});
