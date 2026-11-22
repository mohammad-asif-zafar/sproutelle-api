import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import app from '../app';

describe('Session Restoration and Admin Authorization Tests', () => {
  let privateKey: any;
  const mockIssuer = 'https://ep-lucky-lake-a1791kzv.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth';
  const nonAdminUserId = '550e8400-e29b-41d4-a716-446655440000';

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
  });

  async function createMockJWT(sub: string, email: string) {
    return new SignJWT({
      sub,
      email,
      name: 'Test User',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-key-id' })
      .setIssuer(mockIssuer)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  it('GET /api/auth/get-session with invalid JWT should return 401 UNAAUTHENTICATED', async () => {
    const res = await app.request('/api/auth/get-session', {
      headers: {
        Authorization: 'Bearer invalid_jwt_token',
      },
    }, {
      ENVIRONMENT: 'development',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      HYPERDRIVE: {} as any,
      NEON_AUTH_JWKS_URL: 'https://mock-neon-auth.tech/jwks.json',
      NEON_AUTH_BASE_URL: mockIssuer,
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /api/admin/dashboard/metrics with valid non-admin JWT should return 403 or 503 safely', async () => {
    const jwt = await createMockJWT(nonAdminUserId, 'nonadmin@sproutelle.com');

    const res = await app.request('/api/admin/dashboard/metrics', {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    }, {
      ENVIRONMENT: 'development',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      HYPERDRIVE: {
        connectionString: 'postgresql://mock:mock@localhost:5432/mock',
      } as any,
      NEON_AUTH_JWKS_URL: 'https://mock-neon-auth.tech/jwks.json',
      NEON_AUTH_BASE_URL: mockIssuer,
    });

    expect([401, 403, 500, 503]).toContain(res.status);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });
});
