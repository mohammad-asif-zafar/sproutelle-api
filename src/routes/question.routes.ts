/**
 * Sproutelle Admin Game Questions, Options & Levels Routes
 * File: src/routes/question.routes.ts
 */

import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import { requireAdmin } from '../middleware/auth';
import { getDbClient } from '../db/client';

const questionRouter = new Hono<AppEnv>();

questionRouter.use('*', requireAdmin);

function safeCleanupDb(c: any, dbClient: any) {
  if (dbClient) {
    try {
      const ctx = (c as any).executionCtx;
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(dbClient.end());
      } else {
        dbClient.end().catch(() => {});
      }
    } catch {
      dbClient.end().catch(() => {});
    }
  }
}

// Get game details, levels, and questions with options
questionRouter.get('/:gameId/details', async (c) => {
  const gameId = c.req.param('gameId');
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const [gameRes, levelsRes, qRes] = await Promise.all([
      dbClient.query('SELECT * FROM games WHERE id = $1 LIMIT 1', [gameId]),
      dbClient.query('SELECT * FROM game_levels WHERE game_id = $1 ORDER BY level_number ASC, sort_order ASC', [gameId]),
      dbClient.query(`
        SELECT q.*,
               img.file_path as image_path, img.bucket_name as image_bucket,
               aud.file_path as audio_path, aud.bucket_name as audio_bucket
        FROM questions q
        LEFT JOIN media_assets img ON q.image_asset_id = img.id
        LEFT JOIN media_assets aud ON q.audio_asset_id = aud.id
        WHERE q.game_id = $1
        ORDER BY q.sort_order ASC, q.created_at DESC
      `, [gameId]),
    ]);

    if (gameRes.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Game not found', code: 'NOT_FOUND' } }, 404);
    }

    const questions = qRes.rows;
    const questionIds = questions.map((q: any) => q.id);

    let optionsMap = new Map<string, any[]>();
    if (questionIds.length > 0) {
      const optsRes = await dbClient.query(`
        SELECT o.*, m.file_path as media_path, m.bucket_name as media_bucket
        FROM question_options o
        LEFT JOIN media_assets m ON o.media_asset_id = m.id
        WHERE o.question_id = ANY($1::uuid[])
        ORDER BY o.sort_order ASC
      `, [questionIds]);

      optsRes.rows.forEach((opt: any) => {
        const list = optionsMap.get(opt.question_id) || [];
        list.push({
          ...opt,
          media_asset: opt.media_asset_id ? { id: opt.media_asset_id, file_path: opt.media_path, bucket_name: opt.media_bucket } : null,
        });
        optionsMap.set(opt.question_id, list);
      });
    }

    const enrichedQuestions = questions.map((q: any) => ({
      ...q,
      options: optionsMap.get(q.id) || [],
      image_asset: q.image_asset_id ? { id: q.image_asset_id, file_path: q.image_path, bucket_name: q.image_bucket } : null,
      audio_asset: q.audio_asset_id ? { id: q.audio_asset_id, file_path: q.audio_path, bucket_name: q.audio_bucket } : null,
    }));

    return c.json({
      success: true,
      data: {
        game: gameRes.rows[0],
        levels: levelsRes.rows,
        questions: enrichedQuestions,
      }
    });
  } catch (err: any) {
    console.error('Failed loading game details:', err);
    return c.json({ success: false, error: { message: 'Failed loading game details', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// Helper for strict integer sort order parsing
function parseIntegerSortOrder(val: unknown, fallback: number, allowUndefinedFallback = true): { value?: number; error?: string } {
  if (val === undefined) {
    return allowUndefinedFallback ? { value: fallback } : { error: 'sort_order is required' };
  }
  if (val === null || typeof val === 'boolean' || Array.isArray(val) || (typeof val === 'object' && val !== null)) {
    return { error: 'sort_order must be a valid integer' };
  }
  if (typeof val === 'string' && val.trim() === '') {
    return { error: 'sort_order cannot be empty or whitespace' };
  }
  const num = Number(val);
  if (!Number.isInteger(num) || !Number.isFinite(num)) {
    return { error: 'sort_order must be a valid integer' };
  }
  return { value: num };
}

// Create question with options transactionally
questionRouter.post('/:gameId/questions', async (c) => {
  const gameId = c.req.param('gameId');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const {
    subcategory_id,
    level_id,
    question_text,
    question_type,
    instructions,
    sort_order,
    is_draft,
    config,
    image_asset_id,
    audio_asset_id,
    options,
  } = body;

  if (!question_text || !question_text.trim()) {
    return c.json({ success: false, error: { message: 'Question text is required', code: 'MISSING_PROMPT' } }, 400);
  }

  const qSortResult = parseIntegerSortOrder(sort_order, 0);
  if (qSortResult.error) {
    return c.json({ success: false, error: { message: qSortResult.error, code: 'INVALID_SORT_ORDER' } }, 400);
  }
  const parsedQSort = qSortResult.value!;

  const parsedOptions: Array<{ option_text: string; is_correct: boolean; sort_order: number; media_asset_id: string | null }> = [];
  if (Array.isArray(options) && options.length > 0) {
    let optIdx = 0;
    for (const opt of options) {
      optIdx++;
      const optSortResult = parseIntegerSortOrder(opt.sort_order, optIdx);
      if (optSortResult.error) {
        return c.json({ success: false, error: { message: `Option sort_order must be a valid integer`, code: 'INVALID_SORT_ORDER' } }, 400);
      }
      parsedOptions.push({
        option_text: opt.option_text || '',
        is_correct: opt.is_correct ?? false,
        sort_order: optSortResult.value!,
        media_asset_id: opt.media_asset_id || null,
      });
    }
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    await dbClient.query('BEGIN');

    const qRes = await dbClient.query(`
      INSERT INTO questions (game_id, subcategory_id, level_id, question_text, question_type, instructions, sort_order, is_draft, config, image_asset_id, audio_asset_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, COALESCE($5::text, 'picture_quest'), $6, COALESCE($7::integer, 0), COALESCE($8::boolean, true), COALESCE($9::jsonb, '{}'::jsonb), $10, $11, NOW(), NOW())
      RETURNING *
    `, [
      gameId,
      subcategory_id || null,
      level_id || null,
      question_text.trim(),
      question_type || 'picture_quest',
      instructions || null,
      parsedQSort,
      is_draft ?? true,
      config ? JSON.stringify(config) : '{}',
      image_asset_id || null,
      audio_asset_id || null,
    ]);

    const newQuestion = qRes.rows[0];

    for (const opt of parsedOptions) {
      await dbClient.query(`
        INSERT INTO question_options (question_id, option_text, is_correct, sort_order, media_asset_id)
        VALUES ($1, $2, COALESCE($3::boolean, false), $4::integer, $5)
      `, [
        newQuestion.id,
        opt.option_text,
        opt.is_correct,
        opt.sort_order,
        opt.media_asset_id,
      ]);
    }

    await dbClient.query('COMMIT');
    return c.json({ success: true, data: newQuestion }, 201);
  } catch (err: any) {
    if (dbClient) await dbClient.query('ROLLBACK').catch(() => {});
    console.error('Failed creating question:', err);
    return c.json({ success: false, error: { message: err.message || 'Failed creating question', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// Update question and replace options transactionally
questionRouter.put('/:gameId/questions/:qId', async (c) => {
  const gameId = c.req.param('gameId');
  const qId = c.req.param('qId');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const {
    subcategory_id,
    level_id,
    question_text,
    question_type,
    instructions,
    sort_order,
    is_draft,
    config,
    image_asset_id,
    audio_asset_id,
    options,
  } = body;

  let parsedQSort: number | null = null;
  if (sort_order !== undefined) {
    const qSortResult = parseIntegerSortOrder(sort_order, 0);
    if (qSortResult.error) {
      return c.json({ success: false, error: { message: qSortResult.error, code: 'INVALID_SORT_ORDER' } }, 400);
    }
    parsedQSort = qSortResult.value!;
  }

  const parsedOptions: Array<{ option_text: string; is_correct: boolean; sort_order: number; media_asset_id: string | null }> = [];
  if (Array.isArray(options)) {
    let optIdx = 0;
    for (const opt of options) {
      optIdx++;
      const optSortResult = parseIntegerSortOrder(opt.sort_order, optIdx);
      if (optSortResult.error) {
        return c.json({ success: false, error: { message: `Option sort_order must be a valid integer`, code: 'INVALID_SORT_ORDER' } }, 400);
      }
      parsedOptions.push({
        option_text: opt.option_text || '',
        is_correct: opt.is_correct ?? false,
        sort_order: optSortResult.value!,
        media_asset_id: opt.media_asset_id || null,
      });
    }
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    await dbClient.query('BEGIN');

    const qRes = await dbClient.query(`
      UPDATE questions
      SET subcategory_id = COALESCE($1, subcategory_id),
          level_id = CASE WHEN $2 = '__NULL__' THEN NULL ELSE COALESCE($2, level_id) END,
          question_text = COALESCE($3, question_text),
          question_type = COALESCE($4, question_type),
          instructions = CASE WHEN $5 = '__NULL__' THEN NULL ELSE COALESCE($5, instructions) END,
          sort_order = COALESCE($6::integer, sort_order),
          is_draft = COALESCE($7::boolean, is_draft),
          config = COALESCE($8::jsonb, config),
          image_asset_id = CASE WHEN $9 = '__NULL__' THEN NULL ELSE COALESCE($9, image_asset_id) END,
          audio_asset_id = CASE WHEN $10 = '__NULL__' THEN NULL ELSE COALESCE($10, audio_asset_id) END,
          updated_at = NOW()
      WHERE id = $11 AND game_id = $12
      RETURNING *
    `, [
      subcategory_id,
      level_id === null ? '__NULL__' : (level_id || null),
      question_text?.trim(),
      question_type,
      instructions === null ? '__NULL__' : (instructions || null),
      parsedQSort,
      is_draft,
      config ? JSON.stringify(config) : null,
      image_asset_id === null ? '__NULL__' : (image_asset_id || null),
      audio_asset_id === null ? '__NULL__' : (audio_asset_id || null),
      qId,
      gameId,
    ]);

    if (qRes.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      return c.json({ success: false, error: { message: 'Question not found', code: 'NOT_FOUND' } }, 404);
    }

    const updatedQ = qRes.rows[0];

    // Replace options if provided
    if (Array.isArray(options)) {
      await dbClient.query(`DELETE FROM question_options WHERE question_id = $1`, [qId]);

      for (const opt of parsedOptions) {
        await dbClient.query(`
          INSERT INTO question_options (question_id, option_text, is_correct, sort_order, media_asset_id)
          VALUES ($1, $2, COALESCE($3::boolean, false), $4::integer, $5)
        `, [
          qId,
          opt.option_text,
          opt.is_correct,
          opt.sort_order,
          opt.media_asset_id,
        ]);
      }
    }

    await dbClient.query('COMMIT');
    return c.json({ success: true, data: updatedQ });
  } catch (err: any) {
    if (dbClient) await dbClient.query('ROLLBACK').catch(() => {});
    console.error('Failed updating question:', err);
    return c.json({ success: false, error: { message: err.message || 'Failed updating question', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// Delete question
questionRouter.delete('/:gameId/questions/:qId', async (c) => {
  const gameId = c.req.param('gameId');
  const qId = c.req.param('qId');
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(`DELETE FROM questions WHERE id = $1 AND game_id = $2 RETURNING id`, [qId, gameId]);
    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Question not found', code: 'NOT_FOUND' } }, 404);
    }
    return c.json({ success: true, data: { id: qId } });
  } catch (err: any) {
    console.error('Failed to delete question:', err);
    return c.json({ success: false, error: { message: 'Failed to delete question', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// Create level
questionRouter.post('/:gameId/levels', async (c) => {
  const gameId = c.req.param('gameId');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const { level_number, title, description, pass_score, sort_order } = body;

  const levelNumResult = parseIntegerSortOrder(level_number, NaN, false);
  if (levelNumResult.error || isNaN(levelNumResult.value!)) {
    return c.json({ success: false, error: { message: 'Level number is required and must be a valid integer', code: 'INVALID_LEVEL_NUMBER' } }, 400);
  }
  const parsedLevelNum = levelNumResult.value!;

  const passScoreResult = parseIntegerSortOrder(pass_score, 80);
  if (passScoreResult.error) {
    return c.json({ success: false, error: { message: 'Pass score must be a valid integer', code: 'INVALID_PASS_SCORE' } }, 400);
  }
  const parsedPassScore = passScoreResult.value!;

  const sortResult = parseIntegerSortOrder(sort_order, parsedLevelNum);
  if (sortResult.error) {
    return c.json({ success: false, error: { message: 'Sort order must be a valid integer', code: 'INVALID_SORT_ORDER' } }, 400);
  }
  const parsedSort = sortResult.value!;

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(`
      INSERT INTO game_levels (game_id, level_number, title, description, pass_score, sort_order, created_at)
      VALUES ($1, $2::integer, $3, $4, $5::integer, $6::integer, NOW())
      RETURNING *
    `, [gameId, parsedLevelNum, title || `Level ${parsedLevelNum}`, description || null, parsedPassScore, parsedSort]);
    return c.json({ success: true, data: res.rows[0] }, 201);
  } catch (err: any) {
    console.error('Failed to create level:', err);
    return c.json({ success: false, error: { message: err.message || 'Failed to create level', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
});

// Update level (supports both /:gameId/levels/:id and /levels/:id)
const updateLevelHandler = async (c: any) => {
  const id = c.req.param('id');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: { message: 'Invalid JSON payload', code: 'INVALID_PAYLOAD' } }, 400);
  }

  const { level_number, title, description, pass_score, sort_order } = body;

  let parsedLevelNum: number | null = null;
  if (level_number !== undefined) {
    const res = parseIntegerSortOrder(level_number, 0, false);
    if (res.error) return c.json({ success: false, error: { message: 'Level number must be an integer', code: 'INVALID_LEVEL_NUMBER' } }, 400);
    parsedLevelNum = res.value!;
  }

  let parsedPassScore: number | null = null;
  if (pass_score !== undefined) {
    const res = parseIntegerSortOrder(pass_score, 80);
    if (res.error) return c.json({ success: false, error: { message: 'Pass score must be an integer', code: 'INVALID_PASS_SCORE' } }, 400);
    parsedPassScore = res.value!;
  }

  let parsedSort: number | null = null;
  if (sort_order !== undefined) {
    const res = parseIntegerSortOrder(sort_order, 0);
    if (res.error) return c.json({ success: false, error: { message: 'Sort order must be an integer', code: 'INVALID_SORT_ORDER' } }, 400);
    parsedSort = res.value!;
  }

  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(`
      UPDATE game_levels
      SET level_number = COALESCE($1::integer, level_number),
          title = COALESCE($2, title),
          description = CASE WHEN $3 = '__NULL__' THEN NULL ELSE COALESCE($3, description) END,
          pass_score = COALESCE($4::integer, pass_score),
          sort_order = COALESCE($5::integer, sort_order)
      WHERE id = $6
      RETURNING *
    `, [
      parsedLevelNum,
      title,
      description === null ? '__NULL__' : (description || null),
      parsedPassScore,
      parsedSort,
      id,
    ]);

    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Level not found', code: 'NOT_FOUND' } }, 404);
    }
    return c.json({ success: true, data: res.rows[0] });
  } catch (err: any) {
    console.error('Failed to update level:', err);
    return c.json({ success: false, error: { message: 'Failed to update level', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
};

questionRouter.put('/levels/:id', updateLevelHandler);
questionRouter.put('/:gameId/levels/:id', updateLevelHandler);

// Delete level (supports both /:gameId/levels/:id and /levels/:id)
const deleteLevelHandler = async (c: any) => {
  const id = c.req.param('id');
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);
    const res = await dbClient.query(`DELETE FROM game_levels WHERE id = $1 RETURNING id`, [id]);
    if (res.rows.length === 0) {
      return c.json({ success: false, error: { message: 'Level not found', code: 'NOT_FOUND' } }, 404);
    }
    return c.json({ success: true, data: { id } });
  } catch (err: any) {
    console.error('Failed to delete level:', err);
    return c.json({ success: false, error: { message: 'Failed to delete level', code: 'DATABASE_ERROR' } }, 500);
  } finally {
    safeCleanupDb(c, dbClient);
  }
};

questionRouter.delete('/levels/:id', deleteLevelHandler);
questionRouter.delete('/:gameId/levels/:id', deleteLevelHandler);

export default questionRouter;
