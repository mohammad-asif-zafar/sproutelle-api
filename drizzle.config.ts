import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/auth/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.NEON_HTTP_URL || 'postgresql://dummy:dummy@localhost:5432/dummy',
  },
});
