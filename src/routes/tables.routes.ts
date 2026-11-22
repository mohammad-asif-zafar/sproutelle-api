/**
 * Sproutelle Admin Raw Database Explorer Routes
 * File: src/routes/tables.routes.ts
 */

import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import { requireAdmin } from '../middleware/auth';
import { getDbClient } from '../db/client';
import { safeCleanupDb } from '../db/cleanup';
import type { ApiResponse, PaginatedResult } from '../types/contract';

const tablesRouter = new Hono<AppEnv>();

tablesRouter.use('*', requireAdmin);

// Explicit allowlist of tables permitted for Raw Database Explorer
const ALLOWED_TABLES = new Set([
  'game_categories',
  'games',
  'game_levels',
  'questions',
  'question_options',
  'media_assets',
  'activity_media',
  'game_versions',
  'homescreen_explorer',
  'homescreen_explorer_subcategories',
  'subcategory_games',
  'game_releases',
]);

function validateTableName(table: string): boolean {
  return ALLOWED_TABLES.has(table.toLowerCase().trim());
}

// 1. SELECT LIST FROM TABLE
tablesRouter.get('/:table', async (c) => {
  const table = c.req.param('table');
  if (!validateTableName(table)) {
    return c.json({ success: false, error: { message: `Access to table '${table}' is not permitted`, code: 'FORBIDDEN_TABLE' } }, 400);
  }

  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = (page - 1) * limit;
  const search = (c.req.query('search') || '').trim();

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    // Get column names to build search query safely
    const colsRes = await dbClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `, [table]);

    const textCols = colsRes.rows
      .filter((col: any) => ['text', 'character varying', 'uuid'].includes(col.data_type))
      .map((col: any) => col.column_name);

    let whereClause = '';
    const queryParams: any[] = [];

    if (search && textCols.length > 0) {
      queryParams.push(`%${search}%`);
      const searchConditions = textCols.map((col: string) => `"${col}"::text ILIKE $1`).join(' OR ');
      whereClause = `WHERE (${searchConditions})`;
    }

    const countQuery = `SELECT COUNT(*)::int AS total FROM "${table}" ${whereClause}`;
    const countRes = await dbClient.query(countQuery, queryParams);
    const total = Number(countRes.rows[0]?.total || 0);

    const itemsQueryParams = [...queryParams, limit, offset];
    const limitIndex = queryParams.length + 1;
    const offsetIndex = queryParams.length + 2;

    const itemsQuery = `
      SELECT * FROM "${table}"
      ${whereClause}
      ORDER BY 1 DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;

    const itemsRes = await dbClient.query(itemsQuery, itemsQueryParams);

    const result: PaginatedResult<any> = {
      items: itemsRes.rows,
      total,
      page,
      pageSize: limit,
      hasMore: offset + itemsRes.rows.length < total,
    };

    const response: ApiResponse<PaginatedResult<any>> = {
      success: true,
      data: result,
    };

    return c.json(response);
  } catch (err: any) {
    console.error(`Failed querying table ${table}:`, err?.message || err);
    return c.json({
      success: false,
      error: { message: `Database error querying table '${table}': ${err.message || 'Error'}`, code: 'DATABASE_ERROR' }
    }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// 2. INSERT ROW INTO TABLE
tablesRouter.post('/:table', async (c) => {
  const table = c.req.param('table');
  if (!validateTableName(table)) {
    return c.json({ success: false, error: { message: `Access to table '${table}' is not permitted`, code: 'FORBIDDEN_TABLE' } }, 400);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const keys = Object.keys(body).filter((k) => body[k] !== undefined);
  if (keys.length === 0) {
    return c.json({ success: false, error: { message: 'Cannot insert empty record', code: 'EMPTY_PAYLOAD' } }, 400);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    const colNames = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(', ');
    const paramPlaceholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
    const values = keys.map((k) => body[k]);

    const insertSql = `
      INSERT INTO "${table}" (${colNames})
      VALUES (${paramPlaceholders})
      RETURNING *
    `;

    const res = await dbClient.query(insertSql, values);
    return c.json({ success: true, data: res.rows[0] }, 201);
  } catch (err: any) {
    console.error(`Failed inserting into table ${table}:`, err?.message || err);
    return c.json({
      success: false,
      error: { message: `Database error inserting into '${table}': ${err.message || 'Error'}`, code: 'DATABASE_ERROR' }
    }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// 3. UPDATE ROW IN TABLE
tablesRouter.put('/:table/:id', async (c) => {
  const table = c.req.param('table');
  const id = c.req.param('id');

  if (!validateTableName(table)) {
    return c.json({ success: false, error: { message: `Access to table '${table}' is not permitted`, code: 'FORBIDDEN_TABLE' } }, 400);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const keys = Object.keys(body).filter((k) => k !== 'id' && body[k] !== undefined);
  if (keys.length === 0) {
    return c.json({ success: false, error: { message: 'No fields provided to update', code: 'EMPTY_PAYLOAD' } }, 400);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    const setAssignments = keys.map((k, idx) => `"${k.replace(/"/g, '""')}" = $${idx + 1}`).join(', ');
    const values = keys.map((k) => body[k]);
    values.push(id);

    const idIndex = values.length;
    const updateSql = `
      UPDATE "${table}"
      SET ${setAssignments}
      WHERE id::text = $${idIndex}
      RETURNING *
    `;

    const res = await dbClient.query(updateSql, values);
    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: `Record not found in '${table}'`, code: 'NOT_FOUND' } }, 404);
    }

    return c.json({ success: true, data: res.rows[0] });
  } catch (err: any) {
    console.error(`Failed updating record in table ${table}:`, err?.message || err);
    return c.json({
      success: false,
      error: { message: `Database error updating '${table}': ${err.message || 'Error'}`, code: 'DATABASE_ERROR' }
    }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// 4. DELETE ROW FROM TABLE
tablesRouter.delete('/:table/:id', async (c) => {
  const table = c.req.param('table');
  const id = c.req.param('id');

  if (!validateTableName(table)) {
    return c.json({ success: false, error: { message: `Access to table '${table}' is not permitted`, code: 'FORBIDDEN_TABLE' } }, 400);
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    const deleteSql = `DELETE FROM "${table}" WHERE id::text = $1 RETURNING id`;
    const res = await dbClient.query(deleteSql, [id]);

    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: `Record not found in '${table}'`, code: 'NOT_FOUND' } }, 404);
    }

    return c.json({ success: true, data: { id } });
  } catch (err: any) {
    console.error(`Failed deleting record from table ${table}:`, err?.message || err);
    return c.json({
      success: false,
      error: { message: `Database error deleting from '${table}': ${err.message || 'Error'}`, code: 'DATABASE_ERROR' }
    }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

export default tablesRouter;
