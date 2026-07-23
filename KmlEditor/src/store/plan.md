# Store Component Implementation Plan

## Overview

The store component is the shared application state and orchestration layer for KmlEditor. It owns the loaded document, container, selection state, command stack, and geo bridge instance. It keeps the UI decoupled from the domain components and is shared by both the desktop editor and the AR scene.

The key architectural decision is that the store is the single source of truth for document-scoped state. Both `editor/` and `ar-scene/` consume the same store instance, which means they see the same selection, command history, and document state. This enables consistent behavior across desktop and mobile AR contexts.

### What it owns

- The active `IKmzContainer` instance and its lifecycle.
- The active `IKmlDocument` instance derived from the container.
- The active `IGeoBridge` instance bound to the document.
- The command stack bound to the document and bridge.
- Selection state (currently selected feature id).
- Loading state (idle, loading, loaded, error).
- Change notifications for document, selection, and command stack changes.

### What it never owns

- File I/O, KMZ parsing, or XML serialization (owned by `kmz-io`).
- Lossless KML mutation logic (owned by `kml-model`).
- Command execution logic (owned by `commands`).
- Rendering, scene graph state, or view layout (owned by `renderers`, `editor`, `ar-scene`).
- Persistence scheduling and file writes (owned by `persistence`).
- Any new cross-component contract beyond what already exists in `contracts/`.

### Contracts it consumes

- `IKmzContainer` from `src/contracts/kmz-container.ts`.
- `IKmlDocument` from `src/contracts/document-model.ts`.
- `IGeoBridge` from `src/contracts/geo-bridge.ts`.
- `ICommandStack` from `src/contracts/commands.ts`.
- `IPersistenceService` from `src/contracts/persistence.ts`.
- `IFeatureView` and typed feature views from `src/contracts/document-model.ts`.
- `FeatureTemplate`, `FeatureSnapshot`, `GeoPosition`, `WorldPosition`, `LatLonBox`, `ModelOrientation`, `ModelScale`, and `AltitudeMode` from `src/contracts/type.ts`.

### Contracts it implements

- The store does not implement a new contract. It exposes a concrete class with a public surface that `editor/` and `ar-scene/` use directly.
- The public surface is designed to be stable and minimal, avoiding framework-specific patterns (no Redux, no MobX, no React hooks).

### Explicit boundary

- The store never directly manipulates the DOM, Three.js scene graph, or WebXR session.
- The store never interprets gestures, pointer events, or keyboard shortcuts.
- The store never decides what should be selected next based on user interaction.
- The store only receives already-decided actions: load file, select feature, execute command, undo, redo.

## Internal Architecture

Keep the implementation small. The store should be a single class with clear state fields and a few public methods. Avoid splitting into many tiny files unless the codebase actually needs that separation.

### `Store` (single concrete class)

Responsibility
- Own all document-scoped state and expose a minimal public API.
- Orchestrate loading, command execution, selection, and persistence notifications.
- Emit change events for UI components to react to.

Inputs
- `loadContainer(container: IKmzContainer): Promise<void>`
- `selectFeature(featureId: string | null): void`
- `executeCommand(command: ICommand): void`
- `undo(): void`
- `redo(): void`
- `dispose(): void`

Outputs
- Live state via getters: `document`, `container`, `geoBridge`, `commandStack`, `selectedFeatureId`, `loadingState`.
- Change notifications via `onChange` listener pattern.

Dependencies
- `IKmzContainer`, `IKmlDocument`, `IGeoBridge`, `ICommandStack`, `IPersistenceService`.
- Concrete implementations from `kmz-io`, `kml-model`, `geo-bridge`, `commands`, `persistence`.

Invariants
- At most one active document at a time.
- Command stack is discarded and recreated on document load.
- Selection is cleared on document load.
- All state mutations happen through public methods only.
- Change notifications are emitted synchronously after state commits.

### `LoadingState` (enum)

- `idle`: No document loaded.
- `loading`: Container is being parsed into document model.
- `loaded`: Document is ready and command stack is bound.
- `error`: Load failed with an error.

