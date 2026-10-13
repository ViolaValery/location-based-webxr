# editor/edit-main.ts

## Purpose

The composition root of the desktop editor (`edit.html`, M6 E1): opens a
tour (chosen, dropped, or the sample), builds its model and wires the map,
the rail and the card in the chosen variant 1 layout. Read-only until E2.

## Behaviour

- **Open:** the file input's change and a drop on `#drop` call
  `openTourForEditing` (`editor-open.ts`); "Use the sample tour" fetches
  `samples/marienplatz-tour.zip` beside the page. While a file is read the
  modal says "Opening <name>…" and its buttons are disabled; then the tour
  is drawn and a toast names what opened, or the reason shows in
  `#open-error` and the modal stays (root `CLAUDE.md`, async feedback).
- **Open another tour** shows the dialog with Cancel (and Esc) back to
  the open tour; the open tour stays until the new file has opened, so a
  refused file costs nothing (E1 review #4).
- **A failure latched during the open** (`integrityFailure()` right after
  it) refuses the tour (E1 review #6).
- **A late integrity failure** (`onIntegrityFailure`, the background
  whole-file check) closes the tour, hides it and shows
  `describeIntegrityError` in the modal.
- **Select:** a marker or a row selects; a row also brings its marker
  into view (`revealPadding`). A photo is read by `photoSource`: a placed
  one by `loadContentEntry`, a recorded one by `loadEntry`. The card follows the marker on every map move and on resize;
  Esc, the card's close and a click on the map clear the selection.
- **Free area** for the card: right of the rail, under the top bar (read
  from the bar's own box), 12 px from the window's edges. The rail starts folded below 760 px.
- **Closing** a tour (another open) closes its session; the card revokes
  its photo's object URL.
- Builds a store first: the library's geo maths (the distance lines) runs
  only once one exists.

## Tests

The modules it wires have their own unit tests; the page is pinned by
`playwright-tests/editor.spec.js`.
