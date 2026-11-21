export interface CloudflareBindings {
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  HYPERDRIVE: Hyperdrive;
}

export interface AppEnv {
  Bindings: CloudflareBindings;
}
