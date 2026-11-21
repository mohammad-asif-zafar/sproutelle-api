import { Hono } from 'hono';
import type { AppEnv } from './config/env';
import { corsMiddleware } from './middleware/cors';
import healthRouter from './routes/health.routes';

const app = new Hono<AppEnv>();

// Middleware
app.use('*', corsMiddleware);

// Routes
app.route('/api/health', healthRouter);

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