### Why this decomposition minimizes coupling
- One class owns all document-scoped state, making lifecycle clear.
- No framework-specific patterns, so both editor and AR scene can consume it.
- Change notifications are generic callbacks, not framework signals.
- The store does not implement new contracts, avoiding cross-component API surface growth.

## Runtime Data Flow

### Loading a file

1. Caller (editor or AR scene) obtains an `IKmzContainer` from `kmz-io`.
2. Caller calls `store.loadContainer(container)`.
3. Store sets `loadingState = loading`.
4. Store calls `container.getDocument()` to obtain `IKmlDocument`.
5. Store creates a new `IGeoBridge` instance bound to the document.
6. Store creates a new `ICommandStack` bound to the document and bridge.
7. Store clears selection and sets `loadingState = loaded`.
8. Store emits change notification.
9. If persistence service is present, store calls `persistence.open(file)` if a file handle is available.

### Selecting a feature

1. Caller calls `store.selectFeature(featureId)` with a feature id or `null` to deselect.
2. Store updates `selectedFeatureId` field.
3. Store emits change notification.
4. The store does not validate that the feature exists; validation happens at render time or when a command is executed.

### Executing a command

1. Caller constructs an `ICommand` with final target values.
2. Caller calls `store.executeCommand(command)`.
3. Store delegates to `commandStack.execute(command)`.
4. On success, store calls `persistence.notifyChange()` if persistence service is present.
5. Store emits change notification.
6. On failure, store propagates the error without changing state.

### Undo

1. Caller calls `store.undo()`.
2. Store delegates to `commandStack.undo()`.
3. On success, store calls `persistence.notifyChange()` if persistence service is present.
4. Store emits change notification.
5. On failure (nothing to undo), store does nothing.

### Redo

1. Caller calls `store.redo()`.
2. Store delegates to `commandStack.redo()`.
3. On success, store calls `persistence.notifyChange()` if persistence service is present.
4. Store emits change notification.
5. On failure (nothing to redo), store does nothing.

### Disposal

1. Caller calls `store.dispose()`.
2. Store clears all state (container, document, bridge, command stack, selection).
3. Store sets `loadingState = idle`.
4. Store calls `persistence.dispose()` if persistence service is present.
5. Store removes all change listeners.
6. Store emits final change notification.

### Persistence integration

- The store does not own the persistence service instance; it receives it via constructor or setter.
- The store calls `persistence.notifyChange()` after every successful command execute, undo, and redo.
- The store calls `persistence.flush()` before destructive operations (load new file, dispose).
- The store never inspects persistence internals; it only uses the public contract.

## Public Surface

The store exposes a concrete class with a stable public API. No framework-specific patterns.

### Constructor

```typescript
constructor(persistenceService?: IPersistenceService)
```

- Optional persistence service for autosave integration.
- If omitted, the store works without persistence (useful for demos and tests).

### State getters

```typescript
get container(): IKmzContainer | null
get document(): IKmlDocument | null
get geoBridge(): IGeoBridge | null
get commandStack(): ICommandStack | null
get selectedFeatureId(): string | null
get loadingState(): LoadingState
```

- All getters return current state or `null` if not applicable.
- These are read-only; state changes only through public methods.

### Actions

```typescript
async loadContainer(container: IKmzContainer): Promise<void>
selectFeature(featureId: string | null): void
executeCommand(command: ICommand): void
undo(): void
redo(): void
dispose(): void
```

- `loadContainer` is async because document parsing may be async.
- All other actions are synchronous.
- Actions emit change notifications after state commits.

### Change notifications

```typescript
onChange(listener: () => void): () => void
```

- Register a callback to be called after any state change.
- Returns a disposer function that removes the listener.
- Notifications are synchronous and happen after the state is committed.
- The store does not provide granular change types; listeners re-read state as needed.

### Persistence integration

```typescript
setPersistenceService(service: IPersistenceService | null): void
```

- Allow setting or replacing the persistence service after construction.
- Useful for lazy initialization or testing scenarios.

## Algorithms

### Load lifecycle

