import type { UserSession } from '../types/contract';

export interface CloudflareBindings {
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  HYPERDRIVE: Hyperdrive;
  MEDIA_BUCKET: R2Bucket;
  MEDIA_BUCKET_NAME?: string;
  PUBLIC_MEDIA_URL?: string;
  NEON_HTTP_URL?: string;
  BETTER_AUTH_URL?: string;
  NEON_AUTH_BASE_URL?: string;
  NEON_AUTH_JWKS_URL?: string;
}

export interface CustomVariables {
  user?: UserSession;
  session?: unknown;
}

export interface AppEnv {
  Bindings: CloudflareBindings;
  Variables: CustomVariables;
}
