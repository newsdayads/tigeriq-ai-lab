/** Canonical filename for the first V2 downloadable APK. */
export const FIRST_V2_APK_NAME: string;
/** Returns 0..9999 for valid names, or null otherwise. */
export function parseV2ApkName(name: unknown): number | null;
/** Format a zero-based release sequence (0..9999). */
export function formatV2ApkName(sequence: number): string;
/** Find next unused sequential V2 APK filename from existing Drive titles. */
export function nextV2ApkName(existingNames: string[]): string;
