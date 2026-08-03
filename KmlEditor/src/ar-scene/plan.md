# AR Viewing / Editing Scene — Implementation Plan (Revised Architectural Blueprint)

## Overview

`src/ar-scene` is the final composition root (Component 8) of the `KmlEditor` application. It integrates the fully implemented KML engine, geo-coordinate bridge, feature renderers, edit commands, store, and persistence service into a mobile WebXR environment powered by the `location-based-webxr` framework (`GpsPlusSlamJs_AppFramework`).

The AR scene enables an end user outdoors on a mobile WebXR-capable browser to:
1. Open a `.kml` or `.kmz` file.
2. View 3D markers, lines, ground overlays, and 3D models anchored to their real-world geographic coordinates.
3. Select and edit spatial features directly in AR via touch gestures (move markers/models, drag line vertices, rotate/scale overlays) and edit non-spatial metadata (names, descriptions).
4. Persist changes automatically back into the `.kml`/`.kmz` container losslessly, maintaining exact byte-fidelity for untouched elements so the updated file can be reopened seamlessly in Google Earth.

### Boundaries

**It owns:**
- WebXR session initialization, reference space management (`local-floor`, `unbounded`), frame loop execution, visibility state transitions (`visible`, `visible-blurred`, `hidden`), and fallback rendering when WebXR is unsupported.
- Binding the `location-based-webxr` framework's GPS+IMU pose fusion and anchor estimation system to `IGeoBridge`.
- The AR Three.js scene graph (`THREE.Scene`), camera unprojection, light estimation, WebXR reticle/placement helpers, feature scene registry reconciliation, and selection overlay visualizers.
- Mobile WebXR gesture disambiguation (preventing browser pull-to-refresh/page-zoom), touch-to-world raycasting, drag plane construction, and gesture completion handling.
- Dispatching user interactions as pure `ICommand` actions into `IEditorStore`.
- An AR HUD overlay (DOM-based non-blocking UI for tracking quality, GPS dilution of precision, save status, undo/redo buttons, and feature property editing).
- Deterministic AR replay integration using recorded GPS/sensor datasets from `GpsPlusSlamJs_RecorderApp` for phone-free desktop testing and automated e2e validation.

**It never owns:**
- ZIP archive unpacking, asset resolution, Blob URL allocation, or KMZ writing (`kmz-io`).
- KML XML parsing, CST document representation, surgical DOM mutation, or node serialization (`document-model`).
- WGS84 to local cartesian math or coordinate formatting rules (`geo-bridge`).
- Three.js geometry, shader materials, or asset loading logic for markers, lines, overlays, or models (`renderers`).
- Command mutation logic, inverse commands, or undo/redo stack state (`commands`).
- File handle storage, atomic disk writes, debounced autosave timing, or OPFS fallbacks (`persistence`).
- Redux store state reducers or canonical state storage (`store`).

### Contracts Consumed
- `IEditorStore` and `EditorState` from `contracts/store.ts`.
- `IKmlDocument`, `IFeatureView`, `IMarkerFeature`, `ILineFeature`, `IGroundOverlayFeature`, `IModelFeature` from `contracts/document-model.ts`.
- `IKmzContainer` and `IAssetProvider` from `contracts/kmz-container.ts`.
- `IFeatureRenderer` and `IRendererFactory` from `contracts/renderer.ts`.
- `ICommand` and `ICommandStack` from `contracts/commands.ts`.
- `IPersistenceService` and `SaveStatus` from `contracts/persistence.ts`.
- `IGeoBridge` and `GeoAnchor` from `contracts/geo-bridge.ts`.
- `FeatureId`, `WorldPosition`, `GeoPosition`, `AltitudeMode` from `contracts/type.ts`.

### Contracts Implemented
None. `ar-scene` is the top-level application composition root for WebXR. It consumes existing contracts without introducing new cross-component contracts.

---

## Internal Architecture

