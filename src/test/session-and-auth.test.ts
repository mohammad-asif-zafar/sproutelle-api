import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { createServer, Server } from 'http';
import app from '../app';
import * as dbClientModule from '../db/client';

describe('Session Restoration and Admin Authorization Tests', () => {
  let privateKey: any;
  let wrongPrivateKey: any;
  let jwksJson: any;

  let server: Server;
  let baseUrl: string;

  const mockIssuer = 'https://ep-lucky-lake-a1791kzv.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth';
  const mockAudience = 'authenticated';
  const adminUserId = 'adbba308-7c6e-4d10-b82a-866e60a7b21c';
  const nonAdminUserId = '550e8400-e29b-41d4-a716-446655440000';

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;

    const wrongKeyPair = await generateKeyPair('RS256');
    wrongPrivateKey = wrongKeyPair.privateKey;

    const jwk = await exportJWK(keyPair.publicKey);
    jwk.kid = 'mock-key-id';
    jwk.alg = 'RS256';
    jwk.use = 'sig';

    jwksJson = { keys: [jwk] };

    server = createServer((req, res) => {
      if (req.url?.startsWith('/jwks-fail.json')) {
        res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jwksJson));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupMocks(dbResult: { rows: any[] } | Error) {
    vi.spyOn(dbClientModule, 'getDbClient').mockResolvedValue({
      query: vi.fn().mockImplementation(() => {
        if (dbResult instanceof Error) return Promise.reject(dbResult);
        return Promise.resolve(dbResult);
      }),
      end: vi.fn().mockResolvedValue(undefined),
    } as any);
  }

  async function createMockJWT(
    payload: { sub?: string; email?: string; name?: string },
    options: { exp?: string | number; nbf?: string | number; issuer?: string; aud?: string | string[]; key?: any } = {}
  ) {
    const builder = new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-key-id' })
      .setIssuer(options.issuer !== undefined ? options.issuer : mockIssuer)
      .setIssuedAt();

    if (options.aud !== null) {
      builder.setAudience(options.aud !== undefined ? options.aud : mockAudience);
    }

    if (options.exp) builder.setExpirationTime(options.exp);
    else builder.setExpirationTime('1h');

    if (options.nbf) builder.setNotBefore(options.nbf);

    return builder.sign(options.key ?? privateKey);
  }

  // To prevent jwksCache collision across tests in auth.ts, we append a random query param to bypass cache
  const getEnv = (failJwks = false) => ({
    ENVIRONMENT: 'development',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    HYPERDRIVE: { connectionString: 'mock_conn' } as any,
    NEON_AUTH_JWKS_URL: failJwks ? `${baseUrl}/jwks-fail.json?t=${Date.now()}${Math.random()}` : `${baseUrl}/jwks.json?t=${Date.now()}${Math.random()}`,
    NEON_AUTH_BASE_URL: mockIssuer,
  });

  it('GET /api/auth/get-session rejects missing token (401)', async () => {
    setupMocks({ rows: [] });
    const res = await app.request('/api/auth/get-session', { executionCtx: { waitUntil: vi.fn() } } as any, getEnv());
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/auth/get-session rejects malformed token (401)', async () => {
    setupMocks({ rows: [] });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: 'Bearer malformed.token.here' },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/auth/get-session rejects invalid signature (401)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ sub: adminUserId }, { key: wrongPrivateKey });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/get-session rejects wrong issuer (401)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ sub: adminUserId }, { issuer: 'https://wrong-issuer.com' });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/get-session rejects wrong audience (401)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ sub: adminUserId }, { aud: 'wrong-audience' });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/get-session rejects expired JWT (401)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ sub: adminUserId }, { exp: Math.floor(Date.now() / 1000) - 3600 });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/get-session rejects future nbf JWT (401)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ sub: adminUserId }, { nbf: Math.floor(Date.now() / 1000) + 3600 });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/get-session rejects missing subject (401)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ email: 'admin@sproutelle.com' }); // no sub
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/get-session handles JWKS/network failure safely (503)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ sub: adminUserId });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv(true)); // fetchFails

    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('GET /api/auth/get-session returns isAdmin: true for valid admin mapping (200)', async () => {
    setupMocks({ rows: [{ is_admin: true }] });
    const jwt = await createMockJWT({ sub: adminUserId, email: 'admin@sproutelle.com' });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.isAdmin).toBe(true);
    expect(body.data.id).toBe(adminUserId);
  });

  it('GET /api/auth/get-session returns isAdmin: false for non-admin user (200)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ sub: nonAdminUserId, email: 'user@sproutelle.com' });
    const res = await app.request('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.isAdmin).toBe(false);
  });

  it('GET /api/admin/dashboard/metrics rejects non-admin user (403)', async () => {
    setupMocks({ rows: [] });
    const jwt = await createMockJWT({ sub: nonAdminUserId });
    const res = await app.request('/api/admin/dashboard/metrics', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('GET /api/admin/dashboard/metrics returns 500 on database failure', async () => {
    setupMocks(new Error('DB connection failed'));
    const jwt = await createMockJWT({ sub: adminUserId });
    const res = await app.request('/api/admin/dashboard/metrics', {
      headers: { Authorization: `Bearer ${jwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, getEnv());

    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
