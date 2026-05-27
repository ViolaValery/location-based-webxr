/**
 * Wire the `FrameTileVisualizer` to the recorder store.
 *
 * Background — F3.4 from
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md):
 * subscribes to `state.framesInScene.frames`; for every newly observed
 * `imageFile`, fetches its blob from the injected `blobSource`,
 * applies a minimum-size threshold to skip broken/empty frames,
 * decodes the blob into a `THREE.Texture` via the injected
 * `decodeTexture`, and hands it to `visualizer.addTile`.
 *
 * Following the F1 store-swap pattern, the wirer uses a {@link StoreRef}
 * so it can re-attach to the new store after the recorder swaps stores
 * (Start Recording / Replay). On every swap the visualizer is cleared
 * and the processed-set is reset.
 *
 * Texture decoding is injected (not hard-coded) so unit tests can run
 * in jsdom without `createImageBitmap`. Production callers
 * (`main.ts`, `replay-mode.ts`) wire the real
 * `createImageBitmap`-based decoder.
 */

import type * as THREE from 'three';

import type { FrameInScene } from '../state/frames-in-scene-slice';
import type { RecorderStore } from '../state/recorder-store';
import type { StoreRef } from '../state/store-ref';

/**
 * Default minimum byte threshold below which a frame blob is treated
 * as broken/empty and skipped. Initial heuristic — the F3.6 corpus
 * test calibrates this against the field-recording fixture.
 */
/**
 * Default minimum byte threshold below which a frame blob is treated
 * as broken/empty and skipped. Internal default — F3.5 wirers may
 * override via `minFrameBytes`; F3.6 will calibrate against the
 * field-recording corpus.
 */
const DEFAULT_MIN_FRAME_BYTES = 2000;

interface FrameTileVisualizerLike {
  addTile(frame: FrameInScene, texture: THREE.Texture): void;
  clear(): void;
}

export interface WireFrameTileSubscribersOptions {
  readonly storeRef: StoreRef<RecorderStore>;
  readonly visualizer: FrameTileVisualizerLike;
  readonly blobSource: (imageFile: string) => Promise<Blob | null>;
  readonly decodeTexture: (blob: Blob) => Promise<THREE.Texture | null>;
  /** Defaults to {@link DEFAULT_MIN_FRAME_BYTES}. */
  readonly minFrameBytes?: number;
  readonly onError?: (err: unknown, imageFile: string) => void;
}

/**
 * Attach the wiring. Returns a dispose function that detaches both the
 * per-store subscription and the swap listener.
 */
export function wireFrameTileSubscribers(
  options: WireFrameTileSubscribersOptions
): () => void {
  const {
    storeRef,
    visualizer,
    blobSource,
    decodeTexture,
    minFrameBytes = DEFAULT_MIN_FRAME_BYTES,
    onError,
  } = options;

  let disposed = false;

  const attach = (store: RecorderStore): (() => void) => {
    const processed = new Set<string>();
    let lastFrames: readonly FrameInScene[] =
      store.getState().framesInScene.frames;

    const handleFrame = (frame: FrameInScene): void => {
      if (disposed) return;
      if (processed.has(frame.imageFile)) return;
      processed.add(frame.imageFile);

      void (async () => {
        try {
          const blob = await blobSource(frame.imageFile);
          if (disposed || !blob || blob.size < minFrameBytes) return;
          const texture = await decodeTexture(blob);
          if (disposed || !texture) return;
          visualizer.addTile(frame, texture);
        } catch (err) {
          onError?.(err, frame.imageFile);
        }
      })();
    };

    // Seed with any frames already present at attach time.
    for (const frame of lastFrames) handleFrame(frame);

    return store.subscribe(() => {
      const next = store.getState().framesInScene.frames;
      if (next === lastFrames) return;
      // Append-only slice: any new entries are at the tail past
      // `lastFrames.length`. Defensive bound in case the slice is
      // reset (length shrinks) — we just rebase and skip nothing
      // because `processed` already covers the prior set.
      const startIndex =
        next.length >= lastFrames.length ? lastFrames.length : 0;
      lastFrames = next;
      for (let i = startIndex; i < next.length; i++) {
        const frame = next[i];
        if (frame !== undefined) handleFrame(frame);
      }
    });
  };

  let detach = attach(storeRef.get());
  const unsubscribeSwap = storeRef.subscribe((nextStore) => {
    detach();
    visualizer.clear();
    detach = attach(nextStore);
  });

  return () => {
    disposed = true;
    detach();
    unsubscribeSwap();
  };
}
