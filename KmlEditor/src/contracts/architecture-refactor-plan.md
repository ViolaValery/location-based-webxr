# Architecture Refactor Plan — One Document Session, Serializable Store

## Decision and verified requirement

The customer requirements establish four separate responsibilities:

1. **KMZ container layer:** opens one KML/KMZ source, owns the archive entries and asset provider, and writes that same archive again.
2. **Lossless KML document model:** owns the mutable, format-preserving representation of that container's `doc.kml`; it exposes typed feature views and applies surgical mutations.
3. **Geo↔world bridge:** is pure conversion at the geographic/world boundary. The desktop reference origin and AR/device origin affect rendering and editing conversion only; they never rewrite persisted positions on their own.
4. **Redux store:** is the runtime projection for DOM UI, desktop scene, AR scene, selection, edit state, undo/redo availability, and device state. It must not hold raw XML, an `IKmlDocument`, an `IKmzContainer`, or Three.js objects.

Therefore the current architecture is incorrect in two material ways:

- `IEditorStore` currently owns `document` and `container`, although both are non-serializable engine/session objects rather than UI state.
- `EditorStoreImpl.loadFile()` and `IPersistenceService.open()` each create a container. A later `notifyChange()` can only save persistence's active container, which need not be the edited store container. The required round-trip cannot be proved in that state.

**Decision:** replace the store-owned document/container model with one explicit application-layer `DocumentSession`. A session owns exactly one `IKmzContainer`, exactly one `IKmlDocument`, one command stack, and one `IGeoBridge` for its lifetime. The store holds an immutable, serializable projection of that session. The persistence service binds to the same container at open time and writes that same object after session mutations.

This is an intentional correction of the existing contracts. Do not attempt to synchronize two containers, put raw XML in Redux, or add editor-only workarounds.

## Target architecture

```text
                    File / File System Access handle
                                  │
                         IPersistenceService.open
                                  │ returns and binds
                                  ▼
                         one IKmzContainer
                                  │ getDocKml / setDocKml / save
                                  ▼
                        DocumentSession (one per file)
                 ┌────────────────┼────────────────┐
                 │                │                │
          IKmlDocument       ICommandStack     IGeoBridge
          raw lossless XML    execute/undo       geo ↔ world
                 │                │                │
                 └────── publishes immutable DocumentProjection ──────┐
                                                                         ▼
                                                             Redux editor store
                                                features, order, selection, edit,
                                                undo/redo capability, device state
                                                            │                 │
                                                     desktop editor         AR scene
                                                            │                 │
                                                            └── commands ────┘

On every successful execute / undo / redo:
  command mutates IKmlDocument → session serializes → same container.setDocKml()
  → projection is dispatched to Redux → persistence.notifyChange()
  → persistence writes same container.save() bytes.
```

The application-layer session/controller is the only place allowed to know both the engine objects and persistence. Renderers receive only feature views, `IAssetProvider` from the session's container, and the bridge. Editor and AR receive store state and send intent to the controller; neither reaches into document-model or persistence internals.

## Target ownership

| Concern | Owner | Explicitly not owned by it |
| --- | --- | --- |
| Archive bytes, entries, KML text slot, asset URLs | `IKmzContainer` / `kmz-io` | typed feature state, commands, file handles |
| Preserved XML tree/CST and typed feature extraction | `IKmlDocument` / `document-model` | ZIP entries, disk writes, UI state |
| One loaded container + document + stack + bridge | `DocumentSession` | Redux state, DOM, Three.js objects, file-handle implementation |
| File handle, permission, debounce, write/export status | `IPersistenceService` | document parsing/mutation, feature projection |
| Serializable feature projection, selection, edit and device state | Redux `IEditorStore` | XML, container, command implementation, Three.js objects |
| View objects/GPU resources/picking | renderer + editor/ar-scene | feature mutation and file save |
| Open/save/command user flows | `WorkspaceController` composition root | XML parsing or ZIP logic itself |

## Contract changes

Change contracts deliberately in one migration PR. Do not retain deprecated ownership fields as aliases; that would permit accidental reuse.

### Keep unchanged

- `IKmzContainer`, `IAssetProvider`, `IKmlDocument`, feature types, `ICommand`, `ICommandStack`, and `IGeoBridge` remain the engine contracts.
- `ICommand.execute(document, geoBridge)` and `undo(document, geoBridge)` remain valid: commands mutate the single session document, never Redux state directly.
- `IPersistenceService` retains `open`, `save`, `flush`, `notifyChange`, status and export operations, but its documentation must state that its returned container becomes the session container.

