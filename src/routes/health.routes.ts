import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import { getDbClient } from '../db/client';

const healthRouter = new Hono<AppEnv>();

healthRouter.get('/', (c) => {
  return c.json({
    success: true,
    data: {
      service: 'sproutelle-api',
      status: 'healthy',
      environment: c.env.ENVIRONMENT || 'development'
    }
  });
});

healthRouter.get('/database', async (c) => {
  try {
    const client = await getDbClient(c.env);

    // Execute a simple query to verify connectivity
    const result = await client.query('SELECT NOW() AS current_time');

    return c.json({
      success: true,
      data: {
        status: 'healthy',
        time: result.rows[0].current_time
      }
    });
  } catch (error) {
    console.error('Database connection failed:', error);
    return c.json({
      success: false,
      error: {
        message: 'Database connection failed'
      }
    }, 503);
  }
});

export default healthRouter;
