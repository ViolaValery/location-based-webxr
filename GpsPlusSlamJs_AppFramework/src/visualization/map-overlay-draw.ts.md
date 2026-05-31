# `map-overlay-draw.ts`

## Purpose

The SINGLE Leaflet drawing routine shared by both map consumers — the
live/replay 3D overlay (`LeafletMapOverlay`) and the 2D session-summary map
(`createSummaryMap`). It is Phase 3 of the
[map-system review](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-03-22-map-system-review.md)
and the fix for Findings 1 & 4 of the
[unified-trajectory-map user feedback](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-user-feedback.md).
It consumes the resolved [MapData](map-data.ts) from `buildMapData` so the two
renderers cannot diverge again.

## Public API

- `drawMapData(map, data, options?): DrawnMapData` — draws, in order:
  1. raw accuracy circles (via [accuracy-circles.ts](accuracy-circles.ts),
     drawn first so the polyline stays on top) + raw GPS polyline;
  2. fused SLAM+GPS polyline;
  3. one labelled marker per reference point (`📍 name` popup);
  4. alignment-snapshot polyline;
  5. optional user-position marker (`options.showUserPosition`).
  Returns `{ layers, bounds }`.
- `DrawMapDataOptions` — `{ showUserPosition?: boolean }` (default off).
- `DrawnMapData` — `{ layers: L.Layer[]; bounds: L.LatLngBounds }`.
- Color constants: `RAW_GPS_COLOR`, `FUSED_PATH_COLOR`, `REF_POINT_COLOR`,
  `ALIGNMENT_SNAPSHOT_COLOR`, `USER_POSITION_COLOR` (from
  [vis-colors.ts](vis-colors.ts)).
- Style constants: `MAP_PATH_POLYLINE_WEIGHT = 3`,
  `MAP_PATH_POLYLINE_OPACITY = 0.8` (match the recorder's `map-osm-base`
  values so the summary visuals are unchanged).

## Invariants & assumptions

- The caller owns map creation, tile layer, `fitBounds`, resize and
  fullscreen. This module only draws data layers and reports bounds.
- Empty slices create no layers; `bounds.isValid()` is `false` when nothing
  was drawn.
- Reference-point popups are built with the DOM API (`textContent`), never
  `innerHTML`, so a malicious reference-point name cannot inject markup.
- Draw order is significant: accuracy circles precede the raw polyline.

## Examples

```ts
const map = L.map(container).setView([lat, lng], 15);
addOsmTileLayer(map);
const { layers, bounds } = drawMapData(map, buildMapData(input));
if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
// later: layers.forEach((l) => l.remove());
```

## Tests

- [map-overlay-draw.test.ts](map-overlay-draw.test.ts) — draw order, per-layer
  styles/coordinates, bounds accumulation, returned layers, and the optional
  user marker, against a recording Leaflet mock.
