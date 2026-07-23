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

### File structure

```
src/store/
  index.ts           - Public API: createStore, Store class, LoadingState enum, error classes
  store.ts           - Store class implementation
  errors.ts          - Custom error classes
```

### `Store` class (single concrete class in store.ts)

Private state fields (exact types):
```typescript
private _container: IKmzContainer | null = null;
private _document: IKmlDocument | null = null;
private _geoBridge: IGeoBridge | null = null;
private _commandStack: ICommandStack | null = null;
private _selectedFeatureId: string | null = null;
private _loadingState: LoadingState = LoadingState.Idle;
private _loadError: Error | null = null;
private _persistenceService: IPersistenceService | null = null;
private _listeners: Set<() => void> = new Set();
```

Constructor signature:
```typescript
constructor(persistenceService?: IPersistenceService)
```
- If persistenceService is provided, store it in `_persistenceService`.
- If omitted, `_persistenceService` remains null (store works without persistence).

Public getter methods:
```typescript
get container(): IKmzContainer | null { return this._container; }
get document(): IKmlDocument | null { return this._document; }
get geoBridge(): IGeoBridge | null { return this._geoBridge; }
get commandStack(): ICommandStack | null { return this._commandStack; }
get selectedFeatureId(): string | null { return this._selectedFeatureId; }
get loadingState(): LoadingState { return this._loadingState; }
get loadError(): Error | null { return this._loadError; }
```

Public action methods:
```typescript
async loadContainer(container: IKmzContainer): Promise<void>
selectFeature(featureId: string | null): void
executeCommand(command: ICommand): void
undo(): void
redo(): void
dispose(): void
setPersistenceService(service: IPersistenceService | null): void
```

Change notification method:
```typescript
onChange(listener: () => void): () => void
```

Private helper methods:
```typescript
private _emitChange(): void
private _clearState(): void
private _validateDocumentLoaded(): void
```

### `LoadingState` enum (in index.ts)

```typescript
export enum LoadingState {
  Idle = 'idle',
  Loading = 'loading',
  Loaded = 'loaded',
  Error = 'error'
}
```

### Error classes (in errors.ts)

```typescript
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

export class DocumentNotLoadedError extends StoreError {
  constructor() {
    super('Cannot perform operation: no document is loaded. Call loadContainer() first.');
    this.name = 'DocumentNotLoadedError';
  }
}

export class LoadFailedError extends StoreError {
  constructor(cause: Error) {
    super(`Failed to load document: ${cause.message}`);
    this.name = 'LoadFailedError';
    this.cause = cause;
  }
}
```

### Factory function (in index.ts)

```typescript
export function createStore(persistenceService?: IPersistenceService): Store {
  return new Store(persistenceService);
}

export { Store } from './store';
export { LoadingState } from './store';
export { StoreError, DocumentNotLoadedError, LoadFailedError } from './errors';
```

### Dependencies and imports

The store.ts file must import:
```typescript
import { IKmzContainer } from '../contracts/kmz-container';
import { IKmlDocument } from '../contracts/document-model';
import { IGeoBridge, GeoAnchor } from '../contracts/geo-bridge';
import { ICommandStack, ICommand } from '../contracts/commands';
import { IPersistenceService } from '../contracts/persistence';
import { KmlDocumentImpl } from '../document-model/public';  // or appropriate factory
import { createGeoBridge } from '../geo-bridge';
import { createCommandStack } from '../commands';
import { StoreError, DocumentNotLoadedError, LoadFailedError } from './errors';
import { LoadingState } from './store';
```

### Why this decomposition minimizes coupling
- One class owns all document-scoped state, making lifecycle clear.
- No framework-specific patterns, so both editor and AR scene can consume it.
- Change notifications are generic callbacks, not framework signals.
- The store does not implement new contracts, avoiding cross-component API surface growth.
- Error classes are separate for testability and clear error type checking.

## Runtime Data Flow

### Loading a file (loadContainer implementation)

Exact implementation steps:

1. Validate input: if `container` is null or undefined, throw `StoreError` with message "Container cannot be null or undefined".
2. Set `_loadingState = LoadingState.Loading`.
3. Set `_loadError = null`.
4. Call `_clearState()` to dispose previous state.
5. Emit change via `_emitChange()`.
6. Try:
   a. Call `container.getDocKml()` to get the KML string.
   b. Create new `KmlDocumentImpl` instance (or use appropriate factory from document-model).
   c. Call `document.parse(kmlString)` on the new document instance.
   d. Store document in `_document`.
   e. Store container in `_container`.
   f. Create new geo bridge: call `createGeoBridge()` from geo-bridge module.
   g. Set geo bridge anchor: call `geoBridge.setAnchor({ position: { lon: 0, lat: 0, alt: 0 }, heading: 0 })`. (Note: anchor is intentionally set to origin; actual anchor will be set by editor/AR scene based on GPS).
   h. Store geo bridge in `_geoBridge`.
   i. Create new command stack: call `createCommandStack(_document, _geoBridge)` from commands module.
   j. Store command stack in `_commandStack`.
   k. Clear selection: set `_selectedFeatureId = null`.
   l. Set `_loadingState = LoadingState.Loaded`.
   m. Emit change via `_emitChange()`.
