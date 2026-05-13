/**
 * Tests for the `createGpsAnchor` bootstrap phase.
 *
 * Why this test matters: the bootstrap state machine is the part that
 * decides *when* an anchor commits to its first GPS pose. It MUST
 * - honour an optional settling window (no samples taken until the
 *   window elapses),
 * - sample at 1 Hz on subsequent ticks,
 * - take a per-coordinate median (so a single spike outlier cannot
 *   move the committed pose),
 * - flip `phase` to `'anchored'` and `isFullyAnchored` to true only
 *   when the configured number of samples has been collected,
 * - skip the entire phase when `skipBootstrap: true` and trust the
 *   supplied `gpsPoint` verbatim.
 *
 * Sub-step 2 of the GpsAnchor port plan
 * (../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-gps-anchor-port-plan.md).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGpsAnchor, type GpsAnchorSamplePoint } from './gps-anchor.js';
import { clearFrameUpdates } from '../ar/frame-loop.js';

function makeAnchorEnv() {
  const arWorldGroup = new THREE.Group();
  const object3D = new THREE.Object3D();
  arWorldGroup.add(object3D);
  const camera = new THREE.PerspectiveCamera();
  return { arWorldGroup, object3D, camera };
}

afterEach(() => {
  clearFrameUpdates();
});

describe('createGpsAnchor — bootstrap', () => {
  it('starts in `bootstrap` phase with `isFullyAnchored=false`', () => {
    const env = makeAnchorEnv();
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => ({ lat: 48.0, lon: 11.0 }),
    });
    expect(anchor.phase).toBe('bootstrap');
    expect(anchor.isFullyAnchored).toBe(false);
    anchor.dispose();
  });

  it('skipBootstrap=true commits the supplied gpsPoint and flips to `anchored` immediately', () => {
    const env = makeAnchorEnv();
    const seed = { lat: 48.1, lon: 11.2, altitude: 500 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: seed,
      skipBootstrap: true,
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => null,
    });
    expect(anchor.phase).toBe('anchored');
    expect(anchor.isFullyAnchored).toBe(true);
    expect(anchor.gpsPoint).toEqual(seed);
    anchor.dispose();
  });

  it('collects samples at 1 Hz and commits the median after `secondsToAccumulateGpsPose` samples', () => {
    const env = makeAnchorEnv();
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 5,
    });
    // 5 samples with strictly increasing lat — median = the middle one.
    const lats = [48.001, 48.002, 48.003, 48.004, 48.005];
    let elapsed = 0;
    for (const lat of lats) {
      elapsed += 1;
      currentSample = { lat, lon: 11.0 };
      anchor.__tickForTests(1, elapsed);
    }
    expect(anchor.phase).toBe('anchored');
    expect(anchor.isFullyAnchored).toBe(true);
    expect(anchor.gpsPoint.lat).toBeCloseTo(48.003, 6);
    expect(anchor.gpsPoint.lon).toBeCloseTo(11.0, 6);
    anchor.dispose();
  });

  it('median is robust to a single spike outlier', () => {
    const env = makeAnchorEnv();
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 5,
    });
    // Four clustered samples + one wildly outlier sample. The median
    // (sorted middle) is one of the clustered values — NOT the mean.
    const lats = [48.001, 48.002, 999.0, 48.003, 48.004];
    let elapsed = 0;
    for (const lat of lats) {
      elapsed += 1;
      currentSample = { lat, lon: 11.0 };
      anchor.__tickForTests(1, elapsed);
    }
    expect(anchor.isFullyAnchored).toBe(true);
    // Sorted: [48.001, 48.002, 48.003, 48.004, 999]; median = 48.003.
    expect(anchor.gpsPoint.lat).toBeCloseTo(48.003, 6);
    anchor.dispose();
  });

  it('honours a `settlingSeconds` window — samples in the settling window are ignored', () => {
    const env = makeAnchorEnv();
    const samples: GpsAnchorSamplePoint[] = [];
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => {
        samples.push(currentSample);
        return currentSample;
      },
      secondsToAccumulateGpsPose: 3,
      settlingSeconds: 4,
    });
    // Tick once per second for 10 seconds: ticks 1..4 are inside the
    // settling window and MUST NOT be sampled; ticks 5,6,7 are sampled.
    for (let t = 1; t <= 10; t++) {
      currentSample = { lat: 48.0 + t * 0.001, lon: 11.0 };
      anchor.__tickForTests(1, t);
      if (anchor.phase === 'anchored') break;
    }
    expect(samples.length).toBe(3);
    expect(anchor.isFullyAnchored).toBe(true);
    // Sampled values were t=5,6,7 → lats 48.005, 48.006, 48.007.
    expect(anchor.gpsPoint.lat).toBeCloseTo(48.006, 6);
    anchor.dispose();
  });

  it('skips a tick when `getCurrentGpsPoint` returns null (no GPS reading yet)', () => {
    const env = makeAnchorEnv();
    const samples: Array<GpsAnchorSamplePoint | null> = [];
    let currentSample: GpsAnchorSamplePoint | null = null;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => {
        samples.push(currentSample);
        return currentSample;
      },
      secondsToAccumulateGpsPose: 2,
    });
    // First two ticks: no GPS reading. Should NOT count as samples.
    anchor.__tickForTests(1, 1);
    anchor.__tickForTests(1, 2);
    expect(anchor.phase).toBe('bootstrap');
    expect(anchor.isFullyAnchored).toBe(false);
    // Now GPS comes online.
    currentSample = { lat: 48.001, lon: 11.0 };
    anchor.__tickForTests(1, 3);
    currentSample = { lat: 48.003, lon: 11.0 };
    anchor.__tickForTests(1, 4);
    expect(anchor.phase).toBe('anchored');
    expect(anchor.gpsPoint.lat).toBeCloseTo(48.002, 6); // median of [.001,.003]
    anchor.dispose();
  });

  it('`markMovedExternally()` resets the anchor to `bootstrap` and clears the sample buffer', () => {
    const env = makeAnchorEnv();
    let currentSample: GpsAnchorSamplePoint = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 2,
    });
    // Drive into `anchored` state.
    currentSample = { lat: 48.001, lon: 11.0 };
    anchor.__tickForTests(1, 1);
    currentSample = { lat: 48.003, lon: 11.0 };
    anchor.__tickForTests(1, 2);
    expect(anchor.phase).toBe('anchored');
    anchor.markMovedExternally();
    expect(anchor.phase).toBe('bootstrap');
    expect(anchor.isFullyAnchored).toBe(false);
    // Re-bootstrap with new samples.
    currentSample = { lat: 49.001, lon: 11.0 };
    anchor.__tickForTests(1, 10);
    currentSample = { lat: 49.003, lon: 11.0 };
    anchor.__tickForTests(1, 11);
    expect(anchor.phase).toBe('anchored');
    expect(anchor.gpsPoint.lat).toBeCloseTo(49.002, 6);
    anchor.dispose();
  });

  it('`dispose()` unregisters the anchor from the global frame loop', async () => {
    const env = makeAnchorEnv();
    const getCurrentGpsPoint = vi.fn<() => GpsAnchorSamplePoint | null>(() => ({
      lat: 48.0,
      lon: 11.0,
    }));
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint,
      secondsToAccumulateGpsPose: 999, // never finishes
    });
    const { runFrameUpdates } = await import('../ar/frame-loop.js');
    runFrameUpdates(1, 1);
    expect(getCurrentGpsPoint).toHaveBeenCalledTimes(1);
    anchor.dispose();
    runFrameUpdates(1, 2);
    expect(getCurrentGpsPoint).toHaveBeenCalledTimes(1);
  });

  it('throws when the parent chain already contains a `GpsAnchor`-managed object', () => {
    const env = makeAnchorEnv();
    const childObject = new THREE.Object3D();
    env.object3D.add(childObject);
    const parentAnchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.0, lon: 11.0 },
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => null,
    });
    expect(() =>
      createGpsAnchor({
        arWorldGroup: env.arWorldGroup,
        object3D: childObject,
        camera: env.camera,
        gpsPoint: { lat: 48.0, lon: 11.0 },
        getAlignmentMatrix: () => null,
        getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
        getCurrentGpsPoint: () => null,
      })
    ).toThrow(/nested/i);
    parentAnchor.dispose();
  });
});

/**
 * Sub-step 3 of the GpsAnchor port plan: steady-state in
 * `'snap-every-tick'` mode. The anchor MUST
 * - on each tick after bootstrap, compute the target local position
 *   from `calcRelativeCoordsInMeters(zeroRef, gpsPoint)` and write it
 *   to `object3D.position` (relying on its parent — `arWorldGroup`
 *   whose matrix IS the alignment matrix — to absorb the NUE→AR
 *   transform),
 * - skip the commit when the delta is below the (distance-scaled)
 *   threshold so on-screen pops are avoided,
 * - re-commit when `setGpsPoint` changes the target,
 * - NOT modify `object3D.position` while still in the `'bootstrap'`
 *   phase.
 *
 * The dual mode-gate (`'snap-when-offscreen'`) and the alignment-
 * matrix large-jump bypass are sub-step 4; they get their own tests.
 */
