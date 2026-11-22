import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import { getPocAuth } from '../auth-poc/poc-auth';

const pocAuthRouter = new Hono<AppEnv>();

// Fail-closed development-only route guard
pocAuthRouter.use('*', async (c, next) => {
  const envName = c.env?.ENVIRONMENT;
  if (envName !== 'development') {
    return c.json({
      success: false,
      error: {
        message: 'Not Found'
      }
    }, 404);
  }
  await next();
});

pocAuthRouter.on(['GET', 'POST'], '/*', (c) => {
  const auth = getPocAuth(c.env);
  return auth.handler(c.req.raw);
});

export default pocAuthRouter;
