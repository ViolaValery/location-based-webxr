import { describe, expect, it, vi } from 'vitest';
import { Group } from 'three';
import type { SubscribableStore } from 'gps-plus-slam-app-framework/state';
import type { ArWorldGroupAlignmentHandle } from 'gps-plus-slam-app-framework/visualization';

import { createAlignmentBinding } from './alignment-binding.js';

// Why this test matters:
// Every AR `running` transition hands the app a FRESH `arWorldGroup` (the
// framework rebuilds the scene hierarchy per session and nulls the old
// reference on teardown). `enableArWorldGroupAlignment` registers a per-frame
// lerp callback + a store subscription bound to whichever group it was given.
// If a session restart re-enables alignment without disposing the previous
// binding, the old binding keeps ticking every frame forever against the now
// detached group (a leak + wasted CPU, and it pins the old group from GC). This
// module owns the single live binding so at most one is ever active; these
// tests lock that contract in headlessly (the real frame loop / three.js scene
// is on-device only).

/** A fake `enable` that hands back a handle whose `dispose` is a spy. */
function fakeEnable() {
  const disposes: Array<ReturnType<typeof vi.fn>> = [];
  const calls: Array<{ store: unknown; arWorldGroup: unknown }> = [];
  const enable = vi.fn(
    (options: {
      store: SubscribableStore;
      arWorldGroup: object;
    }): ArWorldGroupAlignmentHandle => {
      calls.push({ store: options.store, arWorldGroup: options.arWorldGroup });
      const dispose = vi.fn();
      disposes.push(dispose);
      return { dispose };
    }
  );
  return { enable, disposes, calls };
}

const store = {} as unknown as SubscribableStore;

describe('createAlignmentBinding', () => {
  it('enables alignment on the first bind without disposing anything', () => {
    const { enable, disposes } = fakeEnable();
    const binding = createAlignmentBinding({ store, enable });

    binding.bind(new Group());

    expect(enable).toHaveBeenCalledTimes(1);
    expect(disposes).toHaveLength(1);
    expect(disposes[0]).not.toHaveBeenCalled();
  });

  it('forwards the store and the given arWorldGroup to enable', () => {
    const { enable, calls } = fakeEnable();
    const binding = createAlignmentBinding({ store, enable });
    const group = new Group();

    binding.bind(group);

    expect(calls[0]).toEqual({ store, arWorldGroup: group });
  });

  it('disposes the previous binding before re-enabling on a session restart', () => {
    const { enable, disposes } = fakeEnable();
    const binding = createAlignmentBinding({ store, enable });

    const first = new Group();
    const second = new Group();
    binding.bind(first);
    binding.bind(second);

    // The first handle is disposed exactly once; a second handle is created.
    expect(enable).toHaveBeenCalledTimes(2);
    expect(disposes[0]).toHaveBeenCalledTimes(1);
    expect(disposes[1]).not.toHaveBeenCalled();
  });

  it('disposes the previous handle BEFORE creating the next one', () => {
    const order: string[] = [];
    const enable = vi.fn((): ArWorldGroupAlignmentHandle => {
      order.push('enable');
      return { dispose: () => order.push('dispose') };
    });
    const binding = createAlignmentBinding({ store, enable });

    binding.bind(new Group());
    binding.bind(new Group());

    // Guards against the leak window where the old per-frame callback would
    // still be live while the new one is already ticking.
    expect(order).toEqual(['enable', 'dispose', 'enable']);
  });

  it('dispose() releases the current handle and is idempotent', () => {
    const { enable, disposes } = fakeEnable();
    const binding = createAlignmentBinding({ store, enable });

    binding.bind(new Group());
    binding.dispose();
    binding.dispose();

    expect(disposes[0]).toHaveBeenCalledTimes(1);
  });

  it('dispose() before any bind is a no-op', () => {
    const { enable } = fakeEnable();
    const binding = createAlignmentBinding({ store, enable });

    expect(() => binding.dispose()).not.toThrow();
    expect(enable).not.toHaveBeenCalled();
  });

  it('binds again cleanly after a dispose', () => {
    const { enable, disposes } = fakeEnable();
    const binding = createAlignmentBinding({ store, enable });

    binding.bind(new Group());
    binding.dispose();
    binding.bind(new Group());

    // No stale handle to dispose on the second bind (the first was already
    // released by dispose()), so only two enables and one dispose total.
    expect(enable).toHaveBeenCalledTimes(2);
    expect(disposes[0]).toHaveBeenCalledTimes(1);
    expect(disposes[1]).not.toHaveBeenCalled();
  });
});
