import type { RemoteResponse } from "../src/shared/types";
export interface OmniConfig {
  omniBaseUrl?: string;
  omniApiKey?: string;
  omniTimeoutMs?: number;
}
export interface OmniModel {
  id: string;
  provider: string;
  label: string;
  inputModalities: string[];
  outputModalities: string[];
  operations: string[];
  streaming: boolean;
  textSupported: boolean;
  imageSupported: boolean;
}
export function validateOmniBase(value?: string): string;
export function discoverOmni(
  config?: OmniConfig,
  fetcher?: typeof fetch,
): Promise<RemoteResponse>;
export function analyzeOmni(
  feature: string,
  payload: Record<string, unknown>,
  config?: OmniConfig,
  fetcher?: typeof fetch,
): Promise<RemoteResponse>;
