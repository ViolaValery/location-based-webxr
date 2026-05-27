# frame-texture-decoder.ts

F3.5b of the [tracking-quality regression & replay-gaps
feedback](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).

`decodeFrameTexture(blob)` is the production decoder paired with
[`createZipFrameBlobSource`](../storage/zip-frame-blob-source.ts.md)
(replay) or the live in-memory blob cache (F3.5d). It plugs into
the `decodeTexture` slot of
[`wireFrameTileSubscribers`](./wire-frame-tile-subscribers.ts.md).

## Soft-failure contract

The wirer expects `null` for "skip this frame, don't crash". We
return `null` on:

- Missing `createImageBitmap` (older runtimes, exotic SSR).
- Decode rejection — typical for broken frames in the corpus.

Throwing here would route to the wirer's `onError` hook and add
noise; `null` is the right signal for "expected drop".

## Three.js notes

- `THREE.Texture(bitmap)` is the documented constructor for
  `ImageBitmap` sources.
- `needsUpdate = true` is required so the GPU upload happens on
  the next render.
- Lifecycle disposal is owned by `FrameTileVisualizer.clear()`
  (F3.3); we don't dispose here.

## Tested in `frame-texture-decoder.test.ts`

Three cases: happy path (texture wraps bitmap & `needsUpdate=true`),
decode rejection → `null`, missing global → `null`.