describe('createGpsAnchor — steady state (snap-every-tick)', () => {
  it('commits NUE target to object3D.position on the first tick after bootstrap', async () => {
    const env = makeAnchorEnv();
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: 48.001, lon: 11.0 }; // ~111 m north
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () =>
        Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const expected = calcRelativeCoordsInMeters(zero, target);
    expect(env.object3D.position.x).toBeCloseTo(expected[0], 3);
    expect(env.object3D.position.y).toBeCloseTo(expected[1], 3);
    expect(env.object3D.position.z).toBeCloseTo(expected[2], 3);
    anchor.dispose();
  });

  it('does NOT modify object3D.position while in the bootstrap phase', () => {
    const env = makeAnchorEnv();
    env.object3D.position.set(42, 43, 44);
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.001, lon: 11.0 },
      mode: 'snap-every-tick',
      getAlignmentMatrix: () =>
        Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      getGpsZeroRef: () => ({ lat: 48.0, lon: 11.0 }),
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.x).toBe(42);
    expect(env.object3D.position.y).toBe(43);
    expect(env.object3D.position.z).toBe(44);
    anchor.dispose();
  });

  it('re-commits when `setGpsPoint` changes the target by more than the threshold', async () => {
    const env = makeAnchorEnv();
    const zero = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: zero, // target == zero → local (0,0,0)
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () =>
        Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    // Move target 5 m north (well above the default 2 m threshold).
    const newTarget = { lat: zero.lat + 5 / 111319, lon: zero.lon };
    anchor.setGpsPoint(newTarget);
    anchor.__tickForTests(1, 2);
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const expected = calcRelativeCoordsInMeters(zero, newTarget);
    expect(env.object3D.position.x).toBeCloseTo(expected[0], 2);
    anchor.dispose();
  });

  it('skips the commit when the delta is below the distance threshold', () => {
    const env = makeAnchorEnv();
    const zero = { lat: 48.0, lon: 11.0 };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: zero,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      // Camera at origin, object commits to (0,0,0), so distanceFromCamera=0 → scale=1
      // and the default 2 m threshold applies as-is.
      getAlignmentMatrix: () =>
        Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1); // commits (0,0,0)
    // Move target 1 m north — below the 2 m threshold.
    const subThresholdTarget = { lat: zero.lat + 1 / 111319, lon: zero.lon };
    anchor.setGpsPoint(subThresholdTarget);
    anchor.__tickForTests(1, 2);
    // Position should not have changed.
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    expect(env.object3D.position.y).toBeCloseTo(0, 4);
    expect(env.object3D.position.z).toBeCloseTo(0, 4);
    anchor.dispose();
  });

  it('scales the threshold by `1 + distanceFromCamera/10` — same delta commits up close, skips far away', () => {
    const zero = { lat: 48.0, lon: 11.0 };
    // First scenario: camera at origin, object near origin → scale=1, threshold=2 m.
    // A 3 m delta exceeds it.
    {
      const env = makeAnchorEnv();
      const anchor = createGpsAnchor({
        ...env,
        gpsPoint: zero,
        skipBootstrap: true,
        mode: 'snap-every-tick',
        getAlignmentMatrix: () =>
          Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
        getGpsZeroRef: () => zero,
        getCurrentGpsPoint: () => null,
      });
      anchor.__tickForTests(1, 1); // commits (0,0,0)
      anchor.setGpsPoint({ lat: zero.lat + 3 / 111319, lon: zero.lon });
      anchor.__tickForTests(1, 2);
      expect(env.object3D.position.x).toBeGreaterThan(2); // committed to ~3 m
      anchor.dispose();
    }
    // Second scenario: object lives 100 m north of the camera → scale=11, threshold=22 m.
    // A 3 m delta is far below 22 m → skip.
    {
      const env = makeAnchorEnv();
      // Camera at origin; the object will commit to ~100 m north because we choose a
      // 100 m offset between zero and the anchor target.
      const farTarget = { lat: zero.lat + 100 / 111319, lon: zero.lon };
      const anchor = createGpsAnchor({
        ...env,
        gpsPoint: farTarget,
        skipBootstrap: true,
        mode: 'snap-every-tick',
        getAlignmentMatrix: () =>
          Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
        getGpsZeroRef: () => zero,
        getCurrentGpsPoint: () => null,
      });
      anchor.__tickForTests(1, 1); // commits ~ (100, 0, 0)
      const committedX = env.object3D.position.x;
      expect(committedX).toBeGreaterThan(90);
      // Move target 3 m further north — below the distance-scaled threshold (~22 m).
      anchor.setGpsPoint({ lat: zero.lat + 103 / 111319, lon: zero.lon });
      anchor.__tickForTests(1, 2);
      expect(env.object3D.position.x).toBeCloseTo(committedX, 3);
      anchor.dispose();
    }
  });

  it('skips the commit when `getGpsZeroRef` returns null (origin not yet established)', () => {
    const env = makeAnchorEnv();
    env.object3D.position.set(7, 8, 9);
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: { lat: 48.001, lon: 11.0 },
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () => null,
      getGpsZeroRef: () => null,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBe(7);
    expect(env.object3D.position.y).toBe(8);
    expect(env.object3D.position.z).toBe(9);
    anchor.dispose();
  });
});

