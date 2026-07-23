# KML Editor Store Component Implementation Plan

## Overview

The `store` component acts as the global state orchestrator for the offline-first KML Editor. It manages the lifecycle of the active document, coordinate bridge, and undo/redo history, providing a single reactive entry point (`IEditorStore`) for the visual presentation and persistence layers.

### Boundaries & Constraints
*   **What it owns:**
    *   The single active in-memory instance of `IKmlDocument` and `IKmzContainer`.
    *   The subscription registry for tracking UI and presenter state updates (`EditorState`).
    *   The active coordinate bridge (`IGeoBridge`) configured with the root anchor coordinate.
    *   The active selection state (`selectedFeatureId`).
    *   Coordination of the loading pipeline.
*   **What it never owns:**
    *   The actual file reading/writing from disk (owned by `persistence`).
    *   Surgical KML node mutations (owned by `kml-model`).
    *   Slam tracking coordinates (owned by the outer AR-scene).
    *   WebGL rendering state, geometries, or texture memory management (owned by `renderers` and `ar-scene`).
*   **Contracts Consumed:**
    *   `IKmlDocument` (from `contracts/document-model.ts`)
    *   `IKmzContainer` (from `contracts/kmz-container.ts`)
    *   `IGeoBridge` (from `contracts/geo-bridge.ts`)
    *   `ICommandStack`, `ICommand` (from `contracts/commands.ts`)
*   **Contracts Implemented:**
    *   `IEditorStore` (from `contracts/store.ts`)

---

## Internal Architecture

The store is divided into modular units to ensure stable references and prevent memory leaks during file reloading.

```
                  +-----------------------------------+
                  |           IEditorStore            |
                  |        (EditorStoreImpl)          |
                  +---------+----------------+--------+
                            |                |
                            v                v
             [ CommandStackDelegator ]  [ SubscriptionRegistry ]
                            |
                            v
                   [ ICommandStack ]
                 (Active Document Stack)
```

### 1. EditorStoreImpl
*   **Responsibility:** Implements `IEditorStore`. Manages the top-level loading pipeline, selection tracking, and component lifecycle events.
*   **Inputs:** Files via `loadFile()`, commands via `executeCommand()`, selection IDs via `selectFeature()`.
*   **Outputs:** Active document/container state and coordinates via state subscriptions.
*   **Dependencies:** `kmz-io`, `kml-model`, `geo-bridge`, `commands`.
*   **Invariants:** Subscriptions are always notified synchronously when state mutations occur. If a file is currently active, it is fully disposed of before a new file is loaded. Uses a transactional load-then-swap pattern during load failures.

### 2. CommandStackDelegator
*   **Responsibility:** Implements `ICommandStack`. Serves as a stable proxy delegate for the active document's command history. This prevents the UI from having to re-bind event listeners when a new file is loaded.
*   **Inputs:** `execute()`, `undo()`, `redo()` calls.
*   **Outputs:** Delegates history queries (`canUndo()`, `canRedo()`) and fires changes to the store.
*   **Invariants:** If no file is loaded, returns `false` for status queries and ignores execution requests. Swapping the active stack automatically triggers a state change notification. Resolves listener leakage by maintaining an internal registration set bridged to active stack events.

### 3. SubscriptionRegistry
*   **Responsibility:** Thread-safe list managing active listener callbacks.
*   **Invariants:** Avoids memory leaks by returning a clean unsubscribe function on registration. Prevents nested trigger recursion by blocking redundant notifications.

---

## Runtime Data Flow

### 1. Transactional File Loading Flow
```
[UI / FileInput]
       |
       v
[Store: loadFile(file)]
       |
       +---> [AbortController: abort()]  (Cancels previous pending load pipeline)
       |
       +---> [Temp Container: open(file)]
       |
       +---> [Temp Doc: parse(xml)]      (If this throws, transaction aborts; state is preserved)
       |
       +---> [GeoBridge: setAnchor()]    (Establish spatial center origin)
       |
       +---> [Swap Active References]     (Safely disposes of old container)
       |
       +---> [Delegator: setStack()]     (Wires history listener)
       |
       v
[Broadcast EditorState to Subscribers]
```

### 2. Command Execution Flow
1.  Presenter or interaction handler calls `store.executeCommand(command)`.
2.  Store delegates the call: `this._commandsDelegator.execute(command)`.
3.  The active `CommandStack` runs `command.execute(document, geoBridge)`, updating the document structure.
4.  The command stack fires its `onChange` event.
5.  `CommandStackDelegator` catches the event and bubbles it to `EditorStoreImpl`.
6.  The store triggers `notifySubscribers()`.
7.  Subscribers (renderers/UI panels) receive the updated state and invoke `update()` to redraw modified geometries.

