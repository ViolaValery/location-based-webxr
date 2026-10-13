/**
 * Why these tests matter: the card that explains a selected marker must
 * stay beside it and inside the free part of the window - never under the
 * rail or the top bar, never off screen - and must hand over to the "off
 * the map view" chip when its marker leaves the view (the chosen
 * prototype's behaviour, M6 E1). The property sweeps anchors and window
 * sizes the examples cannot.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { placePopover, revealPadding } from "./popover-place.js";

const FREE = { left: 330, top: 80, right: 1268, bottom: 788 };
const SIZE = { width: 320, height: 240 };

describe("placePopover", () => {
  it("sits to the right of the marker when there is room, its arrow at the marker", () => {
    const p = placePopover({
      anchor: { x: 600, y: 400 },
      lift: 24,
      gap: 30,
      size: SIZE,
      free: FREE,
    });
    expect(p).toEqual({
      visible: true,
      x: 630,
      y: 330,
      side: "right",
      arrow: 39,
    });
  });

  it("flips to the left near the right edge", () => {
    const p = placePopover({
      anchor: { x: 1100, y: 400 },
      lift: 24,
      gap: 30,
      size: SIZE,
      free: FREE,
    });
    expect(p).toMatchObject({ visible: true, side: "left", x: 750 });
  });

  it("goes below when neither side fits (a narrow free area)", () => {
    const p = placePopover({
      anchor: { x: 500, y: 300 },
      lift: 0,
      gap: 26,
      size: SIZE,
      free: { left: 330, top: 80, right: 700, bottom: 788 },
    });
    expect(p).toMatchObject({ visible: true, side: "below", y: 314 });
  });

  it("hides when the marker is under the rail, above the top bar or off screen", () => {
    for (const anchor of [
      { x: 200, y: 400 },
      { x: 600, y: 40 },
      { x: 1400, y: 400 },
      { x: 600, y: 900 },
    ]) {
      expect(
        placePopover({ anchor, lift: 0, gap: 30, size: SIZE, free: FREE }),
      ).toEqual({ visible: false });
    }
  });

  it("always lies inside the free area when shown (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 330, max: 1268 }),
        fc.integer({ min: 80, max: 788 }),
        fc.integer({ min: 200, max: 360 }),
        fc.integer({ min: 120, max: 400 }),
        (x, y, width, height) => {
          const p = placePopover({
            anchor: { x, y },
            lift: 0,
            gap: 30,
            size: { width, height },
            free: FREE,
          });
          expect(p.visible).toBe(true);
          if (!p.visible) return;
          expect(p.x).toBeGreaterThanOrEqual(FREE.left);
          expect(p.x + width).toBeLessThanOrEqual(FREE.right + 1);
          expect(p.y).toBeGreaterThanOrEqual(FREE.top);
          expect(p.y + height).toBeLessThanOrEqual(FREE.bottom + 1);
        },
      ),
    );
  });
});

describe("revealPadding (E1 review #2)", () => {
  // Why: Leaflet pans a marker inside the window minus this padding. A
  // fixed 380 px on the right turned that box inside out on a phone (it
  // landed over the rail), so "Show it" and a row click left the marker
  // hidden. The box must stay right of the rail and keep some size.
  it("keeps room for the card on the right of a desktop window", () => {
    expect(
      revealPadding({ width: 1280, height: 800 }, { left: 316, top: 80 }),
    ).toEqual({ topLeft: [356, 120], bottomRight: [380, 60] });
  });

  it("shrinks the right padding on a phone so the box stays clear of the rail", () => {
    const p = revealPadding({ width: 390, height: 844 }, { left: 82, top: 80 });
    const boxLeft = p.topLeft[0];
    const boxRight = 390 - p.bottomRight[0];
    expect(boxLeft).toBeGreaterThanOrEqual(82);
    expect(boxRight - boxLeft).toBeGreaterThanOrEqual(60);
  });

  it("never turns the box inside out (property)", () => {
    fc.assert(
      fc.property(
        // Wide enough for a 60 px box right of a rail up to 400 px.
        fc.integer({ min: 520, max: 2560 }),
        fc.integer({ min: 320, max: 1600 }),
        fc.integer({ min: 0, max: 400 }),
        (width, height, left) => {
          const p = revealPadding({ width, height }, { left, top: 80 });
          expect(p.bottomRight[0]).toBeGreaterThanOrEqual(0);
          expect(p.bottomRight[1]).toBeGreaterThanOrEqual(0);
          // The windows swept always leave room for one: the box is at
          // least 60 px wide.
          expect(
            width - p.bottomRight[0] - p.topLeft[0],
          ).toBeGreaterThanOrEqual(60);
        },
      ),
    );
  });
});