```text
ArApp (composition root & lifecycle)
 ├── ArSessionManager (WebXR XRSession, reference space, WebGL binding, visibility state)
 ├── ArSceneManager (THREE.Scene, camera, lighting, frame loop, reticle, VRAM memory budget)
 │    └── FeatureSceneRegistry (reconciles document.getFeatures() -> THREE.Object3D)
 ├── ArAnchorCoordinator (binds GPS+SLAM pose -> IGeoBridge anchor, altitude policy, anchor lock)
 ├── ArInteractionController (touch gesture disambiguation -> screen raycast -> ICommand)
 ├── ArHud (DOM overlay: status, tracking quality, undo/redo, property modals)
 ├── ArReplayAdapter (feeds Task 1 sensor datasets for phone-free testing)
 └── PersistenceCoordinator (subscribes to store changes -> triggers IPersistenceService)
```

### Module Breakdown

#### 1. `ar-app.ts` (`ArApp`)
- **Responsibility:** Top-level composition root for Component 8. Constructs dependencies, manages application lifecycle, connects WebXR events to scene managers, handles window blur/focus events, and guarantees clean teardown.
- **Inputs:** Host DOM container element, configuration options (`ArAppOptions`), optional injected test doubles for store/persistence.
- **Outputs:** Mounted AR canvas, active session lifecycle controls (`startArSession()`, `stopArSession()`, `dispose()`).
- **Dependencies:** `IEditorStore`, `IPersistenceService`, `IRendererFactory`, `ArSessionManager`, `ArSceneManager`, `ArAnchorCoordinator`, `ArInteractionController`, `ArHud`.
- **Invariants:** Exactly one active AR session at any time. Teardown disposes WebXR resources, store subscriptions, and Three.js objects cleanly without memory leaks.

#### 2. `ar-session-manager.ts` (`ArSessionManager`)
- **Responsibility:** Manages `XRSession` creation, requests `immersive-ar` with `local-floor` or `unbounded` reference spaces, binds WebGL2 rendering context, handles `visibilitychange` events, and manages session end.
- **Inputs:** HTMLCanvasElement, WebGL2RenderingContext.
- **Outputs:** Active `XRSession`, current `XRFrame`, `XRReferenceSpace`, tracking status (`'uninitialized' | 'searching' | 'tracking' | 'lost'`).
- **Dependencies:** WebXR Device API (`navigator.xr`), `GpsPlusSlamJs_AppFramework/ar`.
- **Invariants:** Gracefully degrades if WebXR is unavailable or permission is denied by notifying `ArApp` to present an error fallback UI.

#### 3. `ar-scene-manager.ts` (`ArSceneManager`)
- **Responsibility:** Manages `THREE.Scene`, `THREE.PerspectiveCamera`, outdoor AR ambient/directional lighting, reticle mesh, and feature rendering via `FeatureSceneRegistry`. Enforces VRAM texture budget limits (256MB max) to prevent mobile WebGL context loss.
- **Inputs:** WebGLRenderer, XRFrame pose.
- **Outputs:** Rendered AR frame, access to `featureGroup`, VRAM usage statistics.
- **Dependencies:** `three`, `FeatureSceneRegistry` (from `editor`).
- **Invariants:** Feature objects are children of `featureGroup` (transformed by `ArAnchorCoordinator`). Editor selection handles sit on `overlayGroup`.

#### 4. `ar-anchor-coordinator.ts` (`ArAnchorCoordinator`)
- **Responsibility:** Fuses real-world GPS position and compass heading with WebXR local tracking space to update `IGeoBridge` anchor. Implements **Anchor Lock** (freezing GPS anchor adjustments during active 3D drags or when GPS DOP > 15m) and resolves AR terrain elevation policy (`clampToGround`, `relativeToGround`, `absolute`).
- **Inputs:** `IGeoBridge`, GPS updates, WebXR viewer pose (`XRViewerPose`).
- **Outputs:** Updated `GeoAnchor` set on `IGeoBridge`, alignment matrix for `featureGroup`.
- **Dependencies:** `IGeoBridge`, `GpsPlusSlamJs_AppFramework/geo`.
- **Invariants:** The world origin (0,0,0) in Three.js represents the active AR GPS anchor. Spatial coordinates mutate in meters relative to this anchor without drifting stored Lat/Lon precision.

