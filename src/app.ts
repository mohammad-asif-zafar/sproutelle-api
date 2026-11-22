import { Hono } from 'hono';
import type { AppEnv } from './config/env';
import { corsMiddleware } from './middleware/cors';
import healthRouter from './routes/health.routes';
import authRouter from './routes/auth.routes';
import adminRouter from './routes/admin.routes';
import mediaRouter from './routes/media.routes';
import explorerRouter from './routes/explorer.routes';
import questionRouter from './routes/question.routes';
import pocAuthRouter from './routes/auth.poc.routes';

const app = new Hono<AppEnv>();

// Middleware
app.use('*', corsMiddleware);

// Routes (Specific subpaths mounted before parent /api/admin)
app.route('/api/health', healthRouter);
app.route('/api/auth', authRouter);
app.route('/api/admin/media', mediaRouter);
app.route('/api/admin/explorers', explorerRouter);
app.route('/api/admin/games', questionRouter);
app.route('/api/admin', adminRouter);
app.route('/api/media', mediaRouter);
app.route('/api/auth-poc', pocAuthRouter);

// Standard Error Handling
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      message: 'Not Found'
    }
  }, 404);
});

app.onError((err, c) => {
  console.error('Unhandled Server Error:', err);
  return c.json({
    success: false,
    error: {
      message: 'Internal Server Error'
    }
  }, 500);
});

export default app;
