# editor/editor-session.ts

## Purpose

The desktop editor's open tour and its edits (M6 E2a): the phone's object
rules (`object-edits.ts`) over the opened tour, and a Save built by the
phone's own Finish rules (`finish-rebuild.ts`). Page-free: the page draws
`model()`, calls the edits and downloads what `save()` returns. Design:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
§9 ("E2 as revised").

## Public API

- `createEditorSession({ session, manifest, levels, fileName? }): EditorSession`
  - `model()` - the `EditorModel` of the tour with the edits applied.
  - `changeCount()` - edits and deletions not yet in a saved file, by
    content (a text edited back is no change); `pendingIds()` - the notes
    with an edit or a move not yet saved.
  - `editText(id, text)` - `pinTextEdit`'s outcome (`edited`, `unchanged`,
    `refused` with the phone's sentence).
  - `move(id, lat, lon)` - `moveObjectTo` (height and facing kept).
  - `remove(id)` - `deleteObject`; returns the undo (`undoDelete`), which
    refuses (`false`) once a save wrote the delete - a save whose snapshot was
    taken after it, not one already running when it was made (E2b plan
    review #2).
  - `save({ keepScan })` - `rebuildFinishedTour` with `levels: []`, the
    photo spots decided once per open (`captureSpotsForRebuild`, its result
    kept), `previous` = the last save's bytes; returns `{ blob, filename,
scanLeftOut, notPlaced? }` and advances to what was written
    (`pendingAfterRebuild`).
- `EditorSession`, `EditorSave`.

## Invariants & assumptions

- Saves run one after another: one called while another runs starts when
  it ends (E2a review #9).
- The edits are snapshotted before the save's first await: an edit made
  while it runs stays for the next save, by content.
- `filename` is `finishedFileName(session)` (the opened file's name, made
  safe); the model's title falls back to `fileName` (the shown name).
- A delete's undo works on the lists as they stand: after a save that
  wrote the delete, the object is no longer in the zip, so the page ends
  the undo when a save starts.
- The editor places nothing new yet: every entry is an edit or a move of
  an object the tour carries.

## Tests

`editor-session.test.ts` on real zips: an edit, a move and a delete reach
the saved `tour.json`; an empty pin refused; a delete undone in place; an
edit made during a save kept for the next; the saved file's name.
