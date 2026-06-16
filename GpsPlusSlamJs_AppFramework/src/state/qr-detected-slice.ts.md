# `qr-detected-slice.ts`

## Purpose

Framework-level Redux slice that stores **what was detected, where, in 3D**, keyed by decoded payload — the decoupling seam between detection and the rest of the app. Overlay / trigger / AR-anchor consumers subscribe to this slice **independently of the GPS fusion**. Realizes Note 3 of [2026-06-15-followup-qr-tracking-generalization-overlay-and-north.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-followup-qr-tracking-generalization-overlay-and-north.md).

## Public API

- **State** `QrDetectedState = { maxHistory, markers: Record<payload, QrMarkerState> }`.
  - `QrMarkerState = { text, detections: QrDetectionEntry[] (ring, oldest→newest), size: QrSizeEstimate }`.
  - `QrDetectionEntry = { text, qrPoseWorld, qrPoseInCamera, reprojectionErrorPx, timestamp }` — deliberately detection-agnostic (Note 1: generalizes to object detection).
  - `QrSizeEstimate = { status: 'unknown'|'measuring'|'estimated', estimateM, sampleCount, spreadM }` — the Note 3 size lifecycle.
- **Actions**: `recordQrDetection(entry)`, `recordQrSizeEstimate({ text, estimate })`, `pruneQrDetections({ text, count })`, `clearQrMarker({ text })`, `clearAllQrMarkers()`, `setQrMaxHistory(n)`.
- **Reducer**: `qrDetectedReducer`.
- **Selectors**: `selectQrMarkers`, `selectQrMarker(state, text)`, `selectLatestQrDetection(state, text)`, `selectQrSize(state, text)`, `selectResolvedQrSizeM(state, text)` — over the minimal `RootWithQrDetected` shape.
  - `selectResolvedQrSizeM` returns the running-median `estimateM` once the size lifecycle is `'estimated'`, else `null`. It is the **vote bridge** (framework-wiring-options Part B, Option a): an app injects it as the QR controller's `resolveSizeM` — `resolveSizeM: (text) => selectResolvedQrSizeM(store.getState(), text)` — so a measured size drives the high-weight vote the moment it converges, without the `ar` controller importing this slice (which would close the `ar → state` cycle).
- **Derived helper**: `medianQrPosition(entries)` → robust per-axis median world position (or `null`).
- **Pose-stability selectors** (sliding-window stabilization, see [2026-06-16-followup-qr-pose-stabilization-sliding-window.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-followup-qr-pose-stabilization-sliding-window.md)):
  - `selectQrPoseStability(state, text, options?)` → `QrPoseStability` (`unknown | measuring | stable` + filtered pose + spreads), derived from the raw ring buffer via `ar/qr-pose-aggregation.evaluateQrPoseStability`. Surfaces the lifecycle for the HUD, mirroring the size lifecycle's shape — but **derived, not stored** (the detections are the source of truth, unlike depth-measured size).
  - `selectStableQrPose(state, text, options?)` → `Pose | null`: the filtered pose **only** once `stable`, else `null`. The pose analogue of `selectResolvedQrSizeM` — the `resolveStablePose` bridge an app injects into the QR controller / demo (`resolveStablePose: (text) => selectStableQrPose(store.getState(), text)`) so the high-weight vote / smooth overlay consume the converged pose, never the raw latest one, without `ar` importing the slice.
- **Constant**: `DEFAULT_QR_MAX_HISTORY = 32`.

## Invariants & assumptions

- **Bounded**: every marker's `detections` length is `≤ maxHistory` after any dispatch sequence (`recordQrDetection` caps; `setQrMaxHistory` re-trims existing markers). This is the no-leak guarantee a naive overlay relies on.
- **Newest-last**: the last array element is the most recent detection — `selectLatestQrDetection` is the natural overlay-persistence source (keep the last pose across detection misses; don't flicker).
- **Payload identity**: two physically-distinct markers sharing a payload merge by design; a moving marker with one payload accumulates a motion path (desired).
- **Readonly-tuple safety**: reducers return fresh state instead of mutating the immer draft, because `Pose` carries readonly `Vector3`/`Quaternion` tuples that `WritableDraft` rejects (same pattern as `tracking-slice.originReset`).
- **Opt-in**: not a built-in of `createSlamAppStore`; apps wire it via `extraReducers: { qrDetected: qrDetectedReducer }`. Framework consumers that never detect anything pay nothing.

## Examples

```ts
const store = createSlamAppStore({
  storageBackend,
  extraReducers: { qrDetected: qrDetectedReducer },
});
store.dispatch(
  recordQrDetection({
    text: 'https://x/y',
    qrPoseWorld,
    qrPoseInCamera,
    reprojectionErrorPx,
    timestamp: Date.now(),
  })
);
const latest = selectLatestQrDetection(store.getState(), 'https://x/y');
```

## Tests

- `qr-detected-slice.test.ts` — marker creation, payload keying, ring cap + re-trim, prune, size lifecycle, clears, readonly-Pose survival.
- `qr-detected-slice.property.test.ts` — ring buffer never exceeds `maxHistory` and latest-is-newest for arbitrary interleavings; `medianQrPosition` robustness.
