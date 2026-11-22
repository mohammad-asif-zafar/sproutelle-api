import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

// We initialize Drizzle here. In Cloudflare Workers with Neon HTTP,
// this is stateless and safe to create globally.
export function getPocDb(connectionString: string) {
  const sql = neon(connectionString);
  return drizzle(sql);
}
