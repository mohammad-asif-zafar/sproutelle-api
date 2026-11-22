import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * Creates a stateless Neon HTTP Drizzle instance for Better Auth
 */
export function getAuthDb(connectionString: string) {
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}
