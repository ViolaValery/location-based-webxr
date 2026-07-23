# Persistence Component Implementation Plan (Frozen)

## Overview

The `persistence` component is the browser-side durability layer for the offline-first editor. Its precise responsibility is to take the current in-memory KMZ/KML state, keep track of the active file binding, and write the latest committed bytes back to durable storage without introducing any new document semantics.

This component exists between the edit/command layer and the browser file system capabilities. It does not parse KML, does not mutate feature geometry, and does not decide which edits are valid. It only persists the current container state and reports save status.

### Boundaries

**What it owns**

- The save lifecycle for the active file binding.
- The current persistence mode: native file binding or fallback working-copy/export mode.
- Debounce scheduling for autosave.
- Atomic write sequencing and retry control.
- Save status transitions (`idle`, `saving`, `saved`, `error`).
- Resource clean-up for timers, temporary working files, and any browser object URLs used for export.

**What it never owns**

- KML parsing, serialization, or byte-faithful mutation rules.
- KMZ archive structure, asset resolution, or `doc.kml` surgery.
- Selection state, editor state, command history, renderer state, or AR state.
- Any cross-component interface beyond the existing contracts.
- Server sync, background upload, or any backend persistence.

**Contracts it consumes**

- `IKmzContainer` from the existing KMZ container contract.
- `IPersistenceService`, `SaveStatus` from the existing persistence contract.

**Contracts it implements**

- `IPersistenceService`

### Architectural assumption

The contract already fixed by the project is the only surface this component may implement. No new persistence-specific cross-component interface is introduced. The persistence layer must therefore work entirely by orchestrating the existing `IKmzContainer` and the browser file system APIs around it.

## Internal Architecture

The component should be split into small modules with one job each. The goal is to keep the save logic deterministic and testable while avoiding coupling to editor or model details.

### 1. `PersistenceServiceImpl`

**Responsibility**

Owns the public `IPersistenceService` behaviour, status, open/save/flush entry points, and lifecycle. It is the only orchestration object other components see.

**Inputs**

- `File` when the caller provides one directly.
- A native file picker selection when `open()` is called without a `File`.
- `IKmzContainer` instances for save/flush/download.

**Outputs**

- Returns the active `IKmzContainer` from `open()`.
- Emits save status changes.
- Writes bytes to the active native file binding or the fallback export path.

**Dependencies**

- `ContainerSession` to remember the current binding and mode.
- `SaveScheduler` to debounce writes.
- `WriteBackend` implementations for native file access and fallback export.
- `StatusMachine` for predictable state transitions.

**Invariants**

- At most one active session is owned at a time.
- Only the most recent dirty state is flushed.
- The service never rewrites bytes itself; it only forwards the bytes returned by `container.save()`.
- A failed save must not discard the current in-memory container.

### 2. `ContainerSession`

**Responsibility**

Stores the currently open container and the metadata required to persist it: whether the session is bound to a native writable handle, whether it is operating in fallback mode, and whether the current session is dirty.

**Inputs**

- The `IKmzContainer` returned by `open()`.
- Persistence mode decisions from file access capability detection.
- Change notifications from `notifyChange()`.

**Outputs**

- Current persistence target configuration.
- A stable session version that can be used to ignore stale writes after reopen.

**Dependencies**

- `StatusMachine`.

**Invariants**

- A session is always either bound to one active file target or explicitly detached into fallback/export mode.
- Reopening a file invalidates the previous session version.
- A stale timer or in-flight write from an older session must not update the new session state.

### 3. `SaveScheduler`

**Responsibility**

Coalesces repeated change notifications into one save. This module owns the debounce timer and the rule that changes arriving during a save schedule one follow-up save after the current write finishes.

**Inputs**

- `notifyChange()` calls.
- `save()` and `flush()` requests.
- session version and dirty state.

**Outputs**

- A single scheduled save request once the debounce window expires.
- A follow-up request when a write completes and the session was dirtied again in the meantime.

