import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import { requireAdmin } from '../middleware/auth';
import { getDbClient } from '../db/client';
import type { ApiResponse, DashboardMetrics } from '../types/contract';

const adminRouter = new Hono<AppEnv>();

// Apply requireAdmin middleware to all admin endpoints
adminRouter.use('*', requireAdmin);

// Dashboard Metrics Endpoint
adminRouter.get('/dashboard/metrics', async (c) => {
  let dbClient;
  try {
    dbClient = await getDbClient(c.env);

    // Exact count queries & actual timestamp history from Neon
    const [mediaRes, catRes, gamesRes, questRes, verRes, recentRes] = await Promise.all([
      dbClient.query('SELECT COUNT(*)::int AS count FROM media_assets'),
      dbClient.query('SELECT COUNT(*)::int AS count FROM game_categories'),
      dbClient.query('SELECT COUNT(*)::int AS count FROM games'),
      dbClient.query('SELECT COUNT(*)::int AS count FROM questions'),
      dbClient.query('SELECT COUNT(*)::int AS count FROM game_versions'),
      dbClient.query(`
        SELECT 'game' AS type, id, name AS title, created_at AS timestamp FROM games WHERE created_at IS NOT NULL
        UNION ALL
        SELECT 'media' AS type, id, name AS title, created_at AS timestamp FROM media_assets WHERE created_at IS NOT NULL
        UNION ALL
        SELECT 'question' AS type, id, question_text AS title, created_at AS timestamp FROM questions WHERE created_at IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 10
      `),
    ]);

    const recentChanges = recentRes.rows
      .filter((r: any) => r.timestamp !== null && r.timestamp !== undefined)
      .map((r: any) => ({
        id: String(r.id),
        type: String(r.type),
        title: String(r.title || ''),
        timestamp: new Date(r.timestamp).toISOString(), // Strictly actual DB timestamp
      }));

    const metrics: DashboardMetrics = {
      totalMediaAssets: Number(mediaRes.rows[0]?.count || 0),
      totalCategories: Number(catRes.rows[0]?.count || 0),
      totalGames: Number(gamesRes.rows[0]?.count || 0),
      totalQuestions: Number(questRes.rows[0]?.count || 0),
      totalGameVersions: Number(verRes.rows[0]?.count || 0),
      recentChanges,
    };

    const response: ApiResponse<DashboardMetrics> = {
      success: true,
      data: metrics,
    };

    return c.json(response);
  } catch (err: any) {
    console.error('Failed to fetch dashboard metrics:', err);
    const errorResponse: ApiResponse<never> = {
      success: false,
      error: {
        message: 'Failed to retrieve dashboard metrics from database',
        code: 'DATABASE_ERROR',
      },
    };
    return c.json(errorResponse, 500);
  } finally {
    if (dbClient) {
      c.executionCtx.waitUntil(dbClient.end());
    }
  }
});

export default adminRouter;
