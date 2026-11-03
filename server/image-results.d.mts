export const SERVER_IMAGE_MAX_BYTES: number;
export class ImageResultError extends Error {}
export interface CheckedImageDescriptor { base64: string; mime: "image/png" | "image/jpeg" | "image/webp"; }
export function imageDescriptorFromBytes(value: Uint8Array, mime?: string): CheckedImageDescriptor;
export function imageDescriptorFromBase64(value: unknown, mime?: string): CheckedImageDescriptor;
export function directProviderImageDescriptor(result: unknown): CheckedImageDescriptor;
