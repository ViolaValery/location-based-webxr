# editor/save-target.ts

## Purpose

The desktop editor's in-place save (M6 E2b-1): a tour zip picked through
the browser's file picker with write permission, written back over itself,
never over a file something else changed. Page-free: the page passes the
window and the lock manager. Design: the M6 design doc §9, "E2b - the
build plan, re-cut" and its cold review
(`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`).

## Public API

- `pickTourFile(win): Promise<PickOutcome>` - `showOpenFilePicker` for one
  `.zip`, then `requestPermission({ mode: "readwrite" })`, then the file.
  - `unavailable` - no picker, or one that refuses (an iframe): the page
    uses its file input.
  - `cancelled` - the picker dismissed (`AbortError`), never an error.
  - `picked` - `{ file, handle, writable }`; `writable` is false for a
    refused, dismissed or failing permission request, or a handle without
    one: the tour opens all the same and saves as a download.
- `createSaveTarget(handle, opened): Promise<SaveTarget>` - the baseline
  (size, modified time, the last 64 KiB) is read from `opened` at once.
  - `check()` - `"same"`, `"changed"` (another size, or the same size and
    time with another tail) or `"gone"` (`NotFoundError`: moved, renamed or
    deleted). A file only touched (same size, same tail, a new time - a
    sync client) is `"same"`, and the new time is adopted.
  - `write(blob)` - checks again, then `writeFileOrAbort`; a refusal throws
    `TargetChangedError` (`kind`) and writes nothing. Returns the file as
    written; the baseline moves only once the write landed.
- `holdEditorLock(locks, fileName)` - `{ granted, release }`: an exclusive
  Web Lock `gps-plus-slam/tour-viewer-editor/<name>`, `ifAvailable`, held
  until `release` or the page goes.
- `TargetChangedError`, `WritableFileHandle`, `PickerWindow`, `PickOutcome`,
  `SaveTarget`.

## Invariants & assumptions

- The permission is asked FIRST, while the picker's activation holds; the
  file's reads come after (E2b plan review #8).
- The check before a write and the write are not one step: another
  program writing during ours is not caught (named in the plan).
- The baseline's bytes are read at open: a `File` from disk becomes
  unreadable once the file changes.
- The lock's prefix is a sibling of the recordings' (`.../tour-viewer/`),
  so their housekeeping never counts it. Keyed by the file's NAME: two
  different files of one name in two tabs collide, and the second tab is
  told and may edit anyway. Without Web Locks, or when the request fails,
  it grants (nothing to coordinate with; refusing would only stop saving).

## Examples

```ts
const picked = await pickTourFile(window as unknown as PickerWindow);
if (picked.kind === "picked" && picked.writable) {
  const target = await createSaveTarget(picked.handle, picked.file);
  await target.write(rebuilt); // throws TargetChangedError when changed
}
```

## Tests

`save-target.test.ts` on fake handles: the permission before the read, the
refusals that still open, the write and its own baseline, a changed file
refused and not written, a touched file accepted, a gone file, a failed
write keeping the baseline, and the lock (granted, refused, released,
without Web Locks). The page's e2e (`playwright-tests/editor.spec.js`)
writes a real origin-private file through it.
