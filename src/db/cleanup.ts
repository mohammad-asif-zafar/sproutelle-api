import { Client } from 'pg';
import type { Context } from 'hono';

export function safeCleanupDb(c: Context | any, dbClient: Client | any) {
  if (dbClient) {
    try {
      const ctx = c.executionCtx;
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
