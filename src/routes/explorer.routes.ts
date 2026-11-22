/**
 * Sproutelle Admin Explorer Studio Routes
 * File: src/routes/explorer.routes.ts
 */

import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import { requireAdmin } from '../middleware/auth';
import { getDbClient } from '../db/client';

const explorerRouter = new Hono<AppEnv>();

explorerRouter.use('*', requireAdmin);

// Fetch categories, games, and assignment metadata for Explorer Studio
explorerRouter.get('/meta/categories-and-games', async (c) => {
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const [catRes, gamesRes, subcatRes, qRes, subAssignRes] = await Promise.all([
      dbClient.query('SELECT * FROM game_categories ORDER BY sort_order ASC, name ASC'),
      dbClient.query('SELECT * FROM games ORDER BY sort_order ASC, name ASC'),
      dbClient.query('SELECT id, explorer_id FROM homescreen_explorer_subcategories'),
      dbClient.query('SELECT game_id, subcategory_id FROM questions'),
      dbClient.query('SELECT subcategory_id, game_id FROM subcategory_games WHERE is_active = true'),
    ]);
    return c.json({
      success: true,
      data: {
        categories: catRes.rows,
        games: gamesRes.rows,
        subcategories: subcatRes.rows,
        questions: qRes.rows,
        subcategoryGames: subAssignRes.rows,
      }
    });
  } catch (err: any) {
    console.error('Failed to fetch explorer metadata:', err);
    return c.json({ success: false, error: { message: 'Failed to fetch explorer metadata', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// List explorers
explorerRouter.get('/', async (c) => {
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(`
      SELECT e.*, m.file_path as title_image_path, m.bucket_name as title_image_bucket
      FROM homescreen_explorer e
      LEFT JOIN media_assets m ON e.title_image_asset_id = m.id
      ORDER BY e.sort_order ASC, e.created_at DESC
    `);
    return c.json({ success: true, data: res.rows });
  } catch (err: any) {
    console.error('Failed to list explorers:', err);
    return c.json({ success: false, error: { message: 'Failed to list explorers', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Create explorer
explorerRouter.post('/', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const { title_name, title_image_asset_id, background_color, category_id, sort_order, is_active } = body;

  if (!title_name || !title_name.trim()) {
    return c.json({ success: false, error: { message: 'Explorer title is required', code: 'MISSING_TITLE' } }, 400);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(
      `INSERT INTO homescreen_explorer (title_name, title_image_asset_id, background_color, category_id, sort_order, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, true), NOW(), NOW())
       RETURNING *`,
      [title_name.trim(), title_image_asset_id || null, background_color || '#FFF0F3', category_id || null, sort_order, is_active]
    );
    return c.json({ success: true, data: res.rows[0] }, 201);
  } catch (err: any) {
    console.error('Failed to create explorer:', err);
    return c.json({ success: false, error: { message: 'Failed to create explorer', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Update explorer
explorerRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const { title_name, title_image_asset_id, background_color, category_id, sort_order, is_active } = body;

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(
      `UPDATE homescreen_explorer
       SET title_name = COALESCE($1, title_name),
           title_image_asset_id = CASE WHEN $2 = '__NULL__' THEN NULL ELSE COALESCE($2, title_image_asset_id) END,
           background_color = COALESCE($3, background_color),
           category_id = CASE WHEN $4 = '__NULL__' THEN NULL ELSE COALESCE($4, category_id) END,
           sort_order = COALESCE($5, sort_order),
           is_active = COALESCE($6, is_active),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        title_name?.trim(),
        title_image_asset_id === null ? '__NULL__' : (title_image_asset_id || null),
        background_color,
        category_id === null ? '__NULL__' : (category_id || null),
        sort_order,
        is_active,
        id,
      ]
    );

    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Explorer not found', code: 'NOT_FOUND' } }, 404);
    }

    return c.json({ success: true, data: res.rows[0] });
  } catch (err: any) {
    console.error('Failed to update explorer:', err);
    return c.json({ success: false, error: { message: 'Failed to update explorer', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Delete explorer
explorerRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(`DELETE FROM homescreen_explorer WHERE id = $1 RETURNING id`, [id]);
    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Explorer not found', code: 'NOT_FOUND' } }, 404);
    }
    return c.json({ success: true, data: { id } });
  } catch (err: any) {
    console.error('Failed to delete explorer:', err);
    return c.json({ success: false, error: { message: 'Failed to delete explorer', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// List subcategories for an explorer
explorerRouter.get('/:explorerId/subcategories', async (c) => {
  const explorerId = c.req.param('explorerId');
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(`
      SELECT s.*, m.file_path as image_path, m.bucket_name as image_bucket
      FROM homescreen_explorer_subcategories s
      LEFT JOIN media_assets m ON s.image_asset_id = m.id
      WHERE s.explorer_id = $1
      ORDER BY s.sort_order ASC, s.created_at DESC
    `, [explorerId]);
    return c.json({ success: true, data: res.rows });
  } catch (err: any) {
    console.error('Failed to list subcategories:', err);
    return c.json({ success: false, error: { message: 'Failed to list subcategories', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Create subcategory
explorerRouter.post('/:explorerId/subcategories', async (c) => {
  const explorerId = c.req.param('explorerId');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const { name, image_asset_id, background_color, category_id, sort_order, is_active } = body;

  if (!name || !name.trim()) {
    return c.json({ success: false, error: { message: 'Subcategory name is required', code: 'MISSING_NAME' } }, 400);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(
      `INSERT INTO homescreen_explorer_subcategories (explorer_id, name, image_asset_id, background_color, category_id, sort_order, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), COALESCE($7, true), NOW(), NOW())
       RETURNING *`,
      [explorerId, name.trim(), image_asset_id || null, background_color || '#FFF0F3', category_id || null, sort_order, is_active]
    );
    return c.json({ success: true, data: res.rows[0] }, 201);
  } catch (err: any) {
    console.error('Failed to create subcategory:', err);
    return c.json({ success: false, error: { message: 'Failed to create subcategory', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Update subcategory
explorerRouter.put('/subcategories/:id', async (c) => {
  const id = c.req.param('id');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const { name, image_asset_id, background_color, category_id, sort_order, is_active } = body;

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(
      `UPDATE homescreen_explorer_subcategories
       SET name = COALESCE($1, name),
           image_asset_id = CASE WHEN $2 = '__NULL__' THEN NULL ELSE COALESCE($2, image_asset_id) END,
           background_color = COALESCE($3, background_color),
           category_id = CASE WHEN $4 = '__NULL__' THEN NULL ELSE COALESCE($4, category_id) END,
           sort_order = COALESCE($5, sort_order),
           is_active = COALESCE($6, is_active),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        name?.trim(),
        image_asset_id === null ? '__NULL__' : (image_asset_id || null),
        background_color,
        category_id === null ? '__NULL__' : (category_id || null),
        sort_order,
        is_active,
        id,
      ]
    );

    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Subcategory not found', code: 'NOT_FOUND' } }, 404);
    }

    return c.json({ success: true, data: res.rows[0] });
  } catch (err: any) {
    console.error('Failed to update subcategory:', err);
    return c.json({ success: false, error: { message: 'Failed to update subcategory', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Delete subcategory
explorerRouter.delete('/subcategories/:id', async (c) => {
  const id = c.req.param('id');
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(`DELETE FROM homescreen_explorer_subcategories WHERE id = $1 RETURNING id`, [id]);
    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Subcategory not found', code: 'NOT_FOUND' } }, 404);
    }
    return c.json({ success: true, data: { id } });
  } catch (err: any) {
    console.error('Failed to delete subcategory:', err);
    return c.json({ success: false, error: { message: 'Failed to delete subcategory', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Get assigned games and questions for a subcategory
explorerRouter.get('/subcategories/:subId/games', async (c) => {
  const subId = c.req.param('subId');
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const [assignRes, qRes, rawAssignRes] = await Promise.all([
      dbClient.query(`
        SELECT g.*, c.name as category_name, c.slug as category_slug
        FROM subcategory_games sg
        JOIN games g ON sg.game_id = g.id
        LEFT JOIN game_categories c ON g.category_id = c.id
        WHERE sg.subcategory_id = $1 AND sg.is_active = true
        ORDER BY sg.sort_order ASC
      `, [subId]),
      dbClient.query(`
        SELECT game_id, subcategory_id FROM questions WHERE subcategory_id = $1
      `, [subId]),
      dbClient.query(`
        SELECT game_id, enabled_patterns, sort_order, is_active FROM subcategory_games WHERE subcategory_id = $1
      `, [subId]),
    ]);

    return c.json({
      success: true,
      data: {
        games: assignRes.rows.map((row: any) => ({
          ...row,
          category: row.category_id ? { id: row.category_id, name: row.category_name, slug: row.category_slug } : null,
        })),
        questions: qRes.rows,
        assignments: rawAssignRes.rows,
      }
    });
  } catch (err: any) {
    console.error('Failed to load subcategory games:', err);
    return c.json({ success: false, error: { message: 'Failed to load subcategory games', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Assign existing games to subcategory (upsert)
explorerRouter.post('/subcategories/assign-games', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const { subcategory_id, game_ids, start_sort_order } = body;
  if (!subcategory_id || !Array.isArray(game_ids)) {
    return c.json({ success: false, error: { message: 'Missing subcategory_id or game_ids', code: 'INVALID_PARAMS' } }, 400);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    await dbClient.query('BEGIN');

    let currentSort = start_sort_order || 0;
    for (const gId of game_ids) {
      currentSort++;
      await dbClient.query(`
        INSERT INTO subcategory_games (subcategory_id, game_id, sort_order, is_active, updated_at)
        VALUES ($1, $2, $3, true, NOW())
        ON CONFLICT (subcategory_id, game_id)
        DO UPDATE SET is_active = true, sort_order = EXCLUDED.sort_order, updated_at = NOW()
      `, [subcategory_id, gId, currentSort]);
    }

    await dbClient.query('COMMIT');
    return c.json({ success: true, data: { assigned: game_ids.length } });
  } catch (err: any) {
    if (dbClient) await dbClient.query('ROLLBACK').catch(() => {});
    console.error('Failed assigning games:', err);
    return c.json({ success: false, error: { message: err.message || 'Failed assigning games', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Create game and assign to subcategory atomically
explorerRouter.post('/subcategories/create-game-and-assign', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const { subcategory_id, name, slug, game_type, category_id, is_published, sort_order, config } = body;

  if (!name || !name.trim()) {
    return c.json({ success: false, error: { message: 'Game name is required', code: 'MISSING_NAME' } }, 400);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    await dbClient.query('BEGIN');

    const gameRes = await dbClient.query(`
      INSERT INTO games (name, slug, game_type, category_id, is_published, sort_order, config, created_at, updated_at)
      VALUES ($1, $2, COALESCE($3, 'multiple_choice'), $4, COALESCE($5, false), COALESCE($6, 0), COALESCE($7, '{}'::jsonb), NOW(), NOW())
      RETURNING *
    `, [name.trim(), slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), game_type, category_id || null, is_published, sort_order, JSON.stringify(config || { question_count: 5 })]);

    const newGame = gameRes.rows[0];

    await dbClient.query(`
      INSERT INTO subcategory_games (subcategory_id, game_id, sort_order, is_active, updated_at)
      VALUES ($1, $2, $3, true, NOW())
      ON CONFLICT (subcategory_id, game_id)
      DO UPDATE SET is_active = true, sort_order = EXCLUDED.sort_order, updated_at = NOW()
    `, [subcategory_id, newGame.id, sort_order || 1]);

    await dbClient.query('COMMIT');
    return c.json({ success: true, data: newGame }, 201);
  } catch (err: any) {
    if (dbClient) await dbClient.query('ROLLBACK').catch(() => {});
    console.error('Failed creating game and assigning:', err);
    return c.json({ success: false, error: { message: err.message || 'Failed creating game and assigning', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Save subcategory with games transactionally in Worker API
explorerRouter.post('/subcategories/save-with-games', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const {
    subcategory_id,
    explorer_id,
    name,
    image_asset_id,
    background_color,
    category_id,
    sort_order,
    is_active,
    assignments,
  } = body;

  if (!name || !name.trim()) {
    return c.json({ success: false, error: { message: 'Subcategory name is required', code: 'MISSING_NAME' } }, 400);
  }

  if (!explorer_id) {
    return c.json({ success: false, error: { message: 'Explorer ID is required', code: 'MISSING_EXPLORER_ID' } }, 400);
  }

  if (assignments !== undefined) {
    if (!Array.isArray(assignments)) {
      return c.json({ success: false, error: { message: 'Malformed assignments: expected JSON array', code: 'INVALID_ASSIGNMENTS' } }, 400);
    }

    const incomingGameIds = assignments.map((a: any) => a.game_id);
    if (new Set(incomingGameIds).size !== incomingGameIds.length) {
      return c.json({ success: false, error: { message: 'Duplicate game assignments are not allowed', code: 'DUPLICATE_ASSIGNMENT' } }, 400);
    }
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    await dbClient.query('BEGIN');

    let subId = subcategory_id;
    if (subId) {
      // Update existing subcategory
      const updateRes = await dbClient.query(
        `UPDATE homescreen_explorer_subcategories
         SET name = $1,
             image_asset_id = $2,
             background_color = COALESCE($3, background_color),
             category_id = $4,
             sort_order = COALESCE($5, sort_order),
             is_active = COALESCE($6, is_active),
             updated_at = NOW()
         WHERE id = $7 AND explorer_id = $8
         RETURNING id`,
        [name.trim(), image_asset_id || null, background_color, category_id || null, sort_order, is_active, subId, explorer_id]
      );
      if (updateRes.rows.length === 0) {
        await dbClient.query('ROLLBACK');
        return c.json({ success: false, error: { message: 'Subcategory not found or does not belong to explorer', code: 'NOT_FOUND' } }, 404);
      }
    } else {
      // Insert new subcategory
      const insertRes = await dbClient.query(
        `INSERT INTO homescreen_explorer_subcategories (explorer_id, name, image_asset_id, background_color, category_id, sort_order, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), COALESCE($7, true), NOW(), NOW())
         RETURNING id`,
        [explorer_id, name.trim(), image_asset_id || null, background_color || '#FFF0F3', category_id || null, sort_order, is_active]
      );
      subId = insertRes.rows[0].id;
    }

    // Synchronize game assignments only if assignments property is explicitly supplied (not undefined/omitted)
    if (assignments !== undefined) {
      await dbClient.query(`DELETE FROM subcategory_games WHERE subcategory_id = $1`, [subId]);

      let idx = 0;
      for (const assignment of assignments) {
        idx++;
        await dbClient.query(
          `INSERT INTO subcategory_games (subcategory_id, game_id, enabled_patterns, sort_order, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, COALESCE($4, $5), COALESCE($6, true), NOW(), NOW())
           ON CONFLICT (subcategory_id, game_id)
           DO UPDATE SET enabled_patterns = EXCLUDED.enabled_patterns, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active, updated_at = NOW()`,
          [
            subId,
            assignment.game_id,
            JSON.stringify(assignment.enabled_patterns || []),
            assignment.sort_order,
            idx,
            assignment.is_active,
          ]
        );
      }
    }

    await dbClient.query('COMMIT');
    return c.json({ success: true, data: { id: subId } });
  } catch (err: any) {
    if (dbClient) await dbClient.query('ROLLBACK').catch(() => {});
    console.error('Failed saving subcategory transaction:', err);
    return c.json({ success: false, error: { message: err.message || 'Failed saving subcategory', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

// Delete subcategory assignment
explorerRouter.delete('/subcategories/:subId/games/:gameId', async (c) => {
  const subId = c.req.param('subId');
  const gameId = c.req.param('gameId');
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    await dbClient.query(`DELETE FROM subcategory_games WHERE subcategory_id = $1 AND game_id = $2`, [subId, gameId]);
    return c.json({ success: true, data: { subcategory_id: subId, game_id: gameId } });
  } catch (err: any) {
    console.error('Failed to remove game assignment:', err);
    return c.json({ success: false, error: { message: 'Failed to remove game assignment', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    if (dbClient) {
      if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
        c.executionCtx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    }
  }
});

export default explorerRouter;
