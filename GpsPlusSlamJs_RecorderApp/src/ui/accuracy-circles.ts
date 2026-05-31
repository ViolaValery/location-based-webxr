/**
 * Per-event GPS accuracy circles.
 *
 * The canonical implementation now lives in the app-framework
 * (`gps-plus-slam-app-framework/visualization/accuracy-circles`) so it can be
 * shared with the framework's `map-overlay-draw` module (D4 of the
 * unified-map plan). This file re-exports it to preserve the existing
 * `./accuracy-circles` import path used by `preview-map.ts` and
 * `summary-map.ts`.
 */

export {
  type AccuracyCircleSample,
  ACCURACY_CIRCLE_FILL_OPACITY,
  ACCURACY_CIRCLE_STROKE_OPACITY,
  ACCURACY_CIRCLE_WEIGHT,
  addAccuracyCircles,
} from 'gps-plus-slam-app-framework/visualization/accuracy-circles';
