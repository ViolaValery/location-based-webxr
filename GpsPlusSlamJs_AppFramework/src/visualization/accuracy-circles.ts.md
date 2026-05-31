# `accuracy-circles.ts`

## Purpose

Shared helper for drawing per-event GPS accuracy circles on a Leaflet map.
Home of the canonical implementation (app-framework, per D4 of the
unified-map plan). Reused by the framework's
[map-overlay-draw.ts](map-overlay-draw.ts) and — via a thin re-export — by the
recorder app's `ui/preview-map.ts` (replay setup) and `ui/summary-map.ts`
(session summary). Keeping one implementation means future style changes only
happen here.

## Public API

- `ACCURACY_CIRCLE_FILL_OPACITY` / `ACCURACY_CIRCLE_STROKE_OPACITY` /
  `ACCURACY_CIRCLE_WEIGHT` — style constants applied to every circle.
- `AccuracyCircleSample` — minimal sample shape (`lat`, `lng`, optional
  `accuracy` in meters). `RawGpsSample` is structurally compatible.
- `addAccuracyCircles(map, samples, color): L.Circle[]` — adds one
  transparent circle per sample with a finite positive `accuracy`. Returns
  the created circles so callers tracking layers for cleanup can append them.

## Invariants & assumptions

- A sample is rendered iff `typeof accuracy === 'number'`, `Number.isFinite`,
  and `accuracy > 0`. Pre-accuracy recordings (no field) and bad values
  (`0`, negative, `NaN`, `Infinity`) are silently skipped — the polyline path
  still renders.
- Circles are added immediately. Callers must invoke this BEFORE adding the
  polyline so the line stays visually on top.
- Circle radius is interpreted by Leaflet as meters.

## Examples

```ts
const circles = addAccuracyCircles(map, gpsPath, RAW_GPS_COLOR);
layers.push(...circles); // for later cleanup
L.polyline(latLngs, { color: RAW_GPS_COLOR }).addTo(map);
```

## Tests

- [accuracy-circles.test.ts](accuracy-circles.test.ts) — filtering rules and
  applied options.
- Also exercised end-to-end via the recorder's `preview-map.test.ts` and
  `summary-map.test.ts`, and via [map-overlay-draw.test.ts](map-overlay-draw.test.ts).
