# mesh-surface.ts

## Purpose

The surroundings as a mesh, for the creator's cursor (polish round M5, the owner's B3:
the ring should follow the surface, like the RecorderApp and the physics demo). Behind
`?mesh=1` until the owner likes it on the phone (Q-Mesh). Depth samples in the store fold
into an occupancy grid, an off-thread mesher turns it into the framework's depth-only
occluder mesh under the world group, and `pick()` casts the screen centre against it - the
point the reticle sits on (`startHitTestReticle`'s `surfacePick`).

## Public API

- `MESH_DEPTH` - the depth this needs: 24 x 24 at 5 Hz (the RecorderApp's and the physics
  demo's reconstruction density; the troubleshooting recording's 16 x 16 at 1 Hz is too
  sparse for a mesh).
- `createMeshSurface({ parent, store, getCamera, createWorker?, createSink?, subscribe?,
now? }) → MeshSurface` - composes the framework's `OccupancyGrid` (0.15 m cells),
  `createOccluderSink` (corner-fit mesh, confidence 2, a 12 m window around the camera) with
  `createOccluderMeshWorker(createWorker)`, and `subscribeReplayOccupancy` (the store's
  `recording.latestDepthSample`, refreshed at the depth interval).
  - `pick()` - the surface point under the screen centre (world point and world normal),
    or null; also notes the frame gap (one pick per frame).
  - `stats()` - `{ frameMs: { median, worst } | null, triangles }`.
  - `dispose()` - stops the feed, frees the mesh and the worker (idempotent).
- `surfacePointFromHit(hit)` - a raycast hit as a world point and the face's world normal,
  or null.
- `frameTimeStats(gaps)` - median and worst of the kept frame gaps, or null.
- `meshSurfaceLine(stats)` - the `?debug=1` readout line ("mesh: N triangles · frame
  m/M ms").

## Invariants & assumptions

- Without a worker (`createWorker` absent, or one that fails to load) the framework driver
  meshes on the main thread - slower, never broken.
- No mesh hit returns null, so the WebXR hit-test keeps driving the ring there.
- The frame gaps are measured between picks, which the reticle asks once per XR frame.
- The mesh is depth-only and invisible; the raycaster hits it all the same.

## Examples

```ts
const surface = createMeshSurface({
  parent: worldGroup,
  store,
  getCamera,
  createWorker,
});
startHitTestReticle({
  arWorldGroup: worldGroup,
  surfacePick: () => surface.pick(),
});
// … at the session end:
surface.dispose();
```

## Tests

- `mesh-surface.test.ts` - a hit's world point and normal under a turned group; no hit,
  no face; the pick against a floor mesh from a camera looking down; the frame-time stats
  (and a property: the median and worst are among the gaps); dispose once; `MESH_DEPTH`.
- `ar-entry.test.ts` / `playwright-tests/ar-mode.spec.js` - the wiring behind `?mesh=1`.