#### 5. `ar-interaction-controller.ts` (`ArInteractionController`)
- **Responsibility:** Translates 2D touch events on the AR screen (tap, drag, pinch/rotate gestures) into 3D raycasts against feature bounding meshes or interaction handles, producing `ICommand` instances (`MoveMarkerCommand`, `MoveModelCommand`, `MoveLineVertexCommand`, etc.). Manages gesture disambiguation and prevents browser default touch scrolling/zooming.
- **Inputs:** Touch DOM events (`touchstart`, `touchmove`, `touchend`), WebXR raycast vectors, active `EditorState`.
- **Outputs:** Executed commands dispatched via `IEditorStore.executeCommand()`.
- **Dependencies:** `IEditorStore`, `IGeoBridge`, `IKmlDocument`, Three.js `Raycaster`.
- **Invariants:** Touch gestures in progress update visual preview handles immediately. Command execution only fires on gesture completion (`touchend`), ensuring atomic undo history entries.

#### 6. `ar-hud.ts` (`ArHud`)
- **Responsibility:** Renders a responsive 2D DOM overlay on top of the AR WebGL canvas. Displays tracking quality indicators, GPS accuracy, save status, undo/redo controls, feature selection info, and property editing modals.
- **Inputs:** `IEditorStore` state updates, `IPersistenceService` status updates.
- **Outputs:** DOM user actions (clicks/taps on Undo, Redo, Save, Deselect, Edit Name/Description).
- **Dependencies:** Vanilla DOM / CSS (`src/ar-scene/ar-hud.css`).
- **Invariants:** Non-blocking overlay; touch events on HUD controls stop propagation so they do not trigger 3D AR raycasts.

#### 7. `ar-replay-adapter.ts` (`ArReplayAdapter`)
- **Responsibility:** Connects recorded sensor datasets (Task 1 recordings containing GPS, IMU, and frame poses) to `ArAnchorCoordinator` and `ArSceneManager`, bypassing hardware WebXR for phone-free desktop testing and automated e2e vitest runs.
- **Inputs:** Raw recorded dataset buffer / JSON logs.
- **Outputs:** Simulated GPS positions and WebXR viewer poses over time.
- **Dependencies:** `GpsPlusSlamJs_AppFramework/storage`, `ReplayHarness` (from `editor`).
- **Invariants:** Replay execution produces identical `ICommand` sequences and KML document mutations as live device runs.

---

## Runtime Data Flow

### 1. AR Application Initialization & File Loading
```text
User opens app -> ArApp.init()
 ├── 1. Create IEditorStore, IPersistenceService, IRendererFactory, IGeoBridge
 ├── 2. Prompt user to select .kml / .kmz file via IPersistenceService.open()
 ├── 3. Parse doc.kml -> IKmlDocument
 ├── 4. Set initial GeoBridge anchor from first feature position or current GPS fix
 ├── 5. Initialize ArHud and display "Start AR" button
```

### 2. Launching WebXR Session & Anchor Alignment
```text
User taps "Start AR" -> ArSessionManager.requestSession()
 ├── 1. navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor', 'dom-overlay'] })
 ├── 2. Bind WebGL renderer to WebXR layer
 ├── 3. Start WebXR animation loop (session.requestAnimationFrame)
 ├── 4. Listen to GPS sensor updates -> ArAnchorCoordinator updates IGeoBridge anchor (unless Anchor Lock is active)
 ├── 5. FeatureSceneRegistry reconciles features -> populates THREE.Scene featureGroup
```

### 3. Feature Selection & Gesture Disambiguation in AR
```text
User taps object on screen -> touchstart
 ├── 1. ArInteractionController calls event.preventDefault() (touch-action: none)
 ├── 2. Convert touch coordinates to WebXR normalized screen ray
 ├── 3. Raycast against THREE.Scene feature meshes & handles
 ├── 4. Hit detected (e.g., FeatureId "marker-102") -> store.selectFeature("marker-102")
 ├── 5. ArAnchorCoordinator engages Anchor Lock (freezes GPS anchor adjustments during active interaction)
 ├── 6. Store update -> ArHud displays feature panel & SelectionPresentation renders 3D edit handles
```