**Dependencies**

- `StatusMachine`.
- `WriteCoordinator`.

**Invariants**

- Multiple calls inside the debounce window collapse to one write.
- `flush()` bypasses the timer but not the serialization step.
- The scheduler never runs two writes concurrently for the same session.

### 4. `WriteCoordinator`

**Responsibility**

Turns the current container state into bytes and hands those bytes to the selected backend.

**Inputs**

- The active `IKmzContainer`.
- The selected `WriteBackend`.
- The current session version.

**Outputs**

- A committed save or a controlled error state.

**Dependencies**

- `container.save()` for byte materialization.
- `StatusMachine` for status transitions.

**Invariants**

- `container.save()` is called once per flush attempt.
- The resulting `ArrayBuffer` is treated as opaque bytes.
- No extra KML normalization, encoding rewrite, or byte transformation happens here.

### 5. `NativeFileBackend`

**Responsibility**

Performs atomic writes to a browser-managed writable file handle when the session is opened through the File System Access path.

**Inputs**

- The committed `ArrayBuffer` returned by the container.
- The target file handle.

**Outputs**

- An atomic replacement of the bound file.

**Dependencies**

- Browser File System Access API.

**Invariants**

- The backend never mutates the bytes it receives.
- A partially written file must not replace the previous committed file.
- The handle stays private to this component.

### 6. `FallbackBackend`

**Responsibility**

Supports environments where the File System Access API is unavailable or where the caller opened a detached `File`. The fallback is a working-copy plus explicit export/download path.

**Inputs**

- The committed `ArrayBuffer` returned by the container.
- The suggested filename.

**Outputs**

- A downloadable file payload, or a working-copy update in OPFS when available.

**Dependencies**

- `navigator.storage.getDirectory()` when OPFS exists.
- Browser download APIs for explicit export.

**Invariants**

- The fallback never claims in-place replacement of the original disk file.
- It always preserves the exact bytes produced by the container.

### 7. `StatusMachine`

**Responsibility**

Owns the finite state transitions for `SaveStatus` and notifies listeners only when the status actually changes.

**Inputs**

- `idle`, `saving`, `saved`, `error` requests from the save pipeline.

**Outputs**

- Current status value.
- Change notifications.

**Dependencies**

- None beyond a small listener set.

**Invariants**

- The status is always one of the declared contract values.
- Redundant transitions are ignored.
- A failed save keeps the session dirty until a retry or flush succeeds.

### 8. `Errors`

**Responsibility**

Define local error shapes used only inside the component for classification and recovery.

**Examples**

- permission denied
- no writable handle
- native API unavailable
- OPFS unavailable
- write aborted
- export cancelled

These are implementation details and do not extend the public contract.

## Runtime Data Flow

### Opening a file

1. The caller invokes `open()` with either no argument or a `File`.
2. If no `File` is provided, the service uses the native file picker to obtain a writable file binding when available.
3. If a `File` is provided, the service reads it directly and opens in detached mode.
4. The selected source bytes are passed into `IKmzContainer.open()`.
5. The container becomes the active session payload.
6. The service records whether this session is native-bound or fallback-only.
7. Status changes to `saved` once the initial open completes successfully.

### Editing

1. Upstream components mutate the document through `kml-model`, `commands`, or editor actions.
2. When the app knows the container has changed, it calls `notifyChange()`.
3. The service marks the active session dirty and starts or resets the debounce timer.
4. If another change arrives before the timer expires, the timer is restarted.

### Autosave

1. The debounce timer expires.
2. `WriteCoordinator` requests the current bytes from `container.save()`.
3. The backend writes those bytes to the current target.
4. If the write succeeds, the session becomes clean and status becomes `saved`.
5. If another change arrived during the write, the scheduler immediately queues another save.

### Explicit save

1. The caller invokes `save(container)`.
2. The service bypasses the debounce timer and runs the same serialization/write pipeline immediately.
3. A success clears the dirty flag for the current session.
4. A failure leaves the session dirty and status becomes `error`.

