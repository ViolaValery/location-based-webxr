/**
 * Property-based tests for `buildMapData` — the D2 fused-path contract.
 *
 * The defining invariant of the unified map model is **D2**: for ANY alignment
 * matrix, the fused path equals `computeFusedPath` evaluated over ALL odometry
 * positions with that matrix. A single property captures this exactly and
 * would catch any regression that reintroduces per-event frozen fused points
 * (the live-map bug described in
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-user-feedback.md
 * Finding 2). We use RIGID matrices (rotation + translation, unit scale),
 * mirroring the real alignment matrix whose scale ≈ 1.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';
import { buildMapData } from './map-data';
import { computeFusedPath } from '../utils/fused-path';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';

const arbUnit = fc.double({ min: -1, max: 1, noNaN: true });
const arbAngle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const arbT = fc.double({ min: -50, max: 50, noNaN: true });

/** A random rigid 4×4 alignment matrix as a column-major 16-array. */
const arbRigidAlignment = fc
  .record({
    ax: arbUnit,
    ay: arbUnit,
    az: arbUnit,
    angle: arbAngle,
    tx: arbT,
    ty: arbT,
    tz: arbT,
  })
  .map(({ ax, ay, az, angle, tx, ty, tz }) => {
    const axis = new THREE.Vector3(ax, ay, az);
    if (axis.lengthSq() < 1e-6) axis.set(1, 2, 3);
    axis.normalize();
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(tx, ty, tz),
      quat,
      new THREE.Vector3(1, 1, 1)
    );
    return m.toArray() as unknown as Matrix4;
  });

const arbOdom = fc.array(
  fc.tuple(
    fc.double({ min: -100, max: 100, noNaN: true }),
    fc.double({ min: -100, max: 100, noNaN: true }),
    fc.double({ min: -100, max: 100, noNaN: true })
  ),
  { maxLength: 30 }
) as fc.Arbitrary<Vector3[]>;

const ZERO_REF = { lat: 50.0, lon: 8.0 } as const;

describe('buildMapData — property: D2 fused path', () => {
  it('fusedPath always equals computeFusedPath over all odometry for any matrix', () => {
    fc.assert(
      fc.property(arbRigidAlignment, arbOdom, (matrix, odom) => {
        const data = buildMapData({
          odometryPositions: odom,
          alignmentMatrix: matrix,
          zeroRef: ZERO_REF,
        });
        const expected = computeFusedPath({
          odometryPositions: odom,
          alignmentMatrix: matrix,
          zeroRef: ZERO_REF,
        });
        expect(data.fusedPath).toEqual(expected);
        // One fused point per odometry position (no dropping, no per-event freeze).
        expect(data.fusedPath.length).toBe(odom.length);
      }),
      { numRuns: 100 }
    );
  });
});