### 4. Spatial Editing in AR (e.g., Dragging a Marker in 3D Space)
```text
User drags selection handle -> touchmove
 ├── 1. ArInteractionController creates drag plane parallel to viewer camera at target depth
 ├── 2. Raycast continuous touch position against drag plane -> compute new WorldPosition (x,y,z)
 ├── 3. Update preview mesh position in real-time (60fps visual feedback)
User releases touch -> touchend
 ├── 4. GeoBridge.worldToGeo(newWorldPos, altitudeMode) -> new GeoPosition (lon, lat, alt)
 ├── 5. Construct MoveMarkerCommand(featureId, newGeoPos, oldGeoPos)
 ├── 6. store.executeCommand(command) -> mutates IKmlDocument in place
 ├── 7. ArAnchorCoordinator releases Anchor Lock
 ├── 8. store.notifyDocumentChanged() -> triggers debounced IPersistenceService.save()
 ├── 9. Save status transitions: 'idle' -> 'saving' -> 'saved' (reflected in AR HUD)
```

### 5. Undo / Redo Flow in AR
```text
User taps "Undo" in AR HUD
 ├── 1. store.undo()
 ├── 2. CommandStack executes command.undo(document, geoBridge)
 ├── 3. In-place KML mutation reverted byte-faithfully
 ├── 4. store.notifyDocumentChanged() -> feature registry re-renders -> debounced save triggered
```

### 6. WebXR Interruption & Teardown Flow
```text
XRSession receives 'visibilitychange' (e.g., incoming call / app switch)
 ├── 1. If visibilitystate === 'visible-blurred' or 'hidden': pause frame updates, abort active gesture drags safely
 ├── 2. On XRSession 'end' event: restore 2D canvas view, flush pending writes via persistenceService.flush()
 ├── 3. Dispose WebGL/WebXR resources cleanly
```

---

## Public Surface

```typescript
/**
 * Configuration options for mounting the AR application scene.
 */
export interface ArAppOptions {
    /** Host DOM container for canvas and HUD overlays */
    container: HTMLElement;
    /** Pre-instantiated store instance (optional) */
    store?: IEditorStore;
    /** Pre-instantiated persistence service (optional) */
    persistenceService?: IPersistenceService;
    /** Pre-instantiated renderer factory (optional) */
    rendererFactory?: IRendererFactory<THREE.Object3D>;
    /** Enable offline replay harness with preloaded dataset */
    replayDataset?: ArrayBuffer;
}

/**
 * Main application composition root for Component 8 (AR Scene).
 */
export class ArApp {
    constructor(options: ArAppOptions);
    public async init(): Promise<void>;
    public async startArSession(): Promise<void>;
    public async stopArSession(): Promise<void>;
    public async openFile(file?: File): Promise<void>;
    public dispose(): void;
}

/**
 * Manages WebXR session lifecycle and WebGL binding.
 */
export class ArSessionManager {
    constructor(canvas: HTMLCanvasElement);
    public async requestSession(): Promise<XRSession>;
    public endSession(): Promise<void>;
    public onFrame(callback: (time: DOMHighResTimeStamp, frame: XRFrame) => void): void;
    public getSession(): XRSession | null;
    public isSupported(): Promise<boolean>;
    public dispose(): void;
}

/**
 * Coordinates GPS + SLAM pose fusion with the GeoBridge anchor.
 */
export class ArAnchorCoordinator {
    constructor(geoBridge: IGeoBridge, store: IEditorStore);
    public updateGps(latitude: number, longitude: number, altitude: number, accuracy: number): void;
    public updateViewerPose(pose: XRViewerPose): void;
    public applyAltitudePolicy(featurePos: GeoPosition, mode: AltitudeMode, groundY: number): WorldPosition;
    public setAnchorLock(locked: boolean): void;
    public resetAnchor(position: GeoPosition, heading: number): void;
}

/**
 * Touch gesture controller for WebXR feature picking and spatial editing.
 */
export class ArInteractionController {
    constructor(
        sceneManager: ArSceneManager,
        geoBridge: IGeoBridge,
        store: IEditorStore
    );
    public handleTouchStart(event: TouchEvent, frame: XRFrame): void;
    public handleTouchMove(event: TouchEvent, frame: XRFrame): void;
    public handleTouchEnd(event: TouchEvent): void;
    public dispose(): void;
}

/**
 * 2D HUD UI overlay for mobile AR sessions.
 */
export class ArHud {
    constructor(container: HTMLElement, store: IEditorStore, persistenceService: IPersistenceService);
    public mount(): void;
    public unmount(): void;
    public showMessage(msg: string, durationMs?: number): void;
    public dispose(): void;
}

/**
 * Offline dataset replay adapter for phone-free AR testing.
 */
export class ArReplayAdapter {
    constructor(anchorCoordinator: ArAnchorCoordinator, store: IEditorStore);
    public async loadRecording(zipBuffer: ArrayBuffer): Promise<number>;
    public play(): void;
    public pause(): void;
    public step(): boolean;
}
```