1. Validate that container is not null.
2. Set loadingState to loading.
3. Dispose previous state (old document, bridge, command stack, selection).
4. Await container.getDocument().
5. Create new geo bridge instance.
6. Create new command stack bound to document and bridge.
7. Set loadingState to loaded.
8. Emit change notification.
9. If persistence service is present, call persistence.open() if file handle available.

Complexity: O(document_parse_time) dominated by document model.

### Command execution wrapper

1. Validate that command stack exists.
2. Call commandStack.execute(command).
3. If success and persistence service exists, call persistence.notifyChange().
4. Emit change notification.
5. Propagate any error without state mutation.

Complexity: O(command_execution_time) dominated by command layer.

### Selection change

1. Update selectedFeatureId field.
2. Emit change notification.

Complexity: O(1).

### Disposal

1. Clear all state fields.
2. Set loadingState to idle.
3. If persistence service exists, call persistence.dispose().
4. Remove all listeners.
5. Emit final change notification.

Complexity: O(1) plus persistence disposal time.

## State Management

### Mutable state ownership

- All mutable state is owned by the Store instance.
- No global singleton state.
- State is private and exposed only through getters.

### Lifetime

- Created at construction.
- Active until dispose() is called.
- After dispose(), the store should not be reused (create a new instance).

### Synchronization rules

- All state mutations happen through public methods only.
- Change notifications are emitted synchronously after state commits.
- No async state mutations except during loadContainer.

### Caching

- No explicit caching beyond holding references to document, bridge, and command stack.
- The store does not cache feature views or computed geometry.

### Invalidation

- loadContainer invalidates all previous state.
- dispose() invalidates all state and clears listeners.
- The store does not support partial reload or hot-swap of components.

### Error handling

- Load failures set loadingState to error and store the error internally.
- Command execution failures are propagated without state mutation.
- The store does not retry failed operations automatically.

## Error Strategy

### Expected failures and exact behavior

1. Container parse failure during load
   - When: container.getDocument() throws.
   - Behavior: set loadingState to error, store error, clear partial state.
   - Recovery: caller must attempt load with a new container.

2. Command execution failure
   - When: commandStack.execute() throws.
   - Behavior: propagate error, do not change state, do not call persistence.notifyChange().
   - Recovery: caller handles error and may retry with corrected command.

3. Undo/redo at boundary
   - When: commandStack.undo() or redo() returns null.
   - Behavior: do nothing, no state change, no notification.
   - Recovery: none (this is expected at boundaries).

4. Operation before load
   - When: executeCommand, undo, redo called before document is loaded.
   - Behavior: throw or fail fast with explicit error.
   - Recovery: caller must load a document first.

5. Persistence service failure
   - When: persistence.notifyChange() or flush() throws.
   - Behavior: log error internally, do not fail the primary operation.
   - Recovery: persistence layer handles retries; store continues.

### Diagnostics policy

- Store load errors are exposed via loadingState and optional error getter.
- Command errors are propagated to caller for handling.
- Persistence errors are logged but do not block store operations.

## Performance Strategy

### CPU

- Load is dominated by document parsing (owned by kml-model).
- Command execution is dominated by command layer (owned by commands).
- Selection change is O(1).
- Change notification dispatch is O(listener_count).

### Memory

- Store holds references to document, bridge, and command stack (owned by those components).
- No additional large data structures in the store.
- Listener list is small (typically one or two consumers).

### Large documents

- Store does not add memory overhead beyond holding references.
- Large document memory is owned by kml-model and kmz-io.

### Not optimized by design

- No memoization of computed state.
- No granular change notifications (listeners re-read state).
- No state diffing or batching.

## Testing Strategy

### Unit tests

- Load lifecycle: loading -> loaded transition, error handling, state clearing.
- Selection: set and clear selection, change notifications.
- Command execution: successful execute, persistence.notifyChange called, change notification.
- Undo/redo: delegation to command stack, persistence integration.
- Disposal: state clearing, listener removal, persistence disposal.
- Change notifications: listener registration, removal, synchronous emission.

### Integration tests

- Load real fixture container, verify document and bridge are created.
- Execute command sequence, verify command stack state and persistence calls.
- Undo/redo cycle, verify state consistency.
- Load new file while old file is dirty, verify old state is discarded.