/**
 * Sub-step 4 of the GpsAnchor port plan: `snap-when-offscreen` mode +
 * the alignment-matrix large-jump bypass. The anchor MUST
 * - skip the steady-state commit when the object is currently inside
 *   the camera frustum (even if the threshold gate would allow it),
 * - commit when the object is outside the camera frustum,
 * - bypass the on-screen mode gate when the alignment matrix has
 *   jumped by more than `2°` rotation, `4 m` translation, or `20 m`
 *   on the Y axis between the previous and current tick.
 *
 * Tests use a real `THREE.Mesh` (not `Object3D`) because the
 * frustum-visibility module's `isObjectInCameraFrustum` requires a
 * geometry/bounding-sphere to evaluate.
 */
function makeMeshAnchorEnv() {
  const arWorldGroup = new THREE.Group();
  const object3D = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshBasicMaterial()
  );
  arWorldGroup.add(object3D);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  return { arWorldGroup, object3D, camera };
}

const IDENTITY_MATRIX16: readonly number[] = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

function translationMatrix16(
  tx: number,
  ty: number,
  tz: number
): readonly number[] {
  // Column-major 4×4 with translation in the last column.
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
}

function setupSceneFor(env: ReturnType<typeof makeMeshAnchorEnv>): void {
  env.arWorldGroup.updateMatrixWorld(true);
  env.camera.updateMatrixWorld(true);
  // matrixWorldInverse is derived; recompute it explicitly because we
  // construct the frustum from `projectionMatrix × matrixWorldInverse`
  // and tests don't go through `renderer.render`.
  env.camera.matrixWorldInverse.copy(env.camera.matrixWorld).invert();
}

