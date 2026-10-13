# `edit.html` - the desktop editor (M6 E1)

## Purpose

The Tour Viewer's second page, for a computer: open the tour zip the
phone's Finish saved and see every printed code, pin and photo on a full
map, in the owner's chosen layout (variant 1, the left rail:
`public/prototypes/editor-1-left-rail/`). Read-only until E2 adds editing
and saving. Design and decisions:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
(§5, §9).

A Vite build entry (`vite.config.ts`, `edit`), so it is built and reachable
on a deployed branch preview at `/tour/edit.html`; linked from nothing
until it can save.

## Structure

- `#map` - the full-window map (`src/editor/editor-map.ts`).
- `#topbar` - the tour's title and file name, "Viewing only - editing comes
  next", "Open another tour".
- `#rail` - the codes, pins and photos (`src/editor/editor-rail.ts`).
- `#card`, `#offscreen-chip` - the card beside the selected marker
  (`src/editor/editor-card.ts`).
- `#open-modal` - "Open a tour": the file input inside `#drop` (a click
  opens the chooser; a drop works too), `#open-status` (the async state),
  `#open-error`, "Use the sample tour".
- `#toasts` - "Opened <file>: N codes, M notes".

## Invariants

- Every text the zip supplies is set with `textContent` by the modules;
  the page holds no tour data in its markup.
- Its look is `src/editor/editor.css` (paper tokens of its own), not
  `design.css`.
- The visitor page never imports `src/editor/` (dependency-cruiser rule
  `viewer-not-to-editor`), so a visitor never downloads the editor's
  Leaflet.

## Tests

`playwright-tests/editor.spec.js` (the real file chooser, the rail and the
markers, the card beside its marker, a capped photo, a refused non-tour,
the layout at three viewports).