### Flush

1. The caller invokes `flush(container)`.
2. The service waits for any in-flight write to finish.
3. If the session is dirty, it performs exactly one additional write.
4. If the session is already clean, `flush()` becomes a no-op.

### Selection and rendering

The persistence component does not participate in selection or rendering flows. It must never subscribe to renderer state or inspect selection details. It only reacts to change notifications coming from the composed application layer.

### Undo and redo

Undo and redo are command-layer concerns. Persistence only sees the effect: an undo or redo that changes the active document should cause a `notifyChange()` and therefore an autosave cycle.

### Resource disposal

1. `dispose()` clears timers and removes listeners.
2. Any temporary object URLs used for download fallback are revoked.
3. The current session reference is dropped.
4. The status machine returns to `idle` or the component becomes inert, depending on whether the surrounding app keeps it alive.

### Error handling

1. A write failure transitions status to `error`.
2. The current session remains active and dirty.
3. The caller can retry with `save()` or `flush()`.
4. If the native backend fails because permission was revoked, the service falls back to explicit export if the caller requests it and a fallback path is available.

## Public Surface

No new cross-component contract is introduced. The only public behaviour is the existing `IPersistenceService` contract.

### Public factory

- `createPersistenceService(): IPersistenceService`

The factory is the component-local entry point used by the composition layer. It returns the single concrete service implementation.

### Contract methods and how they work internally

- `open(file?: File): Promise<IKmzContainer>`
	- If possible, bind the session to a native writable file target.
	- Otherwise open in detached mode and rely on fallback export.
	- Always return the active `IKmzContainer` so the caller can continue to work with the same document object.

- `save(container: IKmzContainer): Promise<void>`
	- Serialize once through `container.save()`.
	- Write the returned bytes through the active backend.
	- Update status and dirty state based on the write result.

- `flush(container: IKmzContainer): Promise<void>`
	- Force the same pipeline immediately, regardless of debounce delay.
	- Preserve the rule that only one write runs per session at a time.

- `notifyChange(): void`
	- Mark the current session dirty.
	- Start or reset the debounce timer.

- `status`
	- Mirrors the `StatusMachine` state.

- `onStatusChange(listener)`
	- Subscribes to the status machine and returns an unsubscribe function.

- `hasNativeFileAccess`
	- Reflects capability detection only; it does not guarantee the current session is writable if permission was later revoked.

- `downloadAs(container, filename)`
	- Produces an explicit download path using the current container bytes.
	- Used for fallback mode and manual export.

- `dispose()`
	- Cancels timers and tears down the current session.

## Algorithms

### 1. Debounced autosave

**Purpose**

Reduce write churn when a user is actively editing while still guaranteeing that the latest committed state is eventually persisted.

**Steps**

1. `notifyChange()` increments the session dirty version.
2. A timer is started or restarted for the configured debounce window.
3. When the timer fires, the current dirty version is captured.
4. `container.save()` is called once.
5. The backend writes the returned bytes.
6. If a newer dirty version appeared during the write, another timer is armed immediately after the write finishes.

**Complexity**

- Time: $O(1)$ per notification plus one full container serialization per flush.
- Memory: one serialized buffer at a time.

**Failure cases**

- Permission revoked before write.
- Backend unavailable.
- Container serialization fails because the upstream document is invalid.

**Precision issues**

- None here directly; numeric fidelity belongs to upstream `kml-model` and `geo-bridge`.

### 2. Atomic write sequencing

**Purpose**

Avoid file corruption if the browser, tab, or device interrupts a write.

**Native path**

1. Obtain a writable stream from the file handle.
2. Write the exact `ArrayBuffer` bytes.
3. Close the stream to commit.

This path is atomic because the browser handle replaces the file as a single commit operation.

**Fallback path**

1. Write to an OPFS working copy when available.
2. If OPFS is not available, create a downloadable blob and let the user export it.
3. Never overwrite the original file path directly without a writable handle.

