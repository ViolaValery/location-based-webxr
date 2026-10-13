/**
 * The surroundings as a mesh, for the creator's cursor (polish round M5,
 * B3, behind `?mesh=1` - Q-Mesh): depth samples fold into an occupancy
 * grid, an off-thread mesher turns it into the framework's depth-only
 * occluder mesh under the world group, and `pick()` casts the screen centre
 * against it - the point the reticle then sits on (`startHitTestReticle`'s
 * `surfacePick`). The pieces are the framework's (`OccupancyGrid`,
 * `createOccluderSink`, `createOccluderMeshWorker`, `subscribeReplayOccupancy`,
 * `raycastPointer`); this composes them for one AR session.
 *
 * @see mesh-surface.ts.md
 */

import type { Camera, Intersection, Object3D } from "three";
import { OccupancyGrid } from "gps-plus-slam-app-framework/ar/occupancy-grid";
import type { DepthSamplerConfig } from "gps-plus-slam-app-framework/ar/depth-sampler";
import {
  subscribeReplayOccupancy,
  type DepthSampleStore,
} from "gps-plus-slam-app-framework/state/replay-occupancy-subscriber";
import { raycastPointer } from "gps-plus-slam-app-framework/visualization/pointer-picking";
import {
  createOccluderSink,
  type OccluderSinkHandle,
} from "gps-plus-slam-app-framework/visualization/occluder-sink";
import { createOccluderMeshWorker } from "gps-plus-slam-app-framework/visualization/occluder-mesh-worker-client";
import type { SurfacePoint } from "gps-plus-slam-app-framework/ar/hit-test-reticle-driver";

/** Depth at the reconstruction density (the RecorderApp's and the physics
 *  demo's): 16 x 16 at 1 Hz, the troubleshooting recording's, is too
 *  sparse for a mesh (polish round M5). */
export const MESH_DEPTH: Partial<DepthSamplerConfig> = {
  intervalMs: 200,
  gridSize: 24,
  rgb: false,
};

/** The grid's cell (m) and the confidence a cell needs to be meshed: the
 *  RecorderApp's defaults. */
const CELL_SIZE_M = 0.15;
const MIN_CONFIDENCE = 2;
/** Mesh only around the creator: a walk's grid grows, a re-mesh of all of
 *  it would grow with it (the RecorderApp's camera window). */
const MESH_RADIUS_M = 12;
/** How many frame gaps the readout keeps (about two seconds). */
const FRAME_GAPS_KEPT = 120;

/** The screen centre, as normalised device coordinates. */
const SCREEN_CENTRE = { x: 0, y: 0 };

/** The world point and the world normal of a raycast hit, or null. */
export function surfacePointFromHit(
  hit: Intersection | null,
): SurfacePoint | null {
  if (hit === null || hit.face === null || hit.face === undefined) return null;
  const normal = hit.face.normal
    .clone()
    .transformDirection(hit.object.matrixWorld);
  return { position: hit.point.clone(), normal };
}

/** The median and the worst of the frame gaps (ms), or null with none. */
export function frameTimeStats(
  gaps: readonly number[],
): { median: number; worst: number } | null {
  if (gaps.length === 0) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor((sorted.length - 1) / 2)]!,
    worst: sorted[sorted.length - 1]!,
  };
}

export interface MeshSurfaceStats {
  /** Frame gaps measured between picks (one pick per frame). */
  frameMs: { median: number; worst: number } | null;
  /** Triangles in the current mesh. */
  triangles: number;
}

export interface MeshSurface {
  /** The surface point under the screen centre, or null (no mesh there). */
  pick(): SurfacePoint | null;
  stats(): MeshSurfaceStats;
  /** Stop feeding, free the mesh and the worker (idempotent). */
  dispose(): void;
}

export function createMeshSurface(deps: {
  /** The world group the mesh hangs under (it rides the alignment). */
  parent: Object3D;
  /** The store whose `recording.latestDepthSample` is folded in. */
  store: DepthSampleStore;
  getCamera: () => Camera | null;
  /** The app's mesh worker (`new Worker(new URL(...))`); absent: the
   *  mesher runs on the main thread (the driver's fallback). */
  createWorker?: () => Worker;
  /** Injectable for tests. */
  createSink?: (parent: Object3D) => OccluderSinkHandle;
  subscribe?: typeof subscribeReplayOccupancy;
  now?: () => number;
}): MeshSurface {
  const now = deps.now ?? (() => performance.now());
  const grid = new OccupancyGrid({ cellSizeM: CELL_SIZE_M });
  const handle = (
    deps.createSink ??
    ((parent: Object3D) =>
      createOccluderSink(
        parent,
        {
          meshMode: "corner-fit",
          debugStyle: "off",
          radiusM: MESH_RADIUS_M,
          minConfidence: MIN_CONFIDENCE,
        },
        {
          createWorker: () =>
            createOccluderMeshWorker(
              deps.createWorker ??
                (() => {
                  throw new Error("no mesh worker: meshing on the main thread");
                }),
            ),
        },
      ))
  )(deps.parent);
  const unsubscribe = (deps.subscribe ?? subscribeReplayOccupancy)({
    store: deps.store,
    grid,
    onRefresh: (pose) => {
      handle.sink.refresh(grid, pose);
    },
    refreshIntervalMs: MESH_DEPTH.intervalMs,
  });
  let disposed = false;
  let lastPickAt: number | null = null;
  const gaps: number[] = [];

  function noteFrame(): void {
    const at = now();
    if (lastPickAt !== null) {
      gaps.push(at - lastPickAt);
      if (gaps.length > FRAME_GAPS_KEPT) gaps.shift();
    }
    lastPickAt = at;
  }

  return {
    pick() {
      if (disposed) return null;
      noteFrame();
      const camera = deps.getCamera();
      if (camera === null) return null;
      return surfacePointFromHit(
        raycastPointer(camera, SCREEN_CENTRE, [handle.mesh()]),
      );
    },
    stats() {
      const geometry = (
        handle.mesh() as { geometry?: { index?: { count: number } | null } }
      ).geometry;
      return {
        frameMs: frameTimeStats(gaps),
        triangles: Math.floor((geometry?.index?.count ?? 0) / 3),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      handle.dispose();
    },
  };
}

/** A readout line for `?mesh=1` (the frame time the owner judges it by). */
export function meshSurfaceLine(stats: MeshSurfaceStats): string {
  const frame =
    stats.frameMs === null
      ? "frame -"
      : `frame ${String(Math.round(stats.frameMs.median))}/${String(
          Math.round(stats.frameMs.worst),
        )} ms`;
  return `mesh: ${String(stats.triangles)} triangles · ${frame}`;
}