7. Catch (error):
   a. Set `_loadingState = LoadingState.Error`.
   b. Wrap error in `LoadFailedError(cause)` and store in `_loadError`.
   c. Call `_clearState()` to clean up partial state.
   d. Emit change via `_emitChange()`.
   e. Re-throw the `LoadFailedError`.

Note: The store does NOT call `persistence.open()` because persistence.open() returns a new container, but the store already has a container from kmz-io. The persistence service is used only for notifyChange() and flush() calls.

### Selecting a feature (selectFeature implementation)

Exact implementation steps:

1. Set `_selectedFeatureId = featureId` (accepts string or null).
2. Call `_emitChange()`.

No validation is performed. The store does not check if the feature exists in the document. Validation happens at render time or when a command is executed (command layer validates feature existence).

### Executing a command (executeCommand implementation)

Exact implementation steps:

1. Call `_validateDocumentLoaded()`. If validation fails, it throws `DocumentNotLoadedError`.
2. Validate that `_commandStack` is not null (should be true if document is loaded).
3. Try:
   a. Call `_commandStack.execute(command)`.
   b. If `_persistenceService` is not null, call `_persistenceService.notifyChange()`.
   c. Call `_emitChange()`.
4. Catch (error):
   a. Do NOT call persistence.notifyChange().
   b. Do NOT call _emitChange().
   c. Re-throw the error without modifying any state.

### Undo (undo implementation)

Exact implementation steps:

1. Call `_validateDocumentLoaded()`. If validation fails, it throws `DocumentNotLoadedError`.
2. Validate that `_commandStack` is not null.
3. Call `result = _commandStack.undo()`.
4. If `result` is null (nothing to undo):
   a. Return immediately without emitting change or calling persistence.
5. If `result` is not null (undo succeeded):
   a. If `_persistenceService` is not null, call `_persistenceService.notifyChange()`.
   b. Call `_emitChange()`.

### Redo (redo implementation)

Exact implementation steps:

1. Call `_validateDocumentLoaded()`. If validation fails, it throws `DocumentNotLoadedError`.
2. Validate that `_commandStack` is not null.
3. Call `result = _commandStack.redo()`.
4. If `result` is null (nothing to redo):
   a. Return immediately without emitting change or calling persistence.
5. If `result` is not null (redo succeeded):
   a. If `_persistenceService` is not null, call `_persistenceService.notifyChange()`.
   b. Call `_emitChange()`.

### Disposal (dispose implementation)

Exact implementation steps:

1. If `_persistenceService` is not null:
   a. Try: call `await _persistenceService.flush(_container)` if `_container` is not null.
   b. Catch: log error to console but do not throw.
   c. Call `_persistenceService.dispose()`.
   d. Set `_persistenceService = null`.
2. Call `_clearState()`.
3. Set `_loadingState = LoadingState.Idle`.
4. Set `_loadError = null`.
5. Clear all listeners: `_listeners.clear()`.
6. Call `_emitChange()`.

Note: dispose() is synchronous except for the optional persistence.flush() call. The flush is awaited before continuing.

### Setting persistence service (setPersistenceService implementation)

Exact implementation steps:

1. If `_persistenceService` is not null:
   a. Call `_persistenceService.dispose()`.
2. Set `_persistenceService = service`.
3. Do NOT emit change (persistence service change is not a document state change).

### Change notification (_emitChange private method)

Exact implementation:

```typescript
private _emitChange(): void {
  // Create a copy of listeners to avoid issues if listeners modify the set during iteration
  const listeners = Array.from(this._listeners);
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error('Store change listener threw error:', error);
      // Continue notifying other listeners even if one fails
    }
  }
}
```

### State clearing (_clearState private method)

Exact implementation:

```typescript
private _clearState(): void {
  if (this._container) {
    this._container.dispose();
    this._container = null;
  }
  this._document = null;
  this._geoBridge = null;
  if (this._commandStack) {
    // Command stack does not have a dispose method, just drop reference
    this._commandStack = null;
  }
  this._selectedFeatureId = null;
}
```

### Document loaded validation (_validateDocumentLoaded private method)

Exact implementation:

```typescript
private _validateDocumentLoaded(): void {
  if (this._loadingState !== LoadingState.Loaded || this._document === null) {
    throw new DocumentNotLoadedError();
  }
}
```

### Persistence integration details

- The store does NOT call `persistence.open()` because the container comes from kmz-io, not from persistence.
- The store calls `persistence.notifyChange()` after every successful command execute, undo, and redo.
- The store calls `persistence.flush(container)` before loadContainer (if a container is already loaded) and before dispose.
- The store calls `persistence.dispose()` when the store itself is disposed or when the persistence service is replaced.
- Persistence errors are caught and logged but do not block store operations.
- The store never inspects persistence internals (status, hasNativeFileAccess, etc.).

## Public Surface

The store exposes a concrete class with a stable public API defined in index.ts.

### Factory function

```typescript
export function createStore(persistenceService?: IPersistenceService): Store
```

- Creates and returns a new Store instance.
- Persistence service is optional; if omitted, store works without persistence.

