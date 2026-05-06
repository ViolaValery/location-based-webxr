# `combined-root-state.ts`

## Purpose

Back-compat type alias `CombinedRootState` representing the combined Redux
state shape of `library + recorder + refPoints`. Lives separately so framework
modules can import the type without pulling in the (now recorder-side) store
factory.

## Public API

- `CombinedRootState` — `SlamAppCombinedState<{ refPoints: Reducer<RefPointsState> }>`.

## Invariants & Assumptions

- Type-only module: emits no runtime code.
- The `recorder` slice is always present (via `SlamAppRootState` in
  `create-slam-app-store.ts`); only `refPoints` is added on top.
- Apps that compose `createSlamAppStore` with additional reducers should
  define their own combined-state type, not reuse this one.

## Tests

No dedicated tests — exercised transitively by `app-selectors.test.ts`,
`recording-replayer.test.ts`, `store-subscribers.test.ts`, etc.
