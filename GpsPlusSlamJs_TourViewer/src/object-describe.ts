/**
 * How a tour object is named on every page that lists or labels one (the
 * object list, the summary map, the desktop editor; M6 E1 plan review #3,
 * root CLAUDE.md DEC-H3): its title, and its distance to the nearest code.
 * Pure.
 *
 * @see object-describe.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { horizontalM } from "./move-with-code.js";

/** A pin's text; a photo's caption, or "Photo" when it has none or only
 *  blanks. */
export function objectTitle(object: TourObject): string {
  if (object.kind === "pin") return object.label;
  const caption = object.label;
  return caption !== undefined && caption.trim().length > 0 ? caption : "Photo";
}

/** "4 m from the code" / "12 m from the nearest code"; "" without a code
 *  (or without a finite distance to one). Rounded to whole metres: the
 *  objects' own GPS error is metres, so decimals would be noise. */
export function codeDistanceLine(
  object: TourObject,
  codes: readonly QrGeoPose[],
): string {
  const distances = codes
    .map((code) => horizontalM(code, object.geo))
    .filter(Number.isFinite);
  if (distances.length === 0) return "";
  const nearest = Math.round(Math.min(...distances));
  return codes.length === 1
    ? `${String(nearest)} m from the code`
    : `${String(nearest)} m from the nearest code`;
}
