# `accuracy-circles.ts`

## Purpose

Thin **re-export** of the canonical accuracy-circles helper, which now lives
in the app-framework
(`gps-plus-slam-app-framework/visualization/accuracy-circles`). The
implementation moved there (D4 of the unified-map plan) so it can be shared
with the framework's `map-overlay-draw` module. This file preserves the
existing `./accuracy-circles` import path used by [preview-map.ts](preview-map.ts)
and [summary-map.ts](summary-map.ts).

## Public API

Re-exports verbatim from the framework module:

- `addAccuracyCircles(map, samples, color): L.Circle[]`
- `AccuracyCircleSample`
- `ACCURACY_CIRCLE_FILL_OPACITY` / `ACCURACY_CIRCLE_STROKE_OPACITY` /
  `ACCURACY_CIRCLE_WEIGHT`

See the framework sidecar for the full contract and invariants.

## Tests

- [accuracy-circles.test.ts](accuracy-circles.test.ts) — exercises the helper
  through this re-export (integration check that the wiring resolves) plus the
  filtering/style contract.
- The canonical unit tests live next to the implementation in the framework
  (`visualization/accuracy-circles.test.ts`).
