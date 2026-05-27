# wire-frame-tile-subscribers.ts

F3.4 of the [tracking-quality regression & replay-gaps feedback](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).

Connects the `framesInScene` slice (F3.1) to the `FrameTileVisualizer` (F3.3).

## Responsibilities

- Subscribe to `state.framesInScene.frames` via the active store in
  `StoreRef<RecorderStore>`. On every dispatch the wirer diffs the
  frames array tail and processes each newly observed entry.
- For each new `FrameInScene`:
  1. fetch the JPEG blob via the injected `blobSource(imageFile)`,
  2. apply `minFrameBytes` (default `DEFAULT_MIN_FRAME_BYTES = 2000`)
     to reject broken / empty frames,
  3. decode via the injected `decodeTexture(blob)` (caller wires
     `createImageBitmap` in production),
  4. call `visualizer.addTile(frame, texture)`.
- De-duplicate by `imageFile` within a single store lifetime via an
  internal `Set<string>`.
- React to store swaps (F1 pattern): clear the visualizer, reset the
  processed-set by re-attaching to the new store.

## Why dependency injection of `blobSource` and `decodeTexture`

The wirer is jsdom-testable and identical in shape between live mode
(blob from OPFS cache populated by `handleImageCaptured`) and replay
mode (blob from the `@zip.js/zip.js` reader). Both flows differ only
in the `blobSource` they pass in. `decodeTexture` is injected so unit
tests can use a `THREE.Texture` stub instead of the real
`createImageBitmap`, which jsdom doesn't implement.

## Out of scope

- The actual `createImageBitmap`-based decoder lives in the F3.5
  wiring (`main.ts` / `replay-mode.ts`).
- Threshold calibration against the corpus is part of F3.6.