describe('createGpsAnchor — steady state (snap-when-offscreen)', () => {
  it('does NOT commit when the object is currently inside the camera frustum', () => {
    const env = makeMeshAnchorEnv();
    // Camera looks at the origin from 5 m back along +Z → object at (0,0,0) is on-screen.
    env.camera.position.set(0, 0, 5);
    env.camera.lookAt(0, 0, 0);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    // 10 m north target → posDelta = 10 m, scale ≈ 1.5 (distance ≈ 5 m), threshold ≈ 3 m → gate passes.
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => IDENTITY_MATRIX16,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    // Mode gate suppresses the commit; object stays at (0,0,0).
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    expect(env.object3D.position.y).toBeCloseTo(0, 4);
    expect(env.object3D.position.z).toBeCloseTo(0, 4);
    anchor.dispose();
  });

  it('commits when the object is outside the camera frustum', () => {
    const env = makeMeshAnchorEnv();
    // Camera looks *away* from the origin → (0,0,0) is behind the camera and off-screen.
    env.camera.position.set(0, 0, -5);
    env.camera.lookAt(0, 0, -10);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => IDENTITY_MATRIX16,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeGreaterThan(8); // ~10 m
    anchor.dispose();
  });

  it('large translation jump in the alignment matrix bypasses the on-screen mode gate', () => {
    const env = makeMeshAnchorEnv();
    env.camera.position.set(0, 0, 5);
    env.camera.lookAt(0, 0, 0);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    let matrix: readonly number[] = IDENTITY_MATRIX16;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => matrix,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    // Tick 1: establishes baseline alignment. Object is on-screen → no commit.
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    // Tick 2: alignment matrix jumps by 10 m translation (> 4 m large-jump threshold).
    matrix = translationMatrix16(10, 0, 0);
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.x).toBeGreaterThan(8); // committed despite on-screen
    anchor.dispose();
  });

  it('small alignment-matrix delta does NOT bypass the on-screen mode gate', () => {
    const env = makeMeshAnchorEnv();
    env.camera.position.set(0, 0, 5);
    env.camera.lookAt(0, 0, 0);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    let matrix: readonly number[] = IDENTITY_MATRIX16;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => matrix,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    // Tiny 1 m translation — below the 4 m large-jump threshold → no bypass.
    matrix = translationMatrix16(1, 0, 0);
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    anchor.dispose();
  });

  it('large Y-only jump (>20 m) bypasses the on-screen mode gate', () => {
    const env = makeMeshAnchorEnv();
    env.camera.position.set(0, 0, 5);
    env.camera.lookAt(0, 0, 0);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    let matrix: readonly number[] = IDENTITY_MATRIX16;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => matrix,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    // Y jump of 25 m exceeds the 20 m Y-only threshold (also exceeds the 4 m
    // total-translation threshold, but the explicit Y check is what we're locking in here).
    matrix = translationMatrix16(0, 25, 0);
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.x).toBeGreaterThan(8);
    anchor.dispose();
  });

  it('large rotation jump (>2°) bypasses the on-screen mode gate', () => {
    const env = makeMeshAnchorEnv();
    env.camera.position.set(0, 0, 5);
    env.camera.lookAt(0, 0, 0);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    // 30° rotation around Y axis (well above 2°).
    const angle = (30 * Math.PI) / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rotated: readonly number[] = [
      c,
      0,
      -s,
      0,
      0,
      1,
      0,
      0,
      s,
      0,
      c,
      0,
      0,
      0,
      0,
      1,
    ];
    let matrix: readonly number[] = IDENTITY_MATRIX16;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => matrix,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => null,
    });
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    matrix = rotated;
    anchor.__tickForTests(1, 2);
    expect(env.object3D.position.x).toBeGreaterThan(8);
    anchor.dispose();
  });
});