**Complexity**

- Time: linear in output size.
- Memory: the full archive is materialized once by the container, then written once.

**Failure cases**

- The browser denies the writable stream.
- The working copy cannot be created.
- The export is cancelled by the user.

### 3. Session invalidation

**Purpose**

Prevent stale timer call-backs and in-flight writes from affecting a newly opened file.

**Steps**

1. Each open operation increments a session token.
2. Every scheduled save captures the current token.
3. Before committing, the writer compares the captured token with the active token.
4. If they differ, the write result is ignored.

**Complexity**

- Time: $O(1)$ per check.
- Memory: one token and one in-flight record.

### 4. Download export

**Purpose**

Provide a deterministic manual export path when auto-persistence is impossible.

**Steps**

1. Serialize the container to bytes.
2. Wrap the bytes in a `Blob`.
3. Create an object URL or equivalent browser download target.
4. Trigger a download with the requested filename.
5. Revoke the URL after the browser has consumed it.

**Failure cases**

- Browser blocks programmatic downloads.
- The user cancels the save dialog.

### 5. Status transitions

**Purpose**

Keep save feedback deterministic and easy to test.

**Rules**

- `idle` after teardown or before any file is opened.
- `saving` during serialization or write commitment.
- `saved` after a successful open or save with no pending dirty changes.
- `error` after any failed persistence attempt.

No other transitions are allowed.

## State Management

The component owns a small amount of mutable state. Every field has a clear lifetime and invalidation rule.

### Mutable state list

- Current `IKmzContainer` reference.
- Current session token.
- Current persistence mode: native or fallback.
- Current writable handle, if available.
- Debounce timer id.
- Dirty flag / dirty version.
- In-flight write promise, if any.
- Last error, if any.
- Registered status listeners.

### Ownership and lifetime

- The service owns the container reference only for the active session.
- The browser handle lives only as long as the current session is open.
- The timer exists only while the session is dirty or a write is pending.
- Listener sets are service-scoped and cleared on `dispose()`.

### Synchronization rules

- Writes are serialized; no two writes may overlap for the same session.
- A `save()` call while a write is active should either wait for completion or queue one follow-up write, never start another concurrent write.
- `notifyChange()` must not mutate the container, only dirty state.

### Caching and invalidation

- The component should not cache serialized file bytes across save calls because the upstream document may have changed.
- The only cached artifacts permitted are the current backend handle, the current session token, and a short-lived in-flight save result.
- Reopening a file invalidates every cached write artifact from the previous session.

## Error Strategy

The persistence layer must fail loudly enough for recovery, but it must never corrupt or lose the current in-memory document state.

### Expected failures and recovery

**Invalid or corrupt source file**

- Triggered during `open()` if the source cannot be parsed by `IKmzContainer`.
- Recovery: status becomes `error`; the caller receives the failure; no session is bound.

**Permission denied**

- Triggered when the native writable handle is unavailable or the user revokes permission.
- Recovery: status becomes `error`; the current session remains dirty; the caller can fall back to export.

**Native API unavailable**

- Triggered on browsers or devices without File System Access support.
- Recovery: open in detached mode and use the fallback backend.

**Missing writable handle**

- Triggered when the caller opened via detached `File` input or the session was created without a native picker.
- Recovery: persist to OPFS working copy if available; otherwise expose explicit download.

**Write aborted or interrupted**

- Triggered if the browser closes, the tab is suspended, or the stream fails mid-write.
- Recovery: status becomes `error`; the active session remains available in memory; the next `save()` retries.

**Quota exceeded / storage unavailable**

- Triggered on OPFS fallback or temporary working-copy writes.
- Recovery: skip the working-copy path and use manual download export; if that also fails, keep the session dirty and expose the error.

**User cancels export**

- Triggered during `downloadAs()`.
- Recovery: do not clear dirty state; remain on the current session.

### Error reporting policy

