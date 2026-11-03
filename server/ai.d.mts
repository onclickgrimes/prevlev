import type { RemoteResponse } from "../src/shared/types";
import type { BackendConfig } from "./index.mjs";
export function isAiFeature(feature: string): boolean;
export function validateProvider(baseUrl: string): string;
export function analyzeAi(
  feature: string,
  payload: Record<string, unknown>,
  config: BackendConfig,
  fetcher?: typeof fetch,
): Promise<RemoteResponse>;
