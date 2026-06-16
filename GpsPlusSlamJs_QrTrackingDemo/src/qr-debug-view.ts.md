# qr-debug-view.ts

**Purpose:** The two §5 verification objects (Note 4): a `THREE.AxesHelper` at
the solved QR pose and a semi-transparent cube sized to the QR so its front face
lands on the printed corners. Both ride the alignment / transform chain like real
content.

**Coordinate space (critical):** the QR pose is in **raw WebXR** space (corners
depth-unprojected with the raw WebXR camera pose), but `arWorldGroup` local space
is **NUE**. So the objects hang off an internal **`WEBXR_TO_NUE` basis node**
(matrixAutoUpdate=false) under `arWorldGroup` — mirroring `webxr-session`'s
`basisChangeNode` — so their world pose = `arWorldGroup × WEBXR_TO_NUE × pose`,
the SAME chain the camera rides. Parenting the objects directly under
`arWorldGroup` (as the first version did) leaves them East/North axis-swapped and
they do NOT line up with the camera/QR on a real device — the recurring
scene-frame bug (frame-tile / occupancy-cube / hit-test-reticle precedents). The
camera is owned entirely by WebXR; this module never moves it.

## Public API

- `createQrDebugView(parent): QrDebugView` — `{ update(pose, sizeM), clear(), dispose() }`.
  - `update(pose, sizeM)` — `sizeM: number | null`. The **axis** is placed from
    the pose alone and revealed on every update (it needs no size). The **cube**
    spans `sizeM` in-plane and a thin slab in depth (front face on the code) and
    is revealed **only when `sizeM` is a number**; pass `null` (size not yet
    measured) to show the axis while keeping the cube hidden. This decoupling is
    why a locked QR is visibly glued (axis) even before the depth-measured size
    converges — see the on-device follow-up.
  - `clear` hides without detaching; `dispose` detaches + frees GPU resources.

## Invariants

- Objects hang off the internal `WEBXR_TO_NUE` basis node, not `arWorldGroup`
  directly (see Coordinate space above). `dispose` detaches the whole basis
  subtree.
- Objects start hidden; first `update` reveals them.
- **Persistence (Note 3):** `clear` is NOT called on detection misses — the
  objects keep their last pose so they don't flicker between throttled detections.
- Pure THREE object math; works against a bare `Object3D` parent (no WebGL).

## Tests

`qr-debug-view.test.ts` — objects added under a basis node, **world pose rides
`WEBXR_TO_NUE`** (raw-WebXR [1,0,0] → NUE world [0,0,1]), reveal + glue + size on
update, **axis-shown-but-cube-hidden when `sizeM` is null** + cube revealed once a
size arrives, `clear` hides-but-keeps, `dispose` detaches the basis subtree. The
end-to-end "detected but size unknown → axis visible, cube hidden" path is covered
by `playwright-tests/qr-demo.spec.js` (the non-planar-depth fake).
