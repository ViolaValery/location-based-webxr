# persistence-middleware.performance.test.ts

## Purpose

Regression guard for the persistence middleware's **synchronous dispatch overhead**. Runs on every `pnpm test`. It asserts the *algorithmic invariant* (cost stays O(1) per dispatch) rather than a wall-clock budget, so it cannot flake on scheduler noise the way a hard ms threshold does.

> **History:** an earlier version compared a single per-dispatch wall-clock sample against a hard `0.1 ms` threshold and flaked intermittently under full-suite load (see [GpsPlusSlamJs_Docs/docs/2026-06-15-followup-flaky-persistence-perf-test.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-followup-flaky-persistence-perf-test.md)). Replaced with the scaling-ratio approach below.

## What it measures

The middleware executes synchronous logic on every Redux dispatch during recording:

1. Read `action.type` string
2. Capture `isRecording` state before reducer
3. Call `next(action)` (reducer runs)
4. Check action type prefix (`gpsData/`, `recorder/`)
5. Increment action index
6. Enqueue write function to `WriteQueue`

The async OPFS write is non-blocking and **not measured** — only the synchronous part matters for dispatch latency.

## Public API (test surface)

Both tests measure the **median per-dispatch time** for a small burst (200) and a 20× larger burst (4000), each over 5 passes, after a JIT warm-up. The primary assertion is on the **large/small ratio**; a generous absolute ceiling is a backstop only.

- `…during recording stays O(1) as the burst grows` — recording=true, so each dispatch enqueues to the `WriteQueue`.
  - Asserts `ratio ≤ 4` (O(1) yields ~1; an O(n) hot-path regression lands near 20×).
  - Backstop: large-burst per-dispatch `≤ 1 ms`.
- `…when NOT recording stays O(1) as the burst grows` — recording=false, middleware early-exits (no enqueue).
  - Same `ratio ≤ 4` and `≤ 1 ms` backstop.

## Invariants & assumptions

- `StorageBackend.writeAction` resolves instantly (`Promise.resolve`) — isolates middleware overhead from I/O.
- A **fresh store per measurement pass**: microtasks that drain the `WriteQueue` cannot fire inside the synchronous dispatch loop, so during a burst the queue grows to the burst size. Reusing a store would let it grow unbounded across passes and pollute the comparison. This growth is also exactly the condition under which an accidental O(n) enqueue would surface.
- Redux `serializableCheck` and `immutableCheck` are disabled (matches production config).
- The ratio is robust to machine speed/load because both the small and large figures scale together; only a change in *complexity class* moves it.
- Set `DEBUG_PERF=1` to log the small/large/ratio figures.

## Test data

No external fixtures. Uses minimal inline Redux slices (`recorder` + `gpsData`) that mirror the structure in `persistence-middleware.test.ts`.

## Related files

- [persistence-middleware.ts](persistence-middleware.ts) — production implementation
- [persistence-middleware.test.ts](persistence-middleware.test.ts) — functional/unit tests (16 tests)
- [persistence-middleware.ts.md](persistence-middleware.ts.md) — component documentation