### Store class constructor

```typescript
constructor(persistenceService?: IPersistenceService)
```

- Stores the optional persistence service in `_persistenceService`.
- Initializes all state fields to null/Idle/empty set.

### State getters

```typescript
get container(): IKmzContainer | null
get document(): IKmlDocument | null
get geoBridge(): IGeoBridge | null
get commandStack(): ICommandStack | null
get selectedFeatureId(): string | null
get loadingState(): LoadingState
get loadError(): Error | null
```

- All getters return current state or `null` if not applicable.
- These are read-only; state changes only through public methods.
- `loadError` is non-null only when `loadingState` is `Error`.

### Actions

```typescript
async loadContainer(container: IKmzContainer): Promise<void>
selectFeature(featureId: string | null): void
executeCommand(command: ICommand): void
undo(): void
redo(): void
async dispose(): Promise<void>
setPersistenceService(service: IPersistenceService | null): void
```

- `loadContainer` is async because document parsing may fail.
- `dispose` is async because it awaits persistence.flush().
- All other actions are synchronous.
- Actions emit change notifications after state commits.
- `dispose` cannot be called twice safely; after dispose, the store should not be reused.

### Change notifications

```typescript
onChange(listener: () => void): () => void
```

- Register a callback to be called after any state change.
- Returns a disposer function that removes the listener.
- Notifications are synchronous and happen after the state is committed.
- The store does not provide granular change types; listeners re-read state as needed.
- If a listener throws, the error is caught and logged, but other listeners are still called.

### Error types

```typescript
class StoreError extends Error
class DocumentNotLoadedError extends StoreError
class LoadFailedError extends StoreError
```

- `DocumentNotLoadedError`: thrown when executeCommand, undo, or redo is called before document is loaded.
- `LoadFailedError`: thrown when loadContainer fails; wraps the original cause error.
- `StoreError`: base class for all store-specific errors.

## Algorithms

### Load lifecycle (loadContainer)

Pseudocode:
```
loadContainer(container):
  if container is null or undefined:
    throw StoreError("Container cannot be null or undefined")
  
  _loadingState = LoadingState.Loading
  _loadError = null
  _clearState()
  _emitChange()
  
  try:
    kmlString = container.getDocKml()
    document = new KmlDocumentImpl()
    document.parse(kmlString)
    _document = document
    _container = container
    
    geoBridge = createGeoBridge()
    geoBridge.setAnchor({ position: { lon: 0, lat: 0, alt: 0 }, heading: 0 })
    _geoBridge = geoBridge
    
    commandStack = createCommandStack(_document, _geoBridge)
    _commandStack = commandStack
    
    _selectedFeatureId = null
    _loadingState = LoadingState.Loaded
    _emitChange()
  catch error:
    _loadingState = LoadingState.Error
    _loadError = new LoadFailedError(error)
    _clearState()
    _emitChange()
    throw _loadError
```

Complexity: O(document_parse_time) dominated by document model.

### Command execution wrapper (executeCommand)

Pseudocode:
```
executeCommand(command):
  _validateDocumentLoaded()  // throws DocumentNotLoadedError if not loaded
  
  try:
    _commandStack.execute(command)
    if _persistenceService is not null:
      _persistenceService.notifyChange()
    _emitChange()
  catch error:
    // Do not call persistence.notifyChange()
    // Do not call _emitChange()
    throw error
```

Complexity: O(command_execution_time) dominated by command layer.

### Undo (undo)

Pseudocode:
```
undo():
  _validateDocumentLoaded()  // throws DocumentNotLoadedError if not loaded
  
  result = _commandStack.undo()
  if result is null:
    return  // Nothing to undo, no change notification
  
  if _persistenceService is not null:
    _persistenceService.notifyChange()
  _emitChange()
```

Complexity: O(command_undo_time) dominated by command layer.

### Redo (redo)

Pseudocode:
```
redo():
  _validateDocumentLoaded()  // throws DocumentNotLoadedError if not loaded
  
  result = _commandStack.redo()
  if result is null:
    return  // Nothing to redo, no change notification
  
  if _persistenceService is not null:
    _persistenceService.notifyChange()
  _emitChange()
```

Complexity: O(command_redo_time) dominated by command layer.

### Selection change (selectFeature)

Pseudocode:
```
selectFeature(featureId):
  _selectedFeatureId = featureId
  _emitChange()
```

Complexity: O(1).

### Disposal (dispose)

Pseudocode:
```
async dispose():
  if _persistenceService is not null:
    try:
      if _container is not null:
        await _persistenceService.flush(_container)
    catch error:
      console.error('Persistence flush failed during dispose:', error)
    _persistenceService.dispose()
    _persistenceService = null
  
  _clearState()
  _loadingState = LoadingState.Idle
  _loadError = null
  _listeners.clear()
  _emitChange()
```

Complexity: O(1) plus persistence flush time.

### State clearing (_clearState)

Pseudocode:
```
_clearState():
  if _container is not null:
    _container.dispose()
    _container = null
  _document = null
  _geoBridge = null
  _commandStack = null
  _selectedFeatureId = null
```

