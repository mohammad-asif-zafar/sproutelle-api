import { describe, it, expect, vi } from 'vitest';
import app from '../app';

vi.mock('jose', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    jwtVerify: async (token: string) => {
      if (token === 'valid.jwt.token') {
        return {
          payload: {
            sub: 'adbba308-7c6e-4d10-b82a-866e60a7b21c',
            email: 'admin@sproutelle.com',
            name: 'Test Admin',
          },
        };
      }
      throw new Error('Invalid token');
    },
  };
});

vi.mock('../db/client', () => ({
  getDbClient: async () => ({
    query: async (sql: string) => {
      if (sql.includes('SELECT is_admin')) {
        return { rows: [{ is_admin: true }] };
      }
      return { rows: [] };
    },
    end: async () => {},
  }),
}));

describe('Explorer Save Subcategory & Workflow Integration Tests (Mocked DB)', () => {
  const envDev = {
    ENVIRONMENT: 'development',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    HYPERDRIVE: {} as any,
    NEON_AUTH_JWKS_URL: 'https://mock-neon-auth.tech/jwks.json',
    NEON_AUTH_BASE_URL: 'https://mock-neon-auth.tech/auth',
    NEON_HTTP_URL: 'postgresql://mock:mock@localhost:5432/mock',
  };

  it('POST /api/admin/explorers/subcategories/save-with-games should reject missing subcategory name with 400', async () => {
    const res = await app.request(
      '/api/admin/explorers/subcategories/save-with-games',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid.jwt.token',
        },
        body: JSON.stringify({
          explorer_id: '550e8400-e29b-41d4-a716-446655440000',
          name: '',
        }),
      },
      envDev
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('MISSING_NAME');
  });

  it('POST /api/admin/explorers/subcategories/save-with-games should reject duplicate game IDs in assignments with 400', async () => {
    const res = await app.request(
      '/api/admin/explorers/subcategories/save-with-games',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid.jwt.token',
        },
        body: JSON.stringify({
          explorer_id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Phonics & Words',
          assignments: [
            { game_id: 'game-uuid-1', sort_order: 1 },
            { game_id: 'game-uuid-1', sort_order: 2 }, // Duplicate!
          ],
        }),
      },
      envDev
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DUPLICATE_ASSIGNMENT');
  });
});
