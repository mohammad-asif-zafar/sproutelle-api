import { describe, it, expect } from 'vitest';
import app from '../app';

describe('Sproutelle API Security & Route Integration Tests', () => {
  const envDev = {
    ENVIRONMENT: 'development',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    HYPERDRIVE: {} as any,
    NEON_HTTP_URL: 'postgresql://mock:mock@localhost:5432/mock',
    BETTER_AUTH_URL: 'http://localhost:8787',
  };

  const envProd = {
    ENVIRONMENT: 'production',
    ALLOWED_ORIGINS: 'https://admin.sproutelle.com',
    HYPERDRIVE: {} as any,
    NEON_HTTP_URL: 'postgresql://mock:mock@localhost:5432/mock',
    BETTER_AUTH_URL: 'https://api.sproutelle.com',
  };

  it('GET /api/health should return 200 OK without authentication', async () => {
    const res = await app.request('/api/health', {}, envDev);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.service).toBe('sproutelle-api');
  });

  it('GET /api/auth-poc/ok should return 404 in production environment (fail closed)', async () => {
    const res = await app.request('/api/auth-poc/ok', {}, envProd);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('Not Found');
  });

  it('GET /api/admin/dashboard/metrics should return 401 Unauthorized when no session cookie is provided', async () => {
    const res = await app.request('/api/admin/dashboard/metrics', {}, envDev);
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/auth/get-session should return 401 UNAAUTHENTICATED when unauthenticated', async () => {
    const res = await app.request('/api/auth/get-session', {}, envDev);
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('CORS preflight OPTIONS request should set Access-Control-Allow-Credentials: true for allowed origin', async () => {
    const res = await app.request(
      '/api/auth/get-session',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'GET',
        },
      },
      envDev
    );

    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});