Complexity: O(1).

### Document loaded validation (_validateDocumentLoaded)

Pseudocode:
```
_validateDocumentLoaded():
  if _loadingState !== LoadingState.Loaded or _document is null:
    throw new DocumentNotLoadedError()
```

Complexity: O(1).

## State Management

### Mutable state ownership

- All mutable state is owned by the Store instance as private fields.
- No global singleton state.
- State is private and exposed only through getters.
- Listeners are stored in a private `Set<() => void>`.

### Lifetime

- Created at construction via `createStore()` factory.
- Active until `dispose()` is called.
- After `dispose()`, the store should not be reused; create a new instance.
- The store does not support "revival" after disposal.

### Synchronization rules

- All state mutations happen through public methods only.
- Change notifications are emitted synchronously after state commits.
- No async state mutations except during `loadContainer` and `dispose`.
- Listeners are called synchronously during `_emitChange()`.

### Caching

- No explicit caching beyond holding references to document, bridge, and command stack.
- The store does not cache feature views or computed geometry.
- The store does not memoize any computed values.

### Invalidation

- `loadContainer` invalidates all previous state via `_clearState()`.
- `dispose()` invalidates all state and clears listeners.
- The store does not support partial reload or hot-swap of components.
- Setting a new persistence service via `setPersistenceService` does not invalidate document state.

### Error handling

- Load failures set `loadingState` to `Error` and store the error in `_loadError`.
- Command execution failures are propagated without state mutation.
- The store does not retry failed operations automatically.
- Persistence errors are caught and logged but do not block store operations.
- Listener errors are caught and logged but do not stop other listeners from being called.

## Error Strategy

### Expected failures and exact behavior

1. Container is null or undefined in loadContainer
   - When: caller passes null or undefined to `loadContainer`.
   - Behavior: throw `StoreError` with message "Container cannot be null or undefined".
   - Recovery: caller must provide a valid container.

2. Container getDocKml() failure during load
   - When: `container.getDocKml()` throws.
   - Behavior: catch error, set `loadingState = LoadingState.Error`, wrap in `LoadFailedError`, store in `_loadError`, call `_clearState()`, emit change, re-throw `LoadFailedError`.
   - Recovery: caller must attempt load with a new container.

3. Document parse failure during load
   - When: `document.parse(kmlString)` throws.
   - Behavior: catch error, set `loadingState = LoadingState.Error`, wrap in `LoadFailedError`, store in `_loadError`, call `_clearState()`, emit change, re-throw `LoadFailedError`.
   - Recovery: caller must attempt load with a valid KML file.

4. Command execution failure
   - When: `commandStack.execute(command)` throws.
   - Behavior: propagate error without catching, do not change state, do not call `persistence.notifyChange()`, do not emit change.
   - Recovery: caller handles error and may retry with corrected command.

5. Undo/redo at boundary
   - When: `commandStack.undo()` or `redo()` returns null.
   - Behavior: return immediately without state change, without persistence call, without change notification.
   - Recovery: none (this is expected at boundaries).

6. Operation before load (executeCommand, undo, redo)
   - When: called when `loadingState !== Loaded` or `_document === null`.
   - Behavior: `_validateDocumentLoaded()` throws `DocumentNotLoadedError`.
   - Recovery: caller must load a document first.

7. Persistence notifyChange() failure
   - When: `persistence.notifyChange()` throws after successful command.
   - Behavior: catch error, log to console with `console.error()`, do not re-throw, do not change store state.
   - Recovery: persistence layer handles retries; store continues normally.

8. Persistence flush() failure during dispose
   - When: `persistence.flush(_container)` throws during dispose.
   - Behavior: catch error, log to console with `console.error()`, continue with disposal (clear state, dispose persistence service).
   - Recovery: none (disposal continues despite flush failure).

9. Listener throws during notification
   - When: a registered listener function throws during `_emitChange()`.
   - Behavior: catch error, log to console with `console.error('Store change listener threw error:', error)`, continue calling remaining listeners.
   - Recovery: none (other listeners are still called).

### Diagnostics policy

- Store load errors are exposed via `loadingState === LoadingState.Error` and `loadError` getter.
- Command errors are propagated to caller for handling.
- Persistence errors are logged to console but do not block store operations.
- Listener errors are logged to console but do not stop notification dispatch.

## Performance Strategy

### CPU

- Load is dominated by document parsing (owned by kml-model).
- Command execution is dominated by command layer (owned by commands).
- Selection change is O(1) (single field assignment).
- Change notification dispatch is O(listener_count) (iterates over listener set).
- State clearing is O(1) (null assignments and single dispose call).

### Memory

- Store holds references to document, bridge, and command stack (owned by those components).
- No additional large data structures in the store.
- Listener set stores function references (typically 1-3 listeners).
- No caching of feature views or computed geometry.

### Large documents

- Store does not add memory overhead beyond holding references.
- Large document memory is owned by kml-model and kmz-io.
- Store performance does not degrade with document size.

### Not optimized by design

- No memoization of computed state (listeners re-read state on every change).
- No granular change notifications (listeners must check what changed).
- No state diffing (all listeners are notified on any change).
- No batching of change notifications (each operation emits immediately).
- No debouncing of change notifications (UI must handle rapid updates).