- Do not throw generic errors from internal modules without classification.
- Classify errors early so status transitions and fallback decisions are deterministic.
- Preserve the active container whenever possible; the file on disk is the persistence target, not the source of truth.

## Performance Strategy

The component should stay simple because the contract already forces full-document serialization at save time.

### Memory

- `container.save()` returns a complete `ArrayBuffer`; the persistence layer should not create additional long-lived copies.
- The writable backend should consume the buffer and release it immediately.
- Object URLs used by `downloadAs()` must be revoked after use.

### CPU

- Debouncing is the main optimization. It avoids serializing after every small edit.
- No background diffing or byte comparison is needed in this layer.

### Large files

- Large KMZ files may produce large serialized buffers, but the component should still write them in a single pass.
- Additional compression or chunking is not needed here because the container already owns archive generation.

### Incremental updates

- This component should not attempt partial file patching.
- Incremental mutation belongs upstream in the document model; persistence only commits the final bytes.

### Object reuse

- Reuse the scheduler, status machine, and listeners across a session.
- Do not retain old buffers after a save completes.

## Testing Strategy

The tests for this component should focus on orchestration, timing, and safe file commitment. The byte-faithful document behaviour itself remains the responsibility of `kml-model` and `kmz-io`.

### Unit tests

- Status machine transitions.
- Debounce timer reset behaviour.
- Session invalidation on reopen.
- Dirty flag handling for repeated `notifyChange()` calls.
- Listener add/remove behaviour.

### Integration tests

- `open()` with a fake `IKmzContainer` and a native backend mock.
- `save()` writes exactly the bytes returned by `container.save()`.
- `flush()` waits for pending writes and then commits the latest state.
- `downloadAs()` emits the same bytes as `container.save()`.

### Fallback tests

- Native API unavailable path enters fallback mode.
- Detached `File` input does not claim native in-place replacement.
- OPFS working-copy write succeeds when available.
- Explicit download is invoked when no writable backend exists.

### Failure tests

- Permission denied during save.
- Quota exceeded during fallback write.
- Export cancelled by the user.
- Write interruption leaves the session dirty and status `error`.

### Regression tests

- Rapid edit bursts collapse into one save.
- Save followed by a new change queues exactly one follow-up save.
- Reopening a file cancels stale timers and stale in-flight results.

### Golden tests

- The byte buffer passed into the backend must match the bytes returned by the fake container exactly.
- No persistence-layer formatting or normalization is allowed.

### Edge cases

- Empty files.
- Zero-byte containers.
- Very large serialized buffers.
- Repeated `open()` calls without `dispose()`.

### Not applicable

- Replay tests are not required for this component because it does not depend on movement, GPS pose, or render state.

## Demo

The standalone demo for this component should prove that the save pipeline works without the rest of the editor.

### Demo surface

- A file picker for `.kml` and `.kmz` files.
- A status indicator bound to `SaveStatus`.
- A button to trigger an immediate `flush()`.
- A button to trigger `downloadAs()`.
- A tiny scripted dirty toggle that calls `notifyChange()` so autosave can be observed without a full editor UI.

### What the demo proves

- The component can open a real file.
- The component can detect whether native persistence is available.
- Autosave transitions through `saving` and back to `saved`.
- The fallback export path produces a valid downloadable file.
- A reopened file uses the same bytes the container produced, not a rewritten variant.

### What the demo does not prove

- It does not validate KML mutation logic.
- It does not validate byte-faithful XML round-tripping; that is already covered by `kml-model` and `kmz-io`.

## Dependencies

### Built-in platform APIs

- File System Access API
	- Needed for native in-place persistence on Chromium desktop.
	- Chosen because it is the only browser-native path that can write back to the user's file without a backend.
	- Assumption: permission can be requested during the open flow and may be revoked later.

- OPFS via `navigator.storage.getDirectory()`
	- Needed for fallback working-copy storage when native file access is unavailable.
	- Chosen because it keeps the application offline-first.
	- Assumption: the browser may support OPFS even when it does not support file handles.

