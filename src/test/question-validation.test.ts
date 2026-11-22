import { describe, it, expect, vi } from 'vitest';
import app from '../app';

let capturedQueries: { sql: string; params: any[] }[] = [];

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
    query: async (sql: string, params: any[]) => {
      capturedQueries.push({ sql, params });
      if (sql.includes('SELECT is_admin')) {
        return { rows: [{ is_admin: true }] };
      }
      if (sql.includes('INSERT INTO questions') || sql.includes('UPDATE questions')) {
        return { rows: [{ id: 'q-uuid-1', question_text: params[3] || 'Test Question' }] };
      }
      if (sql.includes('INSERT INTO question_options')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO game_levels') || sql.includes('UPDATE game_levels')) {
        return { rows: [{ id: 'lvl-uuid-1', level_number: 1, title: 'Level 1' }] };
      }
      return { rows: [] };
    },
    end: async () => {},
  }),
}));

describe('Comprehensive Question & Level Validation and Parameter Tests', () => {
  const envDev = {
    ENVIRONMENT: 'development',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    HYPERDRIVE: {} as any,
    NEON_AUTH_JWKS_URL: 'https://mock-neon-auth.tech/jwks.json',
    NEON_AUTH_BASE_URL: 'https://mock-neon-auth.tech/auth',
    NEON_HTTP_URL: 'postgresql://mock:mock@localhost:5432/mock',
  };

  it('should assert exact SQL parameter arrays for creating question with 4 options', async () => {
    capturedQueries = [];
    const res = await app.request(
      '/api/admin/games/game-uuid-1/questions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid.jwt.token',
        },
        body: JSON.stringify({
          question_text: 'Which one is Onion?',
          question_type: 'picture_quest',
          sort_order: '1',
          options: [
            { option_text: 'Option 1', is_correct: true, sort_order: '1', media_asset_id: 'media-1' },
            { option_text: 'Option 2', is_correct: false, sort_order: '2', media_asset_id: 'media-2' },
            { option_text: 'Option 3', is_correct: false, sort_order: '3', media_asset_id: 'media-3' },
            { option_text: 'Option 4', is_correct: false, sort_order: '4', media_asset_id: 'media-4' },
          ],
        }),
      },
      envDev
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.question_text).toBe('Which one is Onion?');

    const optionInserts = capturedQueries.filter(q => q.sql.includes('INSERT INTO question_options'));
    expect(optionInserts.length).toBe(4);
    expect(optionInserts[0].params).toEqual(['q-uuid-1', 'Option 1', true, 1, 'media-1']);
    expect(optionInserts[3].params).toEqual(['q-uuid-1', 'Option 4', false, 4, 'media-4']);
  });

  it('should test updating question ordering and option ordering', async () => {
    capturedQueries = [];
    const res = await app.request(
      '/api/admin/games/game-uuid-1/questions/q-uuid-1',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid.jwt.token',
        },
        body: JSON.stringify({
          question_text: 'Updated Question',
          sort_order: 5,
          options: [
            { option_text: 'New Opt 1', is_correct: false, sort_order: 1, media_asset_id: 'm-1' },
            { option_text: 'New Opt 2', is_correct: true, sort_order: 2, media_asset_id: 'm-2' },
          ],
        }),
      },
      envDev
    );

    expect(res.status).toBe(200);
    const updateQ = capturedQueries.find(q => q.sql.includes('UPDATE questions'));
    expect(updateQ).toBeDefined();
    expect(updateQ!.params[5]).toBe(5);

    const optionInserts = capturedQueries.filter(q => q.sql.includes('INSERT INTO question_options'));
    expect(optionInserts.length).toBe(2);
    expect(optionInserts[0].params).toEqual(['q-uuid-1', 'New Opt 1', false, 1, 'm-1']);
    expect(optionInserts[1].params).toEqual(['q-uuid-1', 'New Opt 2', true, 2, 'm-2']);
  });

  it('should reject invalid question ordering, level_number, pass_score, and level sort_order', async () => {
    // Invalid question sort order
    let res = await app.request(
      '/api/admin/games/game-uuid-1/questions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid.jwt.token' },
        body: JSON.stringify({ question_text: 'Q', sort_order: 'invalid' }),
      },
      envDev
    );
    expect(res.status).toBe(400);

    // Invalid level number
    res = await app.request(
      '/api/admin/games/game-uuid-1/levels',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid.jwt.token' },
        body: JSON.stringify({ level_number: 'abc', title: 'L1', pass_score: 80 }),
      },
      envDev
    );
    expect(res.status).toBe(400);

    // Invalid pass score
    res = await app.request(
      '/api/admin/games/game-uuid-1/levels',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid.jwt.token' },
        body: JSON.stringify({ level_number: 1, title: 'L1', pass_score: 'xyz' }),
      },
      envDev
    );
    expect(res.status).toBe(400);
  });

  it('should verify explicit null versus omitted properties in level update', async () => {
    capturedQueries = [];
    const res = await app.request(
      '/api/admin/games/game-uuid-1/levels/lvl-uuid-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid.jwt.token' },
        body: JSON.stringify({
          title: 'Updated Title',
          description: null, // explicit null clearing
        }),
      },
      envDev
    );

    expect(res.status).toBe(200);
    const updateLvl = capturedQueries.find(q => q.sql.includes('UPDATE game_levels'));
    expect(updateLvl).toBeDefined();
    expect(updateLvl!.params[0]).toBeNull();
    expect(updateLvl!.params[1]).toBe('Updated Title');
    expect(updateLvl!.params[2]).toBe('__NULL__');
  });
});
