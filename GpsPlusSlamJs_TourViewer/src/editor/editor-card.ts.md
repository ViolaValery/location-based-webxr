# editor/editor-card.ts

## Purpose

The card beside the selected marker in the desktop editor (M6 E1, the
chosen variant 1's popover), read-only until E2, and the "off the map
view" chip.

## Public API

- `createEditorCard(dom, { loadImage, onClose, onReveal }): EditorCard`
  - `show(item)` - the kind ("Code 1", "Pin note", "Photo note",
    "Recorded photo"), a note's text, a photo (see below), the precision
    line, the item's meta, "Esc close".
  - `place(anchor | null, free)` - positions the card with
    `placePopover` (a note's lift 24 px, gap 30; a code's or station's 0
    and 26), or, for a marker out of view, hides it and shows the chip
    ("<title> is off the map view", "Show it" calls `onReveal`). An item
    with no position (`anchor` null) gets the card at the free area's
    corner, without arrow or chip (E1 review #3). The card is as wide as
    the free area, up to 320 px (E1 review #7).
  - `hide()`, `shown()`.
- `PRECISION_LINE` - R7's two figures: "about 0.1-0.7 m near a code, 1-3 m
  further away" (M6 E1 plan review #10).

## Invariants & assumptions

- Every text is set with `textContent`.
- A photo is read through `loadImage`, checked by `image-cap.ts`
  `pictureProblem` (the tour's pixel cap, by its header) before an
  `<img>` decodes it, and shown through an object URL that is revoked on
  the next show and on hide. A read that fails says so in an error line
  (a file changed on disk throws on a later read).
- A photo read that lands after the card moved on is dropped (a
  generation counter).
- A code's card says it is measured on site; a recorded photo's that it
  was placed for visitors at the Finish.

## Tests

The placement is `popover-place.test.ts`; the card's photo, the capped
photo's line and Esc are pinned by `playwright-tests/editor.spec.js`.
