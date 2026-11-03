import type { RemoteResponse } from "../src/shared/types";
export function analyzeDataset(
  feature: string,
  payload: Record<string, unknown>,
  options?: { dataDir?: string; now?: number },
): Promise<RemoteResponse>;