### Add `contracts/document-session.ts`

This is the explicit boundary between the engine and the application layer:

```ts
export interface DocumentProjection {
  readonly revision: number;
  readonly features: readonly IFeatureView[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface IDocumentSession {
  readonly container: IKmzContainer | null;
  readonly document: IKmlDocument | null;
  readonly geoBridge: IGeoBridge;
  readonly projection: DocumentProjection | null;

  open(container: IKmzContainer): void;
  execute(command: ICommand): void;
  undo(): ICommand | null;
  redo(): ICommand | null;
  setReferenceAnchor(anchor: GeoAnchor): void;
  subscribe(listener: (projection: DocumentProjection | null) => void): () => void;
  dispose(): void;
}
```

`open(container)` parses `container.getDocKml()` into a new document and does not open files itself. The caller must have obtained the container from `IPersistenceService.open()` or a test fixture. `DocumentProjection.features` is a fresh immutable snapshot (clone/freeze at the projection boundary), never a mutable model-owned feature object. `revision` increments only after a successful open, execute, undo, or redo; not on selection or device updates.

`DocumentSession` is allowed to expose its container/document only to `WorkspaceController`, not to editor/ar-scene/store. Enforce this by keeping the concrete class and factory in an application/session module and importing it only from the controller and integration tests.

### Replace `contracts/store.ts`

Remove `document`, `container`, `commands`, `geoBridge`, and `loadFile` from `IEditorStore`/`EditorState`. Replace them with a serializable projection:

```ts
export interface EditorState {
  readonly revision: number;
  readonly featuresById: Readonly<Record<FeatureId, IFeatureView>>;
  readonly featureOrder: readonly FeatureId[];
  readonly selectedFeatureId: FeatureId | null;
  readonly editMode: EditMode;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly documentStatus: 'empty' | 'loading' | 'ready' | 'error';
  readonly device: DeviceState;
}

export interface IEditorStore {
  getState(): EditorState;
  selectFeature(id: FeatureId | null): void;
  setEditMode(mode: EditMode): void;
  setDeviceState(state: DeviceState): void;
  replaceDocumentProjection(projection: DocumentProjection | null): void;
  setDocumentStatus(status: EditorState['documentStatus']): void;
  subscribe(listener: (state: EditorState) => void): () => void;
}
```

`EditMode` is a finite union of current UI modes (`'select'`, `'move'`, `'line-vertex'`, `'overlay-transform'`, `'model-transform'`). `DeviceState` must be a serializable plain-data type; it starts empty for desktop and is populated by AR integration later. Do not put `XRSession`, `THREE.Object3D`, `File`, `Blob`, callbacks, or class instances into it.

The store reducer must be pure. `replaceDocumentProjection` normalizes the projection into `featuresById` and `featureOrder`; it must not retain an object reference supplied by the document model. Selection is cleared if its id is absent in the new projection.

### Add `contracts/workspace-controller.ts`

This is the sole cross-view command/open/save entry point:

```ts
export interface IWorkspaceController {
  open(file?: File): Promise<void>;
  execute(command: ICommand): void;
  undo(): void;
  redo(): void;
  saveNow(): Promise<void>;
  exportAs(filename: string): Promise<void>;
  setReferenceAnchor(anchor: GeoAnchor): void;
  dispose(): void;
}
```

`open` first calls `persistence.open(file)` and passes the returned container to `session.open(container)`. The controller then dispatches session projection to the store. It must never create a `KmzContainer` itself. `editor` and `ar-scene` depend on `IWorkspaceController` plus `IEditorStore`; this is explicit orchestration, not hidden access to concrete implementations.

### Persistence contract clarification

No second `IKmzContainer` may be constructed in persistence once `open()` has produced the session container. The exact invariant is:

```text
container returned by persistence.open()
=== container passed to session.open()
=== container serialized by session after command
=== container written by persistence.save/flush()
```

`notifyChange()` remains a debounce signal. `WorkspaceController` calls it only after `session.execute`, `undo`, or `redo` succeeds and has updated `container.setDocKml(document.serialize())`. `save`, `flush`, and `downloadAs` retain container identity checks; those checks now protect the one intended object rather than expose an architectural conflict.

## Exact runtime flows

### Open