---

## Algorithms

### 1. AR Touch-to-World Raycasting & Ray-Plane Dragging Algorithm
- **Purpose:** Map a 2D touch point on a mobile phone screen during a WebXR session to a 3D target point in the AR scene for dragging markers or models.
- **Steps:**
  1. Retrieve normalized device coordinates (NDC) from touch event: $x_{ndc} = (x_{touch} / w) \cdot 2 - 1$, $y_{ndc} = -(y_{touch} / h) \cdot 2 + 1$.
  2. Unproject NDC ray using WebXR camera projection matrix and viewer pose matrix:
     $$\vec{r}_{origin} = \mathbf{M}_{viewer\_pose} \cdot \vec{0}$$
     $$\vec{r}_{dir} = \text{normalize}\left(\mathbf{M}_{viewer\_pose} \cdot \mathbf{P}_{camera}^{-1} \cdot [x_{ndc}, y_{ndc}, 1, 1]^T\right)$$
  3. Construct a virtual drag plane at the object's initial position, oriented to face the viewer camera: plane normal $\vec{n} = \text{normalize}(\vec{r}_{origin} - \vec{p}_{initial})$.
  4. Compute intersection of user's updated touch ray with the drag plane:
     $$t = \frac{(\vec{p}_{initial} - \vec{r}_{origin}) \cdot \vec{n}}{\vec{r}_{dir} \cdot \vec{n}}$$
     $$\vec{p}_{new} = \vec{r}_{origin} + t \cdot \vec{r}_{dir}$$
  5. Clamp $\vec{p}_{new}$ within safety bounds (maximum 50m distance from viewer).
- **Complexity:** $O(1)$ constant time matrix multiplications and vector dot products per frame.
- **Failure Cases:** Ray parallel to drag plane ($\vec{r}_{dir} \cdot \vec{n} \approx 0$). Handled by ignoring touch move updates when magnitude $< 10^{-4}$.

### 2. AltitudeMode Resolution Policy in AR
- **Purpose:** Resolve the 3D local Y-coordinate for features based on KML `altitudeMode` (`clampToGround`, `relativeToGround`, `absolute`).
- **Policy & Constraints:**
  - `clampToGround`: Feature sits on the local AR ground plane ($Y_{world} = Y_{ground\_plane}$, where $Y_{ground\_plane}$ is established by WebXR `local-floor` space, default $Y = 0$).
  - `relativeToGround`: Feature Y-coordinate is elevated relative to ground plane ($Y_{world} = Y_{ground\_plane} + \text{alt}_{kml}$).
  - `absolute`: Feature Y-coordinate is calculated relative to sea-level altitude via `IGeoBridge.geoToWorld()` ($Y_{world} = \text{alt}_{kml} - \text{alt}_{anchor}$).
- **Elevation Disclaimer:** Web browsers lack global Digital Elevation Models (DEM). For features farther than 30m away on sloped terrain, terrain clipping or floating may occur. `ArHud` displays a non-intrusive warning when rendering distant `clampToGround` features without local mesh elevation.

