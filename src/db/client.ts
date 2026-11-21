import { Client } from 'pg';
import type { AppEnv } from '../config/env';

/**
 * Creates and connects a new PostgreSQL client using the Hyperdrive connection string.
 *
 * NOTE: Cloudflare Workers are ephemeral. Hyperdrive maintains the connection pool
 * globally across workers. You must create a new client per request.
 * Cloudflare automatically cleans up the connection when the request invocation ends.
 */
export async function getDbClient(env: AppEnv['Bindings']): Promise<Client> {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
  });

  await client.connect();
  return client;
}