/**
 * Sub-step 5 of the GpsAnchor port plan: `markMovedExternally()`
 * interplay with the steady-state loop. The anchor MUST
 * - stop committing position updates while back in the `'bootstrap'`
 *   phase after `markMovedExternally()`,
 * - resume steady-state commits using the *new* median target once
 *   the re-bootstrap completes,
 * - NOT inherit a stale large-jump baseline from before the move
 *   (the first steady-state tick after re-bootstrap MUST NOT
 *   spuriously trigger the bypass).
 */
describe('createGpsAnchor — re-bootstrap on external move', () => {
  it('stops committing position updates while back in `bootstrap` and resumes after the new median is committed', async () => {
    const env = makeAnchorEnv();
    const zero = { lat: 48.0, lon: 11.0 };
    let currentSample: GpsAnchorSamplePoint = zero;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: zero,
      skipBootstrap: true,
      mode: 'snap-every-tick',
      getAlignmentMatrix: () => IDENTITY_MATRIX16,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 2,
    });
    // Steady state commits (0,0,0).
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);

    // External move: re-enter bootstrap.
    anchor.markMovedExternally();
    expect(anchor.phase).toBe('bootstrap');

    // While in bootstrap, even if the alignment matrix or zero ref changes,
    // the position MUST NOT be committed.
    env.object3D.position.set(-7, -8, -9);
    currentSample = { lat: zero.lat + 100 / 111319, lon: zero.lon };
    anchor.__tickForTests(1, 10); // first sample
    expect(env.object3D.position.x).toBe(-7);
    expect(env.object3D.position.y).toBe(-8);
    expect(env.object3D.position.z).toBe(-9);

    // Second sample completes the (size-2) bootstrap → phase flips to anchored.
    anchor.__tickForTests(1, 11);
    expect(anchor.phase).toBe('anchored');
    expect(anchor.gpsPoint.lat).toBeCloseTo(zero.lat + 100 / 111319, 6);

    // Next tick is the first steady-state tick post-rebootstrap; it must commit
    // to the NEW median target, not silently inherit any prior state.
    anchor.__tickForTests(1, 12);
    const { calcRelativeCoordsInMeters } = await import('../core/index.js');
    const expected = calcRelativeCoordsInMeters(zero, anchor.gpsPoint);
    expect(env.object3D.position.x).toBeCloseTo(expected[0], 2);
    anchor.dispose();
  });

  it('does NOT inherit a stale large-jump baseline across `markMovedExternally`', () => {
    const env = makeMeshAnchorEnv();
    env.camera.position.set(0, 0, 5);
    env.camera.lookAt(0, 0, 0);
    setupSceneFor(env);
    const zero = { lat: 48.0, lon: 11.0 };
    const target = { lat: zero.lat + 10 / 111319, lon: zero.lon };
    let matrix: readonly number[] = IDENTITY_MATRIX16;
    let currentSample: GpsAnchorSamplePoint = target;
    const anchor = createGpsAnchor({
      ...env,
      gpsPoint: target,
      skipBootstrap: true,
      mode: 'snap-when-offscreen',
      getAlignmentMatrix: () => matrix,
      getGpsZeroRef: () => zero,
      getCurrentGpsPoint: () => currentSample,
      secondsToAccumulateGpsPose: 1,
    });
    // Tick 1: establishes the alignment baseline (identity). On-screen → no commit.
    anchor.__tickForTests(1, 1);
    expect(env.object3D.position.x).toBeCloseTo(0, 4);

    // Big alignment jump while still "anchored", then external move.
    matrix = translationMatrix16(100, 0, 0);
    anchor.markMovedExternally();
    currentSample = target;
    anchor.__tickForTests(1, 2); // bootstrap sample → re-anchored
    expect(anchor.phase).toBe('anchored');

    // Next tick is the first steady-state tick post-rebootstrap. The previous
    // alignment-matrix snapshot has been cleared, so the bypass MUST NOT fire
    // even though the matrix is wildly different from the (cleared) baseline.
    // Object stays at the post-bootstrap reset position.
    env.object3D.position.set(0, 0, 0);
    anchor.__tickForTests(1, 3);
    // No bypass + on-screen mode gate → no commit despite the big "first" matrix.
    expect(env.object3D.position.x).toBeCloseTo(0, 4);
    anchor.dispose();
  });
});