### 3. Anchor Lock & Low-Pass GPS Filtering
- **Purpose:** Prevent abrupt coordinate anchor jumps while editing features in 3D AR space.
- **Steps:**
  1. Maintain `isAnchorLocked: boolean` flag in `ArAnchorCoordinator`.
  2. When user initiates an AR drag gesture (`touchstart`), set `isAnchorLocked = true`.
  3. While `isAnchorLocked === true` or GPS DOP $> 15\text{m}$, incoming GPS position updates are buffered but do not shift the `IGeoBridge` origin matrix.
  4. When interaction ends (`touchend`), set `isAnchorLocked = false`.
  5. Smoothly convergence anchor origin to latest GPS fix using an exponential low-pass filter over a 2-second transition window ($\alpha = \min(1.0, \Delta t / 2.0)$).

---

## State Management

| State Item | Owner | Lifetime | Synchronization / Invalidation Rules | Disposal Strategy |
| :--- | :--- | :--- | :--- | :--- |
| `selectedFeatureId` | `IEditorStore` | App session | Updated on touch pick; triggers SelectionPresentation highlights | Reset to `null` on document reload |
| `editMode` | `IEditorStore` | App session | Determines active AR touch interaction controller mode | Defaults to `'select'` |
| `isArActive` | `IEditorStore` | WebXR session | Set to `true` on `XRSession` start, `false` on exit | Reset on session end |
| `device.gpsPosition` | `IEditorStore` | Continuous | Updated on GPS sensor callback; triggers `ArAnchorCoordinator` | Cleared on session stop |
| `featureSceneRegistry` | `ArSceneManager` | Document lifecycle | Reconciled against `IKmlDocument.getFeatures()` on document change | Calls `renderer.dispose()` on removed features |
| `activeDragTarget` | `ArInteractionController` | Touch drag gesture | Set on `touchstart`, cleared on `touchend` | Nullified on gesture complete |
| `saveStatus` | `IPersistenceService` | File lifecycle | Listened by `ArHud` (`'idle'` $\rightarrow$ `'saving'` $\rightarrow$ `'saved'`) | Event listener unsubscribed on teardown |

---

## Error Strategy

```text
Error Scenario                 Diagnostic / Indicator                    Recovery Action
-------------------------------------------------------------------------------------------------------------------
WebXR Unsupported              navigator.xr undefined                    Render fallback overlay; enable 2D/3D non-AR view
WebXR Permission Denied        XRSession request rejected                Display "Camera / AR permission required" prompt in HUD
GPS Unavailable / Timeout      DeviceState.gpsPosition === null          Use reference anchor; allow manual placement in AR
SLAM Tracking Lost             XRFrame pose.emulatedPosition === true    Show "Move device around to restore tracking" HUD warning
Corrupt KMZ / Invalid KML      KmzContainer open exception               Display non-modal error toast; keep existing file loaded
Persistence Permission Denied  IPersistenceService status === 'error'    Show export fallback banner: "Download modified file"
Collada Model (.dae) Fail      ColladaLoader load error                  Render bounding box fallback mesh; preserve KML bytes
WebXR Session Interrupted      visibilitystate === 'hidden'              Pause frame loop, cancel active drag, flush pending save
```

---

## Performance & VRAM Strategy

- **Target Frame Rate:** 60fps / 90fps uninterrupted WebXR animation loop.
- **VRAM Memory Budget (256MB Limit):**
  - Track texture allocations via `ArSceneManager`.
  - If loaded COLLADA `.dae` model textures exceed 256MB VRAM, automatically downsample or unload distant model textures, rendering bounding box placeholder meshes for models $> 100\text{m}$ away.
- **Zero Heap Allocations in Frame Loop:** Pre-allocate all reusable `THREE.Vector3`, `THREE.Matrix4`, `THREE.Raycaster`, and `THREE.Quaternion` objects outside the animation frame callback.
- **Frustum Culling & Visibility Radius:** Features further than 500 meters from the active AR anchor have `THREE.Object3D.visible = false`.

---

## Testing Strategy

### 1. Unit Tests (`tests/ar-scene.unit.test.ts`)
- Touch NDC to 3D drag plane unprojection math.
- `AltitudeMode` policy Y-resolution math.
- Anchor Lock state transitions during spatial drags.

### 2. Integration Tests (`tests/ar-scene.integration.test.ts`)
- AR touch gesture sequence (`touchstart` $\rightarrow$ `touchmove` $\rightarrow$ `touchend`) dispatches valid `ICommand` into `IEditorStore` and mutates `IKmlDocument`.
- Scene graph reconciliation upon document feature insertion/deletion.

