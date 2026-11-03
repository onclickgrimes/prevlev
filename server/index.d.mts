import type { Server } from "node:http";
export interface BackendConfig {
  bind?: string;
  port?: number;
  token?: string;
  allowedOrigins?: string[];
  dataDir?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiImageModel?: string;
  aiTimeoutMs?: number;
}
export function createPrevlevServer(
  options?: BackendConfig,
  dependencies?: { fetcher?: typeof fetch },
): Server;
export function configFromEnv(env?: NodeJS.ProcessEnv): BackendConfig;
