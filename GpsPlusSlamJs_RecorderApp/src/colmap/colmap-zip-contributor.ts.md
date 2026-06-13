# `colmap-zip-contributor.ts`

## Purpose

Recorder-side `ZipExportContributor` that derives a COLMAP `sparse/0/` model
from the live recording state and writes it into the exported ZIP. The
integration seam tying together Iter 1 (conversions), Iter 2 (serializers) and
Iter 2.5 (grid accessor). See
[2026-06-13-colmap-export-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-colmap-export-plan.md)
Iter 3.

## Public API

- `createColmapZipContributor(deps): ZipExportContributor`
  - `deps.getFrames(): readonly ArImageCapture[]` — WebXR camera poses + JPEG
    pixel dims (wired to `selectFrameTilesInWebXR(store.getState())`).
  - `deps.getProjectionMatrix(): Matrix4 | undefined` — session-constant
    intrinsics (wired to `state.recording.latestDepthSample?.projectionMatrix`).
  - `deps.getOccupancyGrid(): OccupancyGrid | null` — the shared live grid (Iter
    2.5 provider).
  - Returns a contributor with `subdir: 'sparse'` that writes
    `0/cameras.txt`, `0/images.txt`, `0/points3D.txt` (file count 3), or **0
    files** when intrinsics are unavailable.

## Behavior & invariants

- **Reads injected live state, never re-parses `actions/`** (Q2) — per-sync cost
  ∝ output size, not O(session²).
- **Q4 skip:** returns 0 files (no `sparse/0/`) when `getProjectionMatrix()` is
  `undefined`, when no frame carries pixel dimensions, or when the matrix is not
  a usable perspective. The rest of the ZIP is unaffected.
- **NAME = bare filename** (`images/frame-000001.jpg` → `frame-000001.jpg`); the
  user points COLMAP `image_path` at the ZIP's `images/`. Legacy `frames/`
  prefixes are stripped the same way.
- **World frame:** occupancy-grid centers are passed to `points3D` untransformed
  — raw WebXR world IS the COLMAP world (Iter-1 camera-only basis change), so
  points and cameras stay registered.
- **Color fallback:** cells with no observed RGB (`getCellColor` → null) emit
  mid-gray `128 128 128` rather than black.
- **Empty grid:** still emits a valid model (cameras + images) with an empty
  `points3D.txt`.

## Wiring

Added to `buildZipContributors()` in `recording-session-handlers.ts`, used by
BOTH the periodic crash-safety sync (`syncToExternalZip`) and the final
`exportSessionAsZip`, so the on-disk backup is continuously COLMAP-format.

## Tests

- `colmap-zip-contributor.test.ts` — happy path (3 files, PINHOLE dims, RGB
  point), bare-filename NAME (incl. legacy `frames/`), Q4 skips (no matrix / no
  dims → 0 files), empty-grid valid model, gray fallback. Wiring is covered by
  the recording-session-handlers tests.