### Why these are not optimized
- Memoization adds complexity without clear benefit for single-document scope.
- Granular notifications require tracking what changed, adding complexity.
- State diffing is unnecessary for the expected scale (editor and AR scene are the only consumers).
- Batching would require async notification, complicating the synchronous model.
- Debouncing should be handled by UI layer if needed, not by store.

## Testing Strategy

### Unit tests (for store.ts)

Test file: `store.test.ts`

Test cases:

1. Constructor initializes state correctly
   - Assert all state fields are null/Idle/empty set after construction.
   - Assert persistence service is stored if provided.

2. loadContainer with valid container succeeds
   - Mock IKmzContainer.getDocKml() to return valid KML string.
   - Mock KmlDocumentImpl to parse successfully.
   - Call loadContainer.
   - Assert loadingState transitions: Idle -> Loading -> Loaded.
   - Assert _document, _container, _geoBridge, _commandStack are set.
   - Assert _selectedFeatureId is null.
   - Assert _loadError is null.
   - Assert change notification was emitted.

3. loadContainer with null container throws
   - Call loadContainer(null).
   - Assert StoreError is thrown with correct message.
   - Assert state remains in Idle.

4. loadContainer with parse failure sets error state
   - Mock IKmzContainer.getDocKml() to return invalid KML.
   - Mock KmlDocumentImpl.parse() to throw.
   - Call loadContainer.
   - Assert loadingState transitions to Error.
   - Assert _loadError is LoadFailedError wrapping the cause.
   - Assert _document, _container, _geoBridge, _commandStack are null.
   - Assert change notification was emitted.

5. loadContainer clears previous state
   - Load first container successfully.
   - Load second container successfully.
   - Assert first container.dispose() was called.
   - Assert state reflects second container only.

6. selectFeature updates selection and emits change
   - Load container successfully.
   - Call selectFeature('feature-123').
   - Assert _selectedFeatureId === 'feature-123'.
   - Assert change notification was emitted.
   - Call selectFeature(null).
   - Assert _selectedFeatureId === null.
   - Assert change notification was emitted.

7. executeCommand with loaded document succeeds
   - Load container successfully.
   - Mock commandStack.execute() to succeed.
   - Mock persistence service.
   - Call executeCommand(mockCommand).
   - Assert commandStack.execute() was called with mockCommand.
   - Assert persistence.notifyChange() was called.
   - Assert change notification was emitted.

8. executeCommand without loaded document throws
   - Do not load container.
   - Call executeCommand(mockCommand).
   - Assert DocumentNotLoadedError is thrown.
   - Assert commandStack.execute() was not called.

9. executeCommand with command failure propagates error
   - Load container successfully.
   - Mock commandStack.execute() to throw.
   - Mock persistence service.
   - Call executeCommand(mockCommand).
   - Assert error is propagated.
   - Assert persistence.notifyChange() was NOT called.
   - Assert change notification was NOT emitted.

10. undo with loaded document succeeds
    - Load container successfully.
    - Mock commandStack.undo() to return mockCommand.
    - Mock persistence service.
    - Call undo().
    - Assert commandStack.undo() was called.
    - Assert persistence.notifyChange() was called.
    - Assert change notification was emitted.

11. undo at boundary does nothing
    - Load container successfully.
    - Mock commandStack.undo() to return null.
    - Call undo().
    - Assert persistence.notifyChange() was NOT called.
    - Assert change notification was NOT emitted.

12. undo without loaded document throws
    - Do not load container.
    - Call undo().
    - Assert DocumentNotLoadedError is thrown.

13. redo with loaded document succeeds
    - Load container successfully.
    - Mock commandStack.redo() to return mockCommand.
    - Mock persistence service.
    - Call redo().
    - Assert commandStack.redo() was called.
    - Assert persistence.notifyChange() was called.
    - Assert change notification was emitted.

14. redo at boundary does nothing
    - Load container successfully.
    - Mock commandStack.redo() to return null.
    - Call redo().
    - Assert persistence.notifyChange() was NOT called.
    - Assert change notification was NOT emitted.

15. dispose clears state and calls persistence
    - Load container successfully.
    - Mock persistence service.
    - Call dispose().
    - Assert persistence.flush() was called with container.
    - Assert persistence.dispose() was called.
    - Assert all state fields are null/Idle.
    - Assert listeners are cleared.
    - Assert change notification was emitted.

16. dispose without persistence works
    - Load container successfully (no persistence service).
    - Call dispose().
    - Assert all state fields are null/Idle.
    - Assert no error is thrown.

17. setPersistenceService replaces service
    - Create store with persistence service A.
    - Call setPersistenceService(service B).
    - Assert service A.dispose() was called.
    - Assert _persistenceService === service B.

18. onChange registers and removes listener
    - Register listener A.
    - Register listener B.
    - Trigger state change (selectFeature).
    - Assert both listeners were called.
    - Call disposer for listener A.
    - Trigger state change.
    - Assert only listener B was called.

