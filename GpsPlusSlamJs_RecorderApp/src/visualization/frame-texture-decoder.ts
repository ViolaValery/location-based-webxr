/**
 * Frame texture decoder — F3.5b of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 *
 * Decodes a JPEG blob into a `THREE.Texture` via `createImageBitmap`.
 * Compatible with the `decodeTexture` slot of
 * [`wireFrameTileSubscribers`](./wire-frame-tile-subscribers.ts).
 *
 * Returns `null` (never throws) when:
 *   - `createImageBitmap` is unavailable in the runtime
 *   - the blob cannot be decoded as an image
 *
 * Soft-failure semantics let the wirer drop broken frames in the
 * field-recording corpus without surfacing errors to the user.
 */

import * as THREE from 'three';

export async function decodeFrameTexture(
  blob: Blob
): Promise<THREE.Texture | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const texture = new THREE.Texture(bitmap);
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}