1. Editor/AR calls `controller.open(file)`.
2. Controller dispatches `documentStatus: 'loading'` to the Redux store.
3. `persistence.open(file)` acquires the file handle/fallback binding, opens exactly one container, and returns it.
4. `session.open(container)` reads `getDocKml()`, creates/parses its document model, creates its command stack, derives desktop anchor if applicable, and produces immutable feature projection revision 1.
5. Controller dispatches `replaceDocumentProjection(projection)` and `documentStatus: 'ready'`.
6. Editor/AR subscribe to Redux and render the projection. Renderers receive the session container's `getAssetProvider()` through the controller-owned render binding, not through Redux.
7. If any stage fails, dispose the temporary session/container appropriately, keep prior ready session alive until the new session is fully valid, set `documentStatus: 'error'`, and expose the originating error.

### Command execution

1. View builds an existing `ICommand` from user intent and sends it to `controller.execute(command)`.
2. Controller calls `session.execute(command)`.
3. Session command stack calls `command.execute(document, geoBridge)`; the document model mutates only intended preserved nodes.
4. Session serializes the document and immediately calls `container.setDocKml(serialized)`. If serialization fails, command result is treated as failed; do not update Redux or notify persistence.
5. Session increments revision and publishes a cloned/frozen projection with `canUndo/canRedo`.
6. Controller dispatches that projection to Redux, then calls `persistence.notifyChange()`.
7. Persistence debounces and writes `container.save()` for the exact bound container. Status reaches `saved` only after write close succeeds.

### Undo and redo

Use the same flow as command execution with `session.undo()`/`redo()`. The inverse command mutates the same preserved KML tree, the session serializes back into the same container, Redux receives a new immutable projection, and persistence is notified. There is no Redux-only undo path and no document-only undo path.

### Desktop versus AR anchor

- Desktop controller derives the data-centroid reference origin once after open, calls `session.setReferenceAnchor`, and never persists that choice.
- AR coordinator subscribes to serializable device state and calls `controller.setReferenceAnchor` when its live GPS origin changes. It does not open/save containers and does not access raw KML.
- Both use the same session bridge and command semantics. Only input/device state differs.

### Close / switch file

1. Controller calls `persistence.flush(session.container)` before switching or disposal.
2. If flush fails, the UI offers retry/export/cancel; it does not silently discard data.
3. On a successful switch, controller unsubscribes session, calls session disposal, then container disposal through the owning session lifecycle; persistence invalidates the old file-handle session.
4. Redux projection is reset to `null` only after old scene subscribers can no longer consume it.

## Implementation migration plan

### Phase 0 — Freeze and characterize current behavior

- Do not add new features to editor or AR while ownership is being changed.
- Mark the existing editor `PersistenceCoordinator` and its “shared-container seam” message as temporary/obsolete after migration.
- Add characterization tests for current container identity behavior, load error preservation, command execution, undo/redo, and byte-faithful model behavior. These protect useful behavior during the rewrite.

### Phase 1 — Introduce session contracts and tests

- Add `document-session.ts` and `workspace-controller.ts` contracts as above.
- Write tests before implementation for: one-container identity, open projection, execute/undo/redo revision changes, serialize-before-notify ordering, and no persistence notification after failed serialization.
- Do not change editor UI in this phase.

### Phase 2 — Implement `DocumentSession`

- Add `src/document-session/impl.ts`, `projection.ts`, and `index.ts`.
- Move document parsing, command-stack creation, bridge anchor initialization, and command-stack subscriptions out of `store/impl.ts`.
- Build `projectFeatures(document)` as a pure deep-clone/freeze function; test every feature type and prove mutations to Redux copies cannot mutate model views.
- Serialize into the session container immediately after command completion. Ensure no uncommitted document state exists after successful session notification.

### Phase 3 — Refactor Redux store to a plain projection store

- Replace old `EditorReduxState`, reducers, facade and tests. Delete `loadFileSuccess` carrying class instances and `mutateDocument` as a blind version bump.
- Add pure reducers for projection replacement, selection, edit mode, document status, and device state.
- Remove imports of `kmz-io`, `document-model`, `commands`, and `geo-bridge` implementations from `src/store`.
- Use Redux Toolkit serializability middleware in development; do not disable it. Add a test that dispatching a class instance or function is rejected/warned in development configuration.

### Phase 4 — Align persistence with the shared session