19. listener error does not stop other listeners
    - Register listener A that throws.
    - Register listener B that does not throw.
    - Trigger state change.
    - Assert listener B was still called despite A throwing.
    - Assert error was logged to console.

20. persistence notifyChange failure is logged but does not block
    - Load container successfully.
    - Mock persistence service.notifyChange() to throw.
    - Call executeCommand(mockCommand).
    - Assert error was logged to console.
    - Assert operation completed (no error thrown).
    - Assert change notification was emitted.

### Integration tests

Test file: `store.integration.test.ts`

Test cases:

1. Load real fixture container
   - Use real IKmzContainer from kmz-io with fixture KML.
   - Call loadContainer.
   - Assert document is parsed correctly.
   - Assert geo bridge is created.
   - Assert command stack is created.
   - Assert features are accessible via document.getFeatures().

2. Execute command sequence with real components
   - Load real fixture.
   - Execute real command (e.g., move marker).
   - Assert document is mutated correctly.
   - Assert command stack state reflects the command.
   - Assert persistence.notifyChange() was called if persistence is present.

3. Undo/redo cycle with real components
   - Load real fixture.
   - Execute command.
   - Undo.
   - Redo.
   - Assert document state is correct after each step.

4. Load new file while old file is loaded
   - Load first fixture.
   - Execute command to make it dirty.
   - Load second fixture.
   - Assert first state is completely discarded.
   - Assert second state is active.

### Regression tests

Test file: `store.regression.test.ts`

Test cases:

1. Rapid execute/undo/redo bursts
   - Load fixture.
   - Execute 10 commands rapidly.
   - Undo all 10 rapidly.
   - Redo all 10 rapidly.
   - Assert persistence.notifyChange() was called exactly 30 times.
   - Assert final document state is correct.

2. Selection persists across command execution
   - Load fixture.
   - Select feature.
   - Execute command on different feature.
   - Assert selection is still the originally selected feature.

3. Load failure leaves clean error state
   - Load invalid fixture.
   - Assert loadingState is Error.
   - Assert all state fields are null.
   - Load valid fixture.
   - Assert loadingState transitions to Loaded successfully.

### Demo acceptance tests

Manual test checklist:

1. Load fixture, select feature, execute command, undo, redo
   - Open store demo page.
   - Load a fixture KML.
   - Select a feature by id.
   - Execute a simple command (move marker).
   - Undo.
   - Redo.
   - Verify UI reflects correct state at each step.

## Demo

### Standalone demo scope

Location: `demos/store-demo/index.html`

Dependencies:
- Store from `src/store/index.ts`
- Mock implementations of IKmzContainer, IKmlDocument, IGeoBridge, ICommandStack
- No real persistence service (demo works without persistence)

HTML structure:
```html
<!DOCTYPE html>
<html>
<head>
  <title>Store Demo</title>
</head>
<body>
  <h1>Store Component Demo</h1>
  
  <div id="controls">
    <button id="loadBtn">Load Fixture</button>
    <button id="selectBtn">Select Feature</button>
    <button id="executeBtn">Execute Command</button>
    <button id="undoBtn">Undo</button>
    <button id="redoBtn">Redo</button>
    <button id="disposeBtn">Dispose</button>
  </div>
  
  <div id="status">
    <p>Loading State: <span id="loadingState">idle</span></p>
    <p>Selected Feature ID: <span id="selectedFeatureId">null</span></p>
    <p>Command Stack Can Undo: <span id="canUndo">false</span></p>
    <p>Command Stack Can Redo: <span id="canRedo">false</span></p>
    <p>Change Notification Count: <span id="changeCount">0</span></p>
  </div>
  
  <script type="module" src="demo.js"></script>
</body>
</html>
```

JavaScript implementation (demo.js):
```typescript
import { createStore, LoadingState } from '../../src/store/index.js';
import { createMockContainer, createMockCommand } from './mocks.js';

let store = createStore();
let changeCount = 0;

// Register change listener
store.onChange(() => {
  changeCount++;
  updateUI();
});

// UI update function
function updateUI() {
  document.getElementById('loadingState').textContent = store.loadingState;
  document.getElementById('selectedFeatureId').textContent = store.selectedFeatureId || 'null';
  document.getElementById('canUndo').textContent = store.commandStack?.canUndo() || false;
  document.getElementById('canRedo').textContent = store.commandStack?.canRedo() || false;
  document.getElementById('changeCount').textContent = changeCount;
}

// Load button
document.getElementById('loadBtn').addEventListener('click', async () => {
  const container = createMockContainer();
  await store.loadContainer(container);
});

// Select button
document.getElementById('selectBtn').addEventListener('click', () => {
  store.selectFeature('feature-123');
});

// Execute command button
document.getElementById('executeBtn').addEventListener('click', () => {
  const command = createMockCommand();
  store.executeCommand(command);
});

// Undo button
document.getElementById('undoBtn').addEventListener('click', () => {
  store.undo();
});

// Redo button
document.getElementById('redoBtn').addEventListener('click', () => {
  store.redo();
});

// Dispose button
document.getElementById('disposeBtn').addEventListener('click', async () => {
  await store.dispose();
});
```

