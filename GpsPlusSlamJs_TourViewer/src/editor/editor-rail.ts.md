# editor/editor-rail.ts

## Purpose

The desktop editor's left rail (M6 E1, the chosen variant 1): the tour's
codes, pins and photos in groups with counts, a search, select and hover
both ways with the map, and a folded form with one count per group.

## Public API

- `createEditorRail(dom, { onSelect, onHover, onResize }): EditorRail`
  - `render(model)` - shows the rail, clears the search, draws the groups
    (Codes, Pins, Photos; a group with no match is left out while
    searching; "Nothing matches that text." when nothing does) and the
    folded counts.
  - `select(id | null)` - the `sel` class and `aria-pressed`, scrolled into
    view; `hover(id, on)`; `collapse(on)` - folds to the counts (a count
    button opens the rail at its group); `right()` - the rail's right edge
    in window pixels, 0 while hidden.
- `EditorRailDom`.

## Invariants & assumptions

- Every title and meta is set with `textContent`.
- The search is `filterItems` (`editor-model.ts`); counts are the whole
  tour's, not the filtered ones.
- `onResize` fires on fold and unfold, so the page re-places the card.

## Tests

`filterItems` is unit-tested in `editor-model.test.ts`; the rail's rows,
titles and folded width are pinned by `playwright-tests/editor.spec.js`.