### 3. Selection Flow
1.  The raycaster clicks a 3D object and calls `store.selectFeature(featureId)`.
2.  Store updates `_selectedFeatureId = featureId`.
3.  Store calls `notifySubscribers()`.
4.  The line renderer checks the selection ID during update and spawns/hides vertex edit handles.

---

## Public Surface

No contracts are modified. The classes implement the interfaces defined in `contracts/store.ts` exactly.

```typescript
import { IEditorStore, EditorState } from '../contracts/store';
import { IKmlDocument } from '../contracts/document-model';
import { IKmzContainer } from '../contracts/kmz-container';
import { ICommandStack, ICommand } from '../contracts/commands';
import { IGeoBridge } from '../contracts/geo-bridge';
import { FeatureId } from '../contracts/type';

export class EditorStoreImpl implements IEditorStore {
    public readonly geoBridge: IGeoBridge;
    
    private _document: IKmlDocument | null = null;
    private _container: IKmzContainer | null = null;
    private _selectedFeatureId: FeatureId | null = null;
    private readonly _commandsDelegator: CommandStackDelegator;
    private _activeStack: ICommandStack | null = null;
    private readonly _listeners: Set<(state: EditorState) => void>;
    private _activeLoadController: AbortController | null = null;

    constructor();

    public get document(): IKmlDocument | null;
    public get container(): IKmzContainer | null;
    public get commands(): ICommandStack;
    public get selectedFeatureId(): FeatureId | null;

    public loadFile(file: File): Promise<void>;
    public selectFeature(id: FeatureId | null): void;
    public executeCommand(command: ICommand): void;
    public subscribe(listener: (state: EditorState) => void): () => void;

    private notifySubscribers(): void;
}

class CommandStackDelegator implements ICommandStack {
    private _activeStack: ICommandStack | null = null;
    private readonly _listeners: Set<() => void>;
    private _activeStackUnsubscribe: (() => void) | null = null;

    public setStack(stack: ICommandStack | null): void;
    public execute(command: ICommand): void;
    public undo(): ICommand | null;
    public redo(): ICommand | null;
    public canUndo(): boolean;
    public canRedo(): boolean;
    public onChange(listener: () => void): () => void;
    private notify(): void;
}
```

---

## Algorithms

### 1. Transactional load-then-swap Algorithm
To prevent the application from entering a corrupt state if parsing fails mid-load:

1.  **Abort Concurrency:**
    ```typescript
    if (this._activeLoadController) {
        this._activeLoadController.abort();
    }
    this._activeLoadController = new AbortController();
    const signal = this._activeLoadController.signal;
    ```
2.  **Load to Temporary Instances:**
    *   Create `tempContainer = createKmzContainer()`.
    *   Call `await tempContainer.open(file)`. If signal is aborted, reject.
    *   Call `tempDoc.parse(tempContainer.getDocKml())`.
3.  **Execute Swap:**
    If parsing completes successfully without errors:
    *   Dispose of the previous active container: `if (this._container) this._container.dispose();`.
    *   Assign active references: `this._container = tempContainer; this._document = tempDoc;`.
    *   Update the command stack delegate.
4.  **Re-establish Coordinates Anchor:** Apply the coordinate origin anchor initialization algorithm.
5.  **Broadcast state:** Invoke `notifySubscribers()`.

### 2. Geographic Center Bounding Box Anchor Policy
To minimize floating point precision loss in Three.js and prevent origin warp when reloading:

1.  **Check Existing Anchor:** If the `geoBridge` has already calibrated a spatial anchor (e.g. from an active AR session), do not modify the anchor. Skip calculations.
2.  **Compute Bounding Box Center:**
    *   Iterate through all spatial nodes in the document.
    *   Track the minimum and maximum latitudes and longitudes:
        $$\text{lon}_{\text{min}}, \text{lon}_{\text{max}}, \text{lat}_{\text{min}}, \text{lat}_{\text{max}}$$
3.  **Anchor Alignment:**
    *   If bounds are valid, compute center:
        $$\text{lon}_{\text{center}} = \frac{\text{lon}_{\text{min}} + \text{lon}_{\text{max}}}{2}, \quad \text{lat}_{\text{center}} = \frac{\text{lat}_{\text{min}} + \text{lat}_{\text{max}}}{2}$$
    *   Configure `geoBridge.setAnchor({ position: { lon: lonCenter, lat: latCenter, alt: 0 }, heading: 0 })`.
    *   If no features exist, default the anchor to `{ lon: 0, lat: 0, alt: 0 }`.

