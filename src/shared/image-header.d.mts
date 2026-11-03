export type StillImageType = 'image/png' | 'image/jpeg' | 'image/webp';
export interface ImageInfo { type: StillImageType; width: number; height: number; bytes: number; }
export interface ImageHeaderOptions { maxBytes?: number; maxPixels?: number; maxDimension?: number; check?: () => void; }
export const IMAGE_LIMITS: Readonly<{ maxBytes: number; maxPixels: number; maxDimension: number }>;
export const STILL_IMAGE_TYPES: readonly StillImageType[];
export function inspectImageBytes(input: ArrayBuffer | Uint8Array, declaredType: string, options?: ImageHeaderOptions): ImageInfo;