- Blob and object URL APIs
	- Needed for explicit export/download fallback.
	- Chosen because they are standard browser primitives and avoid external dependencies.

### External libraries

- None required for the persistence layer itself.

Why no extra library is preferred:

- The contract already exposes `IKmzContainer`; persistence should not add another serialization or archival dependency.
- Native browser APIs are sufficient for the required write path.
- Introducing a third-party filesystem or download abstraction would add coupling without improving correctness.

## Risks

### 1. Native write permission and browser support variance

**Why it is risky**

File System Access support is browser-specific, and permission may be lost between open and save.

**Early detection**

- Capability probe at start-up.
- Integration tests for permission-denied handling.

**Mitigation**

- Keep the fallback backend fully functional.
- Never assume native write access just because the file opened successfully.

**Fallback plan**

- Use OPFS or explicit download export.

### 2. Concurrent writes and stale saves

**Why it is risky**

Autosave can overlap with manual save or with a reopen action.

**Early detection**

- Tests that fire rapid `notifyChange()` and `open()` calls.

**Mitigation**

- Session tokens.
- Single in-flight write rule.
- Follow-up save queue.

**Fallback plan**

- Reject stale writes and preserve the latest dirty session.

### 3. Fallback export is not a true in-place update

**Why it is risky**

On unsupported platforms, the browser cannot transparently overwrite the original file path.

**Early detection**

- Capability detection tests.
- Demo checks on non-native browsers.

**Mitigation**

- Make detached mode explicit.
- Surface the fallback state in the status UI.

**Fallback plan**

- Require explicit download/export and keep the edited data in memory.

### 4. Large serialized archives

**Why it is risky**

`container.save()` returns a full buffer, which can be large for real KMZ files.

**Early detection**

- Performance tests with large fixtures.

**Mitigation**

- Debounce aggressively.
- Avoid extra buffer copies.

**Fallback plan**

- Continue to support the save path, even if the UI warns about large files.

### 5. Silent data drift through the persistence layer

**Why it is risky**

If persistence were to re-encode or normalize bytes, it could break Google Earth compatibility.

**Early detection**

- Byte-exact write tests using fixture bytes returned by the container.

**Mitigation**

- Treat container output as opaque bytes.
- Never manipulate XML or KMZ contents in this component.

**Fallback plan**

- None; if this happens, the component is incorrect and the serializer upstream must be fixed.

## Milestones

### Milestone 1: Status machine and session skeleton

- Implement `StatusMachine`.
- Implement `ContainerSession`.
- Implement `notifyChange()` and listener plumbing.
- Add unit tests for status transitions and invalidation.

This milestone is independently testable with no browser file writes.

### Milestone 2: Native open and immediate save

- Implement `open()` in native-bound mode.
- Capture a writable handle from the file picker path.
- Implement `save()` as a single serialization plus write.
- Add tests with a mocked native handle.

This milestone proves the main in-place persistence path.

### Milestone 3: Debounced autosave

- Add `SaveScheduler`.
- Coalesce repeated `notifyChange()` calls.
- Queue one follow-up save if edits occur during a write.
- Add timer-based unit tests.

This milestone proves automatic persistence behaviour.

### Milestone 4: Fallback mode

- Implement OPFS working-copy support where available.
- Implement `downloadAs()` using Blob export.
- Make detached `File` input explicit.
- Add fallback and permission-denied tests.

This milestone ensures the component still works on unsupported browsers.

### Milestone 5: Error handling and teardown

- Normalize error classification.
- Preserve dirty state across failed writes.
- Implement `dispose()` clean-up.
- Add regression tests for cancellation, restart, and stale saves.

This milestone makes the component safe to use in the full app lifecycle.

### Milestone 6: Demo and integration hardening

- Build the standalone persistence demo.
- Validate the demo with a real `.kmz` fixture.
- Confirm the save path opens correctly in Google Earth.

This milestone finalizes the component as a reusable and verifiable piece of the architecture.