### 3. Sanitization Policy for CDATA HTML
The store propagates raw KML properties to keep the document byte-faithful. Tooltips or UI elements rendering name or description strings must explicitly run them through an HTML sanitizer (e.g. `DOMPurify`) to prevent XSS vulnerability vectors.

---

## State Management

| State Element | Owner | Lifetime | Synchronization | Disposal |
| :--- | :--- | :--- | :--- | :--- |
| **`document`** | `EditorStoreImpl` | Active file session | Replaced on successful `loadFile()`. | Left to JS Garbage Collector. |
| **`container`** | `EditorStoreImpl` | Active file session | Replaced on successful `loadFile()`. | Explicitly disposed via `.dispose()`. |
| **`selectedFeatureId`**| `EditorStoreImpl` | Variable | Updated via `selectFeature()`.| Set to `null` on reload/selection. |
| **`activeStack`** | `EditorStoreImpl` | Active file session | Replaced on successful `loadFile()`. | reset to `null`. |

---

## Error Strategy

1.  **Corrupted ZIP / Invalid KMZ Structure:**
    *   *Symptom:* `IKmzContainer.open()` throws a compression error.
    *   *Recovery:* Catch the error in the `loadFile` promise chain. Do not overwrite the current active document or container. Bubble the error to the UI status panel.
2.  **Invalid doc.kml XML Structure:**
    *   *Symptom:* `IKmlDocument.parse()` fails.
    *   *Recovery:* Catch the parser error. Clean up and dispose of the temporary loading container. Keep the active workspace unchanged.
3.  **Command Execution Errors:**
    *   *Symptom:* `command.execute()` throws an exception.
    *   *Recovery:* Catch the exception, prevent it from modifying the stack index (do not push the command). Log the warning and notify the UI of command failures.

---

## Performance Strategy

*   **Synchronous State Dispatch:** State changes are broadcast synchronously to presenters. This ensures frame rendering remains tightly coupled with user input events, avoiding lag during vertex drags.
*   **Lazy Asset Extraction:** The store does not extract or load KMZ assets upon loading the file. Assets are resolved on-demand by individual renderers via the `IAssetProvider` interface.
*   **Stable Command Proxy:** Using `CommandStackDelegator` avoids rebuilding event listeners in visual components, reducing GC overhead.

---

## Testing Strategy

### 1. Unit Tests
*   **Selection State Test:** Verify `selectFeature` updates selection ID and triggers subscribers.
*   **Delegator Proxy Test:** Assert that executing commands on the delegator before a file is loaded does not crash and returns standard fallback states (`canUndo` = `false`).
*   **Abort Loading Test:** Call `loadFile` twice rapidly. Assert that the first load promise is rejected with an AbortError.

### 2. Integration Tests
*   **File Load Pipeline Test:** Load a mock KMZ file. Verify that `container` and `document` are instantiated, the coordinate anchor is set, and subscribers are notified of the new document structure.
*   **Autodispose Lifecycle Test:** Verify that loading a file twice triggers `.dispose()` on the first container, verifying memory cleanup.
*   **Load Failure Transaction Test:** Attempt to load a corrupt document. Verify that the previous successful document remains active in the store.

---

## Demo

The standalone demo will reside in `demos/store-demo/index.html`.

### Interactive Sandbox Interface:
1.  **File Picker:** Select local KMZ files.
2.  **State Panel:** Displays the active document feature count, active coordinate anchor values, and selection states in real-time.
3.  **Interactive Commands Panel:** Allows renaming the first feature or moving its coordinates to verify command routing and state propagation.
4.  **Undo/Redo Log:** Shows the history state of the active command stack.

---

## Dependencies

*   **KmlEditor Core Components (`kmz-io`, `kml-model`, `geo-bridge`, `commands`):** Wired together to form the global store.

---

## Risks

| Risk | Severity | Detection | Mitigation |
| :--- | :--- | :--- | :--- |
| **Progressive Memory Leak** | **High** | Profile heap sizes under rapid document switching. | Enforce explicit container disposal before replacing references. |
| **State De-synchronization** | **Medium** | Visual viewport does not update after command execution. | Enforce that the store subscribes to the active command stack's `onChange` event. |

---

## Milestones

*   **Milestone 1: Interface & State registration**
    *   Implement `EditorStoreImpl` shell, subscription handlers, and coordinate bridge setup.
*   **Milestone 2: Load File Pipeline**
    *   Integrate `kmz-io` and `kml-model` file loading flows with automatic anchor coordinates setting.
*   **Milestone 3: Command Delegation & Selection**
    *   Implement `CommandStackDelegator` proxy. Setup change hooks between history mutations and store subscribers.
*   **Milestone 4: Tests and Standalone Demo**
    *   Write the unit/integration tests and create the interactive sandbox demo.
