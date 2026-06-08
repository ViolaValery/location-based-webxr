/**
 * Own the single live ArWorldGroupAlignment binding across AR session restarts.
 *
 * Why this exists: `enableArWorldGroupAlignment` GPS-registers the AR view by
 * registering a per-frame lerp callback + a store subscription bound to the
 * `arWorldGroup` it was handed. Every AR `running` transition hands the app a
 * FRESH `arWorldGroup` — the framework rebuilds the scene hierarchy per session
 * and nulls the old reference on teardown (see the framework's
 * `webxr-session.ts`). So re-enabling alignment on a session restart without
 * disposing the previous binding leaves the old per-frame callback ticking
 * forever against the now-detached group (wasted CPU, and it pins the old group
 * from GC). This wrapper holds at most one binding: `bind()` disposes the prior
 * one before creating the next, and `dispose()` releases it on session end.
 *
 * The framework's own doc note on `enableArWorldGroupAlignment` makes this the
 * caller's responsibility ("Idempotency / double-drive is the caller's
 * concern"); this module is that caller-side bookkeeping, kept here (rather than
 * inline in `main.ts`) so the dispose-on-restart contract is unit-testable
 * without a device.
 *
 * `enable` is injected by the caller (which already imports the real framework
 * helper). Importing it here only as a TYPE keeps this module — and its unit
 * test — free of the `/visualization` barrel's runtime deps (leaflet, three
 * scene setup), so the lifecycle can be verified in a headless node test.
 */
import type { ArWorldGroupAlignmentHandle } from 'gps-plus-slam-app-framework/visualization';
import type { SubscribableStore } from 'gps-plus-slam-app-framework/state';
import type { Object3D } from 'three';

/**
 * The slice of `enableArWorldGroupAlignment`'s signature this module relies on.
 * The real helper (with its optional `lerpRate`) is assignable to this.
 */
export type EnableArWorldGroupAlignment = (options: {
  store: SubscribableStore;
  arWorldGroup: Object3D;
}) => ArWorldGroupAlignmentHandle;

export interface AlignmentBinding {
  /** (Re)bind alignment to `arWorldGroup`, disposing any previous binding. */
  bind(arWorldGroup: Object3D): void;
  /** Dispose the current binding, if any (idempotent). */
  dispose(): void;
}

export function createAlignmentBinding(deps: {
  readonly store: SubscribableStore;
  readonly enable: EnableArWorldGroupAlignment;
}): AlignmentBinding {
  let handle: ArWorldGroupAlignmentHandle | null = null;

  return {
    bind(arWorldGroup: Object3D): void {
      // Dispose BEFORE re-enabling so there is never a window with two live
      // per-frame callbacks driving (different) groups at once.
      handle?.dispose();
      handle = deps.enable({ store: deps.store, arWorldGroup });
    },
    dispose(): void {
      handle?.dispose();
      handle = null;
    },
  };
}
