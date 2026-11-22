import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import app from '../app';
import * as dbClientModule from '../db/client';

// Mock jose's createRemoteJWKSet to return our local key for testing
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: vi.fn().mockImplementation(() => {
      return (globalThis as any).__MOCK_JWKS__;
    }),
  };
});

describe('Media Assets Studio API Unit Tests (Cloudflare R2 + Neon)', () => {
  let privateKey: any;
  const mockIssuer = 'https://ep-lucky-lake-a1791kzv.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth';
  const adminUserId = 'adbba308-7c6e-4d10-b82a-866e60a7b21c';
  let adminJwt = '';

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const publicKeyJwk = await exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = 'mock-key-id';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    (globalThis as any).__MOCK_JWKS__ = createLocalJWKSet({ keys: [publicKeyJwk] });

    adminJwt = await new SignJWT({
      sub: adminUserId,
      email: 'admin@sproutelle.com',
      name: 'Admin User',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-key-id' })
      .setIssuer(mockIssuer)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  });

  afterAll(() => {
    delete (globalThis as any).__MOCK_JWKS__;
    vi.restoreAllMocks();
  });

  const getEnv = (mockBucket: any = {}, mockDb: any = {}) => {
    vi.spyOn(dbClientModule, 'getDbClient').mockResolvedValue({
      query: vi.fn().mockImplementation((queryText) => {
        if (queryText.includes('SELECT is_admin FROM admin_users')) {
          return Promise.resolve({ rows: [{ is_admin: true }] });
        }
        if (mockDb.query) return mockDb.query(queryText);
        return Promise.resolve({ rows: [] });
      }),
      end: vi.fn().mockResolvedValue(undefined),
    } as any);

    return {
      ENVIRONMENT: 'development',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      HYPERDRIVE: { connectionString: 'mock_conn' } as any,
      MEDIA_BUCKET: mockBucket as any,
      MEDIA_BUCKET_NAME: 'mock-bucket-name',
      NEON_AUTH_JWKS_URL: 'https://mock-neon-auth.tech/jwks.json',
      NEON_AUTH_BASE_URL: mockIssuer,
      PUBLIC_MEDIA_URL: 'http://localhost:8787/api/media/file',
    };
  };

  it('POST /api/admin/media rejects unauthenticated request (401)', async () => {
    const res = await app.request('/api/admin/media', { method: 'POST' }, getEnv());
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/media rejects missing file (400)', async () => {
    const env = getEnv();
    const formData = new FormData();
    const res = await app.request('/api/admin/media', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}` },
      body: formData,
      executionCtx: { waitUntil: vi.fn() }
    } as any, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.code).toBe('MISSING_FILE');
  });

  it('POST /api/admin/media rejects unsupported file type (400)', async () => {
    const env = getEnv();
    const formData = new FormData();
    const file = new File(['mock content'], 'test.txt', { type: 'text/plain' });
    formData.append('file', file);

    const res = await app.request('/api/admin/media', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}` },
      body: formData,
      executionCtx: { waitUntil: vi.fn() }
    } as any, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('POST /api/admin/media handles successful upload and returns metadata (201)', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const mockDbQuery = vi.fn().mockResolvedValue({
      rows: [{
        id: 'mock-uuid',
        name: 'test.png',
        bucket_name: 'mock-bucket-name',
        file_path: 'media/image/mock-uuid.png',
        mime_type: 'image/png',
        size_bytes: 1234,
        created_by: adminUserId,
        created_at: new Date().toISOString()
      }]
    });

    const env = getEnv({ put: mockPut }, { query: mockDbQuery });

    const formData = new FormData();
    const file = new File(['mock content'], 'test.png', { type: 'image/png' });
    formData.append('file', file);

    const res = await app.request('/api/admin/media', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}` },
      body: formData,
      executionCtx: { waitUntil: vi.fn() }
    } as any, env);

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('test.png');
    expect(mockPut).toHaveBeenCalled();
  });

  it('POST /api/admin/media rolls back R2 object if DB insert fails (500)', async () => {
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockDbQuery = vi.fn().mockRejectedValue(new Error('DB Insert Error'));

    const env = getEnv({ put: mockPut, delete: mockDelete }, { query: mockDbQuery });

    const formData = new FormData();
    const file = new File(['mock content'], 'test.png', { type: 'image/png' });
    formData.append('file', file);

    const res = await app.request('/api/admin/media', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}` },
      body: formData,
      executionCtx: { waitUntil: vi.fn() }
    } as any, env);

    expect(res.status).toBe(500);
    expect(mockPut).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('DELETE /api/admin/media/:id rejects deletion if referenced (409)', async () => {
    const mockDbQuery = vi.fn().mockImplementation((queryText) => {
      if (queryText.includes('FROM media_assets')) {
        return Promise.resolve({ rows: [{ id: 'test-id', name: 'test.png', file_path: 'path' }] });
      }
      if (queryText.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ count: 1 }] }); // Pretend it has a reference
      }
      return Promise.resolve({ rows: [] });
    });

    const env = getEnv({}, { query: mockDbQuery });
    const res = await app.request('/api/admin/media/test-id', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminJwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, env);

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error.code).toBe('ASSET_IN_USE');
  });

  it('DELETE /api/admin/media/:id handles successful deletion (200)', async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockDbQuery = vi.fn().mockImplementation((queryText) => {
      if (queryText.includes('FROM media_assets')) {
        return Promise.resolve({ rows: [{ id: 'test-id', name: 'test.png', file_path: 'path' }] });
      }
      if (queryText.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ count: 0 }] }); // No references
      }
      return Promise.resolve({ rows: [] }); // For DELETE/COMMIT/etc
    });

    const env = getEnv({ delete: mockDelete }, { query: mockDbQuery });
    const res = await app.request('/api/admin/media/test-id', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminJwt}` },
      executionCtx: { waitUntil: vi.fn() }
    } as any, env);

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith('path');
  });
});