### 3. Phone-Free Replay E2E Tests (`tests/ar-replay-e2e.test.ts`)
- Load Task 1 recorded dataset ZIP (`2026-06-24_13-58-24utc.zip`) via `ArReplayAdapter`.
- Replay camera trajectories and execute marker/model move commands.
- Save modified container to ArrayBuffer via `IPersistenceService`.
- Assert edited coordinates reflect new values while untouched XML nodes and asset bytes remain **100% byte-identical**.

---

## Demo

- **Demo Path:** `demos/ar-scene-demo/index.html` (runnable via `vite --open /demos/ar-scene-demo/`).
- **Interactive Capabilities:**
  - Desktop: Replays recorded sensor dataset via `ArReplayAdapter`. User can pick features, drag 3D handles, and edit properties.
  - Mobile WebXR: Launches native `immersive-ar` session. Features anchor to GPS position. User edits spatial objects in AR and observes debounced save status in HUD.
  - Export: Allows downloading modified `.kmz` files directly for verification in Google Earth.

---

## Dependencies

- `three` (`^0.184.0`): 3D web rendering engine.
- `gps-plus-slam-app-framework`: Monorepo workspace framework package providing WebXR session management, GPS/IMU pose fusion, sensor dataset storage, and replay utilities.
- `@reduxjs/toolkit` (`^2.11.2`): Shared state management store.

---

## Risks

| Severity | Risk | Detection Method | Mitigation Plan | Fallback Plan |
| :--- | :--- | :--- | :--- | :--- |
| **High** | Mobile Chrome File System Access API restriction prevents direct file handle write back | Check `persistenceService.hasNativeFileAccess` on session start | Utilize OPFS working copy with auto-save; prompt download on exit | Export/download button in AR HUD |
| **High** | GPS drift outdoors causes AR features to shift during active 3D drags | Monitor GPS Dilution of Precision (DOP) & accuracy radius | Activate `ArAnchorCoordinator` Anchor Lock during drags | Allow manual "Re-anchor Here" in HUD |
| **Medium**| Touch gesture conflict (browser zoom/swipe vs 3D AR drag) | Touch event listener inspection | Enforce `touch-action: none` and `event.preventDefault()` on WebXR canvas | Dedicated 3D drag handle gizmos |
| **Medium**| Excessive VRAM usage from COLLADA textures causing mobile WebGL context loss | Track texture memory in `ArSceneManager` | Enforce 256MB VRAM budget; downsample textures | Replace distant models with bounding box meshes |

---

## Milestones

### Milestone 1: WebXR Session Setup & Replay Harness Integration
- Implement `ArSessionManager`, `ArSceneManager`, and `ArReplayAdapter`.
- Achieve deterministic sensor pose playback using Task 1 recorded dataset.
- **Deliverable:** Working phone-free desktop replay demo displaying camera trajectory and static scene features.

### Milestone 2: Geo-Anchor Coordination & Feature Reconciliation
- Implement `ArAnchorCoordinator` (with Anchor Lock) and integrate `FeatureSceneRegistry`.
- Resolve `clampToGround`, `relativeToGround`, and `absolute` altitude policies in WebXR space.
- **Deliverable:** Real-world GPS coordinates successfully anchored into WebXR Three.js scene.

### Milestone 3: AR Touch Interactions & Command Layer Wiring
- Implement `ArInteractionController` for touch picking, 3D drag planes, and vertex handle manipulation.
- Connect touch gestures to `IEditorStore.executeCommand()`.
- **Deliverable:** Full spatial editing functioning in WebXR and replay mode.

### Milestone 4: AR HUD, Persistence & End-to-End Acceptance Validation
- Implement `ArHud` DOM overlay (status, tracking, undo/redo, property editing).
- Run full phone-free replay e2e tests asserting byte-faithful lossless KMZ round-trip.
- **Deliverable:** Complete standalone demo (`demos/ar-scene-demo/`) verified on mobile WebXR hardware and successfully validated in Google Earth.
