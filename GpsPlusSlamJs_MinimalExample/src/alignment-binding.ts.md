# `alignment-binding.ts`

## Purpose

Own the **single live** `ArWorldGroupAlignment` binding across AR session
restarts, so the minimal example never leaks a per-frame lerp callback / store
subscription against a detached `arWorldGroup`.

## Background

`enableArWorldGroupAlignment` (framework `visualization`) GPS-registers the AR
view: it registers a per-frame lerp update **and** a store subscription, both
bound to the specific `arWorldGroup` it was handed, and returns an
`ArWorldGroupAlignmentHandle { dispose() }`.

Every AR `running` transition hands the app a **fresh** `arWorldGroup` — the
framework rebuilds the scene hierarchy per session and nulls the old reference
on teardown (`GpsPlusSlamJs_AppFramework/src/ar/webxr-session.ts`). Re-enabling
alignment on a restart **without disposing the previous binding** leaves the old
per-frame callback ticking forever against the now-detached group (wasted CPU,
and it pins the old group from GC). The framework explicitly delegates this to
the caller ("Idempotency / double-drive is the caller's concern").

## Public API

- `createAlignmentBinding({ store, enable }) → AlignmentBinding`
  - `store: SubscribableStore` — forwarded to `enable` on every `bind`.
  - `enable: EnableArWorldGroupAlignment` — injected; production passes the real
    `enableArWorldGroupAlignment`. Injected (not imported as a value) so this
    module and its test stay free of the `/visualization` barrel's runtime deps
    (leaflet needs `window`; unavailable in the headless node test env).
- `AlignmentBinding.bind(arWorldGroup)` — disposes any previous binding, then
  enables alignment on `arWorldGroup`. At most one binding is ever live.
- `AlignmentBinding.dispose()` — releases the current binding; idempotent;
  a no-op before the first `bind`.

## Invariants & assumptions

- **Dispose-before-create:** `bind` disposes the prior handle *before* creating
  the next, so there is never a window with two live per-frame callbacks.
- At most one binding is active at any time.
- `dispose()` is safe to call any number of times and with nothing bound.
- The injected `enable` must return a handle whose `dispose()` removes both the
  frame update and the store subscription (the real helper does).

## Usage (`main.ts`)

```ts
const alignmentBinding = createAlignmentBinding({
  store: store as unknown as SubscribableStore,
  enable: enableArWorldGroupAlignment,
});

// on each `running` transition (fresh arWorldGroup):
const arWorldGroup = getArWorldGroup();
if (arWorldGroup) alignmentBinding.bind(arWorldGroup);

// on any non-running state (stopping / error / resting ready):
alignmentBinding.dispose();
```

## Tests

`alignment-binding.test.ts` (headless, node env) covers: first bind enables
without disposing; store + group forwarded; restart disposes the previous handle
exactly once; dispose happens **before** the next create; `dispose()` idempotent;
`dispose()` before any bind is a no-op; clean re-bind after a dispose.
