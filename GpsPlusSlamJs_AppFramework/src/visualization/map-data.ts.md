# `map-data.ts`

## Purpose

Pure builder that turns store-derived trajectory slices into a single
`MapData` snapshot shared by **both** map renderers (the live/replay 3D
Leaflet overlay and the 2D session-summary map). It is the data half of the
unified-map work (decisions **D1–D4** in
[2026-05-31-unified-trajectory-map-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-user-feedback.md);
plan in
[2026-05-31-unified-trajectory-map-phase3-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md)).

## Public API

- `buildMapData(input: MapDataInput): MapData` — pure; no Leaflet/Three deps.
- `interface MapData` — `{ userPosition, rawGpsPath, fusedPath, referencePoints, alignmentSnapshots }`.
- `interface MapDataInput` — all fields optional; array fields are read-only.

## Invariants & assumptions

- **D2 (the core contract):** `fusedPath` is always `computeFusedPath` over
  ALL `odometryPositions` with the latest `alignmentMatrix` + `zeroRef`. It is
  never frozen per-event. When matrix or `zeroRef` is missing → `[]`.
- All array outputs are **defensively copied** — mutating the returned arrays
  never affects caller inputs, and vice versa.
- Outputs are never `undefined`: missing inputs become empty arrays / `null`.
- `userPosition` defaults to the last `rawGpsPath` entry (as `GpsCoord`) when
  not explicitly provided; an explicit `userPosition` (incl. `null`) wins.

## Examples

```ts
const data = buildMapData({
  rawGpsPath: store.rawSamples,
  odometryPositions: gpsEvents.odometryPositions,
  alignmentMatrix: gpsEvents.alignmentMatrix,
  zeroRef: firstGps.zeroRef,
  referencePoints: refMarkers,
  alignmentSnapshots: snapshots,
});
// data.fusedPath reflects the CURRENT matrix — it "snaps" on every rebuild.
```

## Tests

- [map-data.test.ts](map-data.test.ts) — pass-through, defensive copy, empty
  input, D2 recompute/snap, null matrix/zeroRef, `userPosition` fallback.
- [map-data.property.test.ts](map-data.property.test.ts) — property: for any
  rigid alignment matrix and odometry array, `fusedPath` equals
  `computeFusedPath` and has one point per odometry position (guards against
  reintroducing per-event frozen fused points).