Mock implementations (mocks.js):
```typescript
export function createMockContainer(): IKmzContainer {
  return {
    async open(source: File | ArrayBuffer): Promise<void> {},
    getDocKml(): string {
      return '<kml><Document><Placemark id="feature-123"><Point><coordinates>0,0,0</coordinates></Point></Placemark></Document></kml>';
    },
    setDocKml(content: string): void {},
    listAssets(): AssetEntry[] { return []; },
    async save(): Promise<ArrayBuffer> { return new ArrayBuffer(0); },
    getAssetProvider(): IAssetProvider {
      return {
        async getAssetUrl(href: string): Promise<string> { return ''; },
        async getAssetBytes(href: string): Promise<Uint8Array> { return new Uint8Array(); },
        hasAsset(href: string): boolean { return false; },
        dispose(): void {}
      };
    },
    dispose(): void {}
  };
}

export function createMockCommand(): ICommand {
  return {
    type: 'move-marker',
    featureId: 'feature-123',
    description: 'Move marker',
    execute(document: IKmlDocument, geoBridge: IGeoBridge): void {},
    undo(document: IKmlDocument, geoBridge: IGeoBridge): void {}
  };
}
```

### What must be proven

- Store correctly orchestrates document, bridge, and command stack lifecycle.
- Change notifications are emitted on every state change.
- Selection state is independent of command execution.
- Loading state transitions correctly (Idle -> Loading -> Loaded or Error).
- Undo/redo delegation works correctly.
- Disposal clears all state.

## Dependencies

### External libraries

- None required for the store logic itself.

### Internal components (exact import paths)

```typescript
import { IKmzContainer, IAssetProvider, AssetEntry } from '../contracts/kmz-container';
import { IKmlDocument, IFeatureView, FeatureType, FeatureId, FeatureSnapshot, FeatureTemplate } from '../contracts/document-model';
import { IGeoBridge, GeoAnchor } from '../contracts/geo-bridge';
import { ICommandStack, ICommand, CommandType } from '../contracts/commands';
import { IPersistenceService, SaveStatus } from '../contracts/persistence';
import { GeoPosition, WorldPosition, LatLonBox, ModelOrientation, ModelScale, AltitudeMode } from '../contracts/type';

// Concrete implementations/factories
import { KmlDocumentImpl } from '../document-model/public';  // or appropriate factory
import { createGeoBridge } from '../geo-bridge';
import { createCommandStack } from '../commands';
```

Note: The exact import path for KmlDocumentImpl may vary based on the document-model implementation. Use the factory function if one exists, otherwise use the concrete class directly.

### Why alternatives are rejected

- Redux/MobX: adds framework dependency and complexity not needed for single-document scope.
- React Context: ties store to React, but AR scene may use different framework.
- Event emitter libraries: callback pattern is sufficient and has no dependencies.
- RxJS/Observable: adds complexity and dependency for simple notification pattern.

## Risks

1. Persistence integration bugs
   - Risk: notifyChange not called or called at wrong time.
   - Severity: High (data loss).
   - Detection: integration tests with mock persistence service that tracks call count.
   - Mitigation: explicit notifyChange calls after every successful command/undo/redo in executeCommand, undo, redo methods.

2. State mutation bypassing public API
   - Risk: internal state modified directly instead of through methods.
   - Severity: Medium (inconsistent notifications).
   - Detection: code review and tests that verify notifications are emitted.
   - Mitigation: keep all state fields private, expose only through getters, mutate only through public methods.

3. Listener re-entrancy
   - Risk: listener calls back into store during notification.
   - Severity: Medium (infinite loops or inconsistent state).
   - Detection: unit test with listener that calls selectFeature during notification.
   - Mitigation: document in JSDoc that listeners should not call back into store; _emitChange() copies array to avoid modification-during-iteration issues.

4. Load failure leaves inconsistent state
   - Risk: partial state after failed load.
   - Severity: Medium.
   - Detection: unit test that verifies all state fields are null after load failure.
   - Mitigation: _clearState() is called in try-catch before setting error state; _clearState() sets all fields to null.

5. Disposal not called before page unload
   - Risk: persistence not flushed, data loss.
   - Severity: High.
   - Detection: manual testing with browser dev tools.
   - Mitigation: editor/AR scene must call dispose() or flush() before unload; this is documented in the plan but not enforced by store.

6. Geo bridge anchor not set by store
   - Risk: geo bridge used without anchor, causing incorrect coordinate conversions.
   - Severity: Medium (incorrect edits).
   - Detection: integration tests verify coordinate conversions work.
   - Mitigation: store sets default anchor (0,0,0) during load; editor/AR scene must set correct anchor based on GPS before rendering.

7. Command stack not bound to correct document/bridge
   - Risk: command stack operates on stale document after reload.
   - Severity: High (data corruption).
   - Detection: integration tests with load, command, load, command sequence.
   - Mitigation: command stack is recreated on every loadContainer call; old stack is dropped.

8. Persistence service not flushed before load
   - Risk: unsaved changes lost when loading new file.
   - Severity: High (data loss).
   - Detection: integration test that verifies flush is called before load.
   - Mitigation: dispose() calls flush before clearing state; loadContainer should call flush on old container if present (this is intentionally NOT implemented in store to keep scope minimal; caller must handle this).