- Retain one container returned from `persistence.open`; remove every code path that opens another container for the same workflow.
- Keep reference identity checks in `save`, `flush`, and `downloadAs`.
- Change tests and documentation so `open → session.open → command → notifyChange → flush` is the standard integration path.
- Test that handles, debounce token, and output bytes all belong to the session container. Test detached/OPFS/native paths separately without changing container identity.

### Phase 5 — Implement `WorkspaceController`

- Add `src/workspace-controller/impl.ts` as the composition root for session, store, and persistence.
- Centralize open, execute, undo, redo, save, export, session subscription, status forwarding, and disposal.
- Controller is the only module importing both persistence and document-session concrete factories. It does not import Three.js, DOM code, or WebXR.
- Add integration tests with fakes and one real KML/KMZ fixture proving operation ordering and error recovery.

### Phase 6 — Migrate editor and AR consumers

- Editor receives `IEditorStore` and `IWorkspaceController`; remove direct `createEditorStore`, `createPersistenceService`, `IKmlDocument`, and `IKmzContainer` use from UI code.
- Feature registry consumes `state.featuresById`/`featureOrder`; controller supplies asset provider as an explicit render binding outside Redux.
- Replace direct `store.commands` calls with controller undo/redo and direct store command calls with controller execute.
- AR follows the same pattern, adding only device-state dispatch and reference-anchor updates.
- Delete the editor's feature-signature persistence heuristic. The session revision is the authoritative change signal.

### Phase 7 — Remove legacy code and documentation

- Delete `store/impl.ts` load/container/document orchestration, `CommandStackDelegator` if no longer needed, and obsolete tests/demos.
- Update plans for store, persistence, editor, and ar-scene to describe target ownership only.
- Remove the temporary “pending shared-container session seam” demo message. Replace it with actual persistence status messages.

## Test plan and acceptance gates

### Unit tests

- `DocumentSession.open` parses only the supplied container and produces one immutable projection.
- All command types mutate the session document, update same container KML, increment revision, and project updated values.
- Undo/redo returns document projection and serialized KML to prior/next state.
- Projection cloning prevents Redux/UI mutation from changing document model fields.
- Store reducers are pure and hold only serializable values.
- Persistence rejects non-session container identity and never schedules a write after failed session serialization.

### Integration tests

- Assert reference equality at all four checkpoints: `persistence.open()` result, `session.container`, `session.open()` argument, and `persistence.flush()` argument.
- Load a real `.kmz`, resolve an asset through the exact session container, issue a text and spatial command, and save.
- File-switch while a save is in flight cannot write the old session into the new handle.
- Permission failure leaves document/session/revision intact and supports retry/export.
- Desktop and AR controller paths emit identical command/session outcomes for equivalent world-space intent.

### End-to-end acceptance test (mandatory before editor demo is called complete)

1. Open a real Google Earth KMZ fixture through `WorkspaceController` without a phone.
2. Programmatically move one marker and one model through normal commands.
3. Flush persistence, reopen the written file through a new controller/session.
4. Assert edited feature coordinates/transforms changed as requested.
5. Assert every unrelated KML byte and all untouched asset bytes are identical.
6. Open the output in Google Earth as the compatibility smoke test.

No workaround, screenshot, or UI-only test substitutes for this gate.

## Risks and safeguards

| Risk | Safeguard |
| --- | --- |
| A migration temporarily exposes two containers | Assert identity in every session/controller integration test; fail fast on mismatch. |
| Redux receives mutable model views | Clone/freeze projection and keep serializability checks enabled. |
| UI renders a projection from a newer session with assets from an old session | Controller issues a monotonically increasing session id; editor registry discards stale work. |
| Command mutation succeeds but serialization fails | Do not publish projection or notify persistence; surface explicit error and retain diagnostic state for retry/recovery. |
| Existing tests mask the wrong architecture | Replace store tests that assert class-instance storage with tests asserting plain projection state. |
| Scope creep into renderer/geo logic | Preserve existing contracts; refactor ownership/orchestration only. Renderer and bridge math changes require separate evidence. |

## Definition of done

The refactor is complete only when:

- no Redux state contains `IKmlDocument`, `IKmzContainer`, `File`, Three.js/WebXR objects, callbacks, or other class instances;
- one file session has exactly one container from open through save/export/disposal;
- every command, undo, and redo updates document, container, store projection, and persistence in the specified order;
- desktop and AR use the same controller/session path;
- the mandatory phone-free real-fixture round-trip test passes; and
- the saved result reopens in Google Earth with untouched regions/assets preserved.