### Regression tests

- Rapid execute/undo/redo bursts produce correct persistence.notifyChange calls.
- Selection persists across command execution.
- Load failure leaves store in clean error state.

### Demo acceptance tests

- Load fixture, select feature, execute command, undo, redo.
- Verify UI (editor or AR scene) reflects correct state through store.

## Demo

### Standalone demo scope

- Minimal demo in `demos/store-demo`.
- Controls:
  - Load fixture container.
  - Select feature by id.
  - Execute simple command (e.g., move marker).
  - Undo/redo.
  - Dispose.
- Visuals:
  - Current loading state.
  - Selected feature id.
  - Command stack cursor position.
  - Change notification counter.

### What must be proven

- Store correctly orchestrates document, bridge, and command stack lifecycle.
- Change notifications are emitted on every state change.
- Persistence integration works (notifyChange after commands).
- Selection state is independent of command execution.

## Dependencies

### External libraries

- None required for the store logic itself.

### Internal components

- `kmz-io` for IKmzContainer.
- `kml-model` for IKmlDocument.
- `geo-bridge` for IGeoBridge.
- `commands` for ICommandStack.
- `persistence` for IPersistenceService (optional).
- `contracts` for all shared interfaces.

### Why alternatives are rejected

- Redux/MobX: adds framework dependency and complexity not needed for single-document scope.
- React Context: ties store to React, but AR scene may use different framework.
- Event emitter libraries: callback pattern is sufficient and has no dependencies.

## Risks

1. Persistence integration bugs
   - Risk: notifyChange not called or called at wrong time.
   - Severity: High (data loss).
   - Detection: integration tests with mock persistence service.
   - Mitigation: explicit notifyChange calls after every successful command/undo/redo.

2. State mutation bypassing public API
   - Risk: internal state modified directly instead of through methods.
   - Severity: Medium (inconsistent notifications).
   - Detection: code review and tests that verify notifications.
   - Mitigation: keep state private and expose only through methods.

3. Listener re-entrancy
   - Risk: listener calls back into store during notification.
   - Severity: Medium (infinite loops or inconsistent state).
   - Detection: tests with recursive listener patterns.
   - Mitigation: document that listeners should not call back into store.

4. Load failure leaves inconsistent state
   - Risk: partial state after failed load.
   - Severity: Medium.
   - Detection: load failure tests.
   - Mitigation: clear all state before load, set error state on failure.

5. Disposal not called before page unload
   - Risk: persistence not flushed, data loss.
   - Severity: High.
   - Detection: manual testing.
   - Mitigation: editor/AR scene must call dispose() or flush() before unload.

## Milestones

### Milestone 1: Core store skeleton
- Implement Store class with state fields and getters.
- Implement LoadingState enum.
- Implement basic loadContainer with placeholder document parsing.
- Implement selectFeature.
- Implement change notification system.
- Unit tests for state getters and notifications.

### Milestone 2: Document and bridge integration
- Integrate real IKmzContainer.getDocument() call.
- Integrate real IGeoBridge creation.
- Integrate real ICommandStack creation.
- Implement proper disposal of old state on load.
- Integration tests with real kmz-io and kml-model.

### Milestone 3: Command execution wrapper
- Implement executeCommand with commandStack delegation.
- Implement undo and redo delegation.
- Add persistence.notifyChange() integration.
- Tests for command execution, undo, redo, and persistence calls.

### Milestone 4: Persistence integration
- Implement setPersistenceService.
- Integrate persistence.open() on load.
- Integrate persistence.flush() before destructive operations.
- Integrate persistence.dispose() on store disposal.
- Integration tests with mock and real persistence service.

### Milestone 5: Error handling and edge cases
- Implement load error handling with loadingState error.
- Implement command execution error propagation.
- Implement operation-before-load guards.
- Tests for all error paths and edge cases.

### Milestone 6: Standalone demo + validation
- Build store demo page.
- Validate with real fixture and command sequence.
- Verify editor/AR scene can consume the same store instance.
- Freeze public surface and document lifecycle assumptions.