## Milestones

### Milestone 1: Core store skeleton

Files to create:
- `src/store/index.ts` (exports)
- `src/store/store.ts` (Store class skeleton)
- `src/store/errors.ts` (error classes)
- `src/store/store.test.ts` (unit tests)

Implementation tasks:
1. Create LoadingState enum in store.ts.
2. Create Store class with private state fields (_container, _document, _geoBridge, _commandStack, _selectedFeatureId, _loadingState, _loadError, _persistenceService, _listeners).
3. Implement constructor that accepts optional persistence service.
4. Implement getter methods for all state fields.
5. Implement _clearState() private method.
6. Implement _emitChange() private method.
7. Implement onChange() method.
8. Implement selectFeature() method.
9. Implement dispose() method (without persistence integration for now).
10. Create error classes in errors.ts (StoreError, DocumentNotLoadedError, LoadFailedError).
11. Export everything from index.ts (createStore factory, Store, LoadingState, error classes).

Unit tests:
- Constructor initializes state correctly.
- selectFeature updates selection and emits change.
- onChange registers and removes listener.
- dispose clears state and listeners.

### Milestone 2: Document and bridge integration

Implementation tasks:
1. Implement _validateDocumentLoaded() private method.
2. Implement loadContainer() method with mock document parsing (use placeholder KML string).
3. Integrate KmlDocumentImpl import (use actual import path from document-model).
4. Integrate createGeoBridge() import from geo-bridge.
5. Integrate createCommandStack() import from commands.
6. In loadContainer: create document, parse KML, create geo bridge, set default anchor, create command stack.
7. In loadContainer: handle errors with try-catch, set error state, clear partial state.
8. In _clearState(): call container.dispose() if container exists.

Unit tests:
- loadContainer with valid container succeeds (using mock container).
- loadContainer with null container throws.
- loadContainer with parse failure sets error state.
- loadContainer clears previous state.

### Milestone 3: Command execution wrapper

Implementation tasks:
1. Implement executeCommand() method with _validateDocumentLoaded() check.
2. Implement undo() method with _validateDocumentLoaded() check.
3. Implement redo() method with _validateDocumentLoaded() check.
4. In executeCommand: delegate to commandStack.execute(), call persistence.notifyChange() if present, emit change.
5. In executeCommand: catch errors and propagate without calling persistence or emitting change.
6. In undo: delegate to commandStack.undo(), handle null result (no-op), call persistence.notifyChange() if success, emit change.
7. In redo: delegate to commandStack.redo(), handle null result (no-op), call persistence.notifyChange() if success, emit change.

Unit tests:
- executeCommand with loaded document succeeds.
- executeCommand without loaded document throws.
- executeCommand with command failure propagates error.
- undo with loaded document succeeds.
- undo at boundary does nothing.
- undo without loaded document throws.
- redo with loaded document succeeds.
- redo at boundary does nothing.
- redo without loaded document throws.

### Milestone 4: Persistence integration

Implementation tasks:
1. Implement setPersistenceService() method (dispose old service if present, set new service).
2. In executeCommand: call _persistenceService.notifyChange() after successful command execution.
3. In undo: call _persistenceService.notifyChange() after successful undo.
4. In redo: call _persistenceService.notifyChange() after successful redo.
5. In dispose: call await _persistenceService.flush(_container) if both are present, catch and log errors.
6. In dispose: call _persistenceService.dispose() if present.
7. In setPersistenceService: call oldService.dispose() if present.

Unit tests:
- executeCommand calls persistence.notifyChange().
- undo calls persistence.notifyChange().
- redo calls persistence.notifyChange().
- dispose calls persistence.flush() and dispose().
- setPersistenceService replaces service and disposes old one.
- persistence notifyChange failure is logged but does not block.
- persistence flush failure during dispose is logged but does not block.

### Milestone 5: Error handling and edge cases

Implementation tasks:
1. In loadContainer: throw StoreError if container is null/undefined.
2. In loadContainer: wrap parse errors in LoadFailedError with cause.
3. In _validateDocumentLoaded(): throw DocumentNotLoadedError if not loaded.
4. In _emitChange(): catch listener errors, log to console, continue with other listeners.
5. Add loadError getter to expose load errors.

Unit tests:
- loadContainer with null container throws StoreError.
- loadContainer parse failure wraps error in LoadFailedError.
- executeCommand/undo/redo without loaded document throws DocumentNotLoadedError.
- listener error does not stop other listeners.

### Milestone 6: Standalone demo + validation

Files to create:
- `demos/store-demo/index.html`
- `demos/store-demo/demo.js`
- `demos/store-demo/mocks.js`

Implementation tasks:
1. Create HTML structure with buttons and status display.
2. Create mock implementations for IKmzContainer and ICommand.
3. Implement demo.js that creates store, registers listener, wires up buttons.
4. Test demo manually in browser.
5. Verify all operations work: load, select, execute, undo, redo, dispose.
6. Verify change notifications are counted correctly.
7. Freeze public surface (no more method signature changes).
8. Document lifecycle assumptions in code comments.
