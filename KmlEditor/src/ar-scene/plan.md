# AR Viewing / Editing Scene — Implementation Plan

## Overview

`src/ar-scene` is the final composition root (Component 8) of the `KmlEditor` application. It brings the fully implemented KML engine, geo-coordinate bridge, feature renderers, edit commands, store, and persistence service into a mobile WebXR environment powered by the `location-based-webxr` framework (`GpsPlusSlamJs_AppFramework`).

The AR scene enables an end user outdoors on a mobile browser (WebXR-capable) to:
1. Open a `.kml` or `.kmz` file.
2. View 3D markers, lines, ground overlays, and 3D models anchored to their real-world geographic coordinates.
3. Select and edit spatial features directly in AR via touch gestures (e.g., move markers/models, drag line vertices, rotate/scale overlays) and edit non-spatial metadata (names, descriptions).
4. Persist changes automatically back into the `.kml`/`.kmz` container losslessly, maintaining exact byte-fidelity for untouched elements so the updated file can be reopened seamlessly in Google Earth.

### Boundaries

**It owns:**
- WebXR session initialization, lifecycle management (`XRSession`), camera frame updates, and fallback handling when WebXR is unsupported.
- Binding the `location-based-webxr` framework's GPS+IMU pose fusion and anchor estimation system to `IGeoBridge`.
- The AR Three.js scene graph, WebXR reticle, selection visualizers, and frame loop integration.
- Touch gesture interpretation in WebXR (screen-to-world raycasting, object selection, 3D translation/rotation plane drags, vertex handle interactions).
- Dispatching user interactions as pure `ICommand` actions into `IEditorStore`.
- An AR HUD overlay (minimal DOM UI for tracking state, save status, undo/redo buttons, and feature property editing).
- Deterministic AR replay integration using recorded GPS/sensor datasets from `GpsPlusSlamJs_RecorderApp` for phone-free desktop testing and e2e validation.

**It never owns:**
- ZIP archive unpacking, asset resolution, Blob URL allocation, or KMZ writing (`kmz-io`).
- KML XML parsing, CST document representation, surgical DOM mutation, or node serialization (`document-model`).
- WGS84 to local cartesian math or coordinate formatting rules (`geo-bridge`).
- Three.js geometry, shader materials, or asset loading logic for markers, lines, overlays, or models (`renderers`).
- Command mutation logic, inverse commands, or undo/redo stack state (`commands`).
- File handle storage, atomic disk writes, debounced autosave timing, or OPFS fallbacks (`persistence`).
- Redux store state reducers or canonical state storage (`store`).

### Contracts consumed

- `IEditorStore` and `EditorState` from `contracts/store.ts`.
- `IKmlDocument`, `IFeatureView`, `IMarkerFeature`, `ILineFeature`, `IGroundOverlayFeature`, `IModelFeature` from `contracts/document-model.ts`.
- `IKmzContainer` and `IAssetProvider` from `contracts/kmz-container.ts`.
- `IFeatureRenderer` and `IRendererFactory` from `contracts/renderer.ts`.
- `ICommand` and `ICommandStack` from `contracts/commands.ts`.
- `IPersistenceService` and `SaveStatus` from `contracts/persistence.ts`.
- `IGeoBridge` and `GeoAnchor` from `contracts/geo-bridge.ts`.
- `FeatureId`, `WorldPosition`, `GeoPosition`, `AltitudeMode` from `contracts/type.ts`.

### Contracts implemented

None. `ar-scene` is the top-level application composition root for WebXR. It consumes and orchestrates existing contracts without introducing new cross-component contracts.

### Architectural Assumptions

- Components 1 through 7 are complete, fully tested, and exposed via their clean interfaces.
- The `location-based-webxr` framework (`GpsPlusSlamJs_AppFramework`) is accessible via package imports, providing low-level WebXR pose fusion, GPS sensor streams, and sensor dataset replay.
- `IEditorStore` is the single source of truth for UI state, document revision, and device pose.
- `IPersistenceService` handles automatic debounced saves when `store.notifyDocumentChanged()` is triggered.

---

## Internal Architecture

The AR scene architecture separates WebXR hardware management, geo-anchoring, spatial gesture interpretation, and UI overlays into focused, loosely-coupled modules:

```text
ArApp (composition root & lifecycle)
 ├── ArSessionManager (WebXR XRSession, reference space, WebGL binding)
 ├── ArSceneManager (THREE.Scene, camera, light, frame loop, reticle)
 │    └── FeatureSceneRegistry (reconciles document.getFeatures() -> THREE.Object3D)
 ├── ArAnchorCoordinator (binds GPS+SLAM pose -> IGeoBridge anchor)
 ├── ArInteractionController (touch gestures -> screen raycast -> ICommand)
 ├── ArHud (DOM overlay: status, tracking quality, undo/redo, edit modals)
 ├── ArReplayAdapter (feeds Task 1 sensor datasets for phone-free testing)
 └── PersistenceCoordinator (subscribes to store changes -> triggers IPersistenceService)
```

### Module Breakdown

#### 1. `ar-app.ts` (`ArApp`)
- **Responsibility:** Top-level composition root for the AR scene. Instantiates dependencies, manages startup/shutdown lifecycles, connects WebXR events to scene managers, and coordinates teardown.
- **Inputs:** Host DOM container element, configuration options (`ArAppOptions`), optional injected test doubles for store/persistence.
- **Outputs:** Mounted AR canvas, active session lifecycle controls (`startArSession()`, `stopArSession()`, `dispose()`).
- **Dependencies:** `IEditorStore`, `IPersistenceService`, `IRendererFactory`, `ArSessionManager`, `ArSceneManager`, `ArAnchorCoordinator`, `ArInteractionController`, `ArHud`.
- **Invariants:** Exactly one active AR session at any time. Teardown disposes WebXR resources, store subscriptions, and Three.js objects cleanly without memory leaks.

#### 2. `ar-session-manager.ts` (`ArSessionManager`)
- **Responsibility:** Manages the WebXR `XRSession` lifecycle, requests `immersive-ar` mode with `local-floor` or `unbounded` reference spaces, binds WebGL rendering contexts, and handles session end events.
- **Inputs:** HTMLCanvasElement, WebGL2RenderingContext.
- **Outputs:** Active `XRSession`, current `XRFrame`, `XRReferenceSpace`, tracking status (`'uninitialized' | 'searching' | 'tracking' | 'lost'`).
- **Dependencies:** WebXR Device API (`navigator.xr`), `GpsPlusSlamJs_AppFramework/ar`.
- **Invariants:** Gracefully degrades if WebXR is unavailable or permission is denied by notifying `ArApp` to present an error fallback UI.

#### 3. `ar-scene-manager.ts` (`ArSceneManager`)
- **Responsibility:** Manages the WebXR Three.js `THREE.Scene`, `THREE.PerspectiveCamera`, directional/ambient lighting tuned for outdoor AR, the reticle/placement mesh, and scene graph hierarchy. Includes `FeatureSceneRegistry` reconciliation.
- **Inputs:** WebGLRenderer, XRFrame pose.
- **Outputs:** Rendered AR frame, access to feature root container `THREE.Group`, raycasting target list.
- **Dependencies:** `three`, `FeatureSceneRegistry` (from `editor`).
- **Invariants:** Feature objects are children of `featureGroup` (which is transformed by `ArAnchorCoordinator`). Editor selection handles sit on `overlayGroup`.

#### 4. `ar-anchor-coordinator.ts` (`ArAnchorCoordinator`)
- **Responsibility:** Fuses real-world GPS position and compass heading with WebXR local tracking space to update `IGeoBridge` anchor. Resolves the altitude policy (`clampToGround`, `relativeToGround`, `absolute`) for spatial features in AR.
- **Inputs:** `IGeoBridge`, GPS updates (`latitude`, `longitude`, `altitude`, `accuracy`), WebXR device pose (`XRViewerPose`).
- **Outputs:** Updated `GeoAnchor` set on `IGeoBridge`, alignment matrix for `featureGroup`.
- **Dependencies:** `IGeoBridge`, `GpsPlusSlamJs_AppFramework/geo`.
- **Invariants:** The world origin (0,0,0) in Three.js represents the active AR GPS anchor. Spatial coordinates mutate in meters relative to this anchor without drifting stored Lat/Lon precision.

#### 5. `ar-interaction-controller.ts` (`ArInteractionController`)
- **Responsibility:** Translates 2D touch events on the AR screen (tap, drag, pinch/rotate gestures) into 3D raycasts against feature bounding meshes or interaction handles, producing `ICommand` instances (`MoveMarkerCommand`, `MoveModelCommand`, `MoveLineVertexCommand`, etc.).
- **Inputs:** Touch DOM events (`touchstart`, `touchmove`, `touchend`), WebXR raycast vectors, active `EditorState`.
- **Outputs:** Executed commands dispatched via `IEditorStore.executeCommand()`.
- **Dependencies:** `IEditorStore`, `IGeoBridge`, `IKmlDocument`, Three.js `Raycaster`.
- **Invariants:** Gestures in progress update visual preview handles immediately. Command execution only fires on gesture completion (`touchend`), ensuring atomic undo history entries.

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
 ├── 4. Listen to GPS sensor updates -> ArAnchorCoordinator updates IGeoBridge anchor
 ├── 5. FeatureSceneRegistry reconciles features -> populates THREE.Scene featureGroup
```

### 3. Feature Selection in AR
```text
User taps object on screen -> touchstart/touchend
 ├── 1. ArInteractionController converts touch coordinates to WebXR normalized screen ray
 ├── 2. Raycast against THREE.Scene feature meshes
 ├── 3. Hit detected (e.g., FeatureId "marker-102")
 ├── 4. store.selectFeature("marker-102")
 ├── 5. Store update -> ArHud displays feature details panel & SelectionPresentation renders 3D edit handles
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
 ├── 7. store.notifyDocumentChanged() -> triggers debounced IPersistenceService.save()
 ├── 8. Save status transitions: 'idle' -> 'saving' -> 'saved' (reflected in AR HUD)
```

### 5. Undo / Redo Flow in AR
```text
User taps "Undo" in AR HUD
 ├── 1. store.undo()
 ├── 2. CommandStack executes command.undo(document, geoBridge)
 ├── 3. In-place KML mutation reverted byte-faithfully
 ├── 4. store.notifyDocumentChanged() -> feature registry re-renders -> debounced save triggered
```

### 6. WebXR Session Teardown
```text
User exits AR or closes session -> XRSession 'end' event
 ├── 1. Stop WebXR frame loop
 ├── 2. Restore standard 2D canvas view / fallback screen
 ├── 3. Flush any pending persistence writes via persistenceService.flush()
 ├── 4. Dispose WebGL/WebXR resources cleanly
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
    /** Pre-instantiated store instance (optional, created by default if omitted) */
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

    /** Initialize DOM components, store subscriptions, and file pickers */
    public async init(): Promise<void>;

    /** Requests and launches the WebXR immersive-ar session */
    public async startArSession(): Promise<void>;

    /** Gracefully ends the WebXR session and returns to standard view */
    public async stopArSession(): Promise<void>;

    /** Opens a KML/KMZ container file */
    public async openFile(file?: File): Promise<void>;

    /** Flushes pending changes and disposes all WebGL, DOM, and WebXR resources */
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
  5. Clamp $\vec{p}_{new}$ within safety bounds (e.g., maximum 50m distance from viewer).
- **Complexity:** $O(1)$ constant time matrix multiplications and vector dot products per frame.
- **Failure Cases:** Ray parallel to drag plane ($\vec{r}_{dir} \cdot \vec{n} \approx 0$). Handled by ignoring touch move updates when dot product magnitude $< 10^{-4}$.

### 2. AltitudeMode Resolution Algorithm in AR
- **Purpose:** Resolve the 3D local Y-coordinate for features based on KML `altitudeMode` (`clampToGround`, `relativeToGround`, `absolute`).
- **Policy Definition:**
  - `clampToGround`: Feature sits directly on the AR ground plane ($Y_{world} = Y_{ground\_plane}$). $Y_{ground\_plane}$ is established by WebXR `local-floor` reference space (or viewer's initial floor hit test, default $Y = 0$).
  - `relativeToGround`: Feature Y-coordinate is offset from the ground plane: $Y_{world} = Y_{ground\_plane} + \text{alt}_{kml}$.
  - `absolute`: Feature Y-coordinate is calculated relative to sea-level altitude via `IGeoBridge.geoToWorld()`: $Y_{world} = \text{alt}_{kml} - \text{alt}_{anchor}$.
- **Steps:**
  ```typescript
  function resolveArWorldY(
      geoAlt: number,
      mode: AltitudeMode,
      anchorAlt: number,
      groundY: number
  ): number {
      switch (mode) {
          case 'clampToGround':
              return groundY;
          case 'relativeToGround':
              return groundY + geoAlt;
          case 'absolute':
              return geoAlt - anchorAlt;
      }
  }
  ```
- **Numerical Precision:** Floating point heights in meters maintain sub-millimeter precision using standard IEEE 754 double precision floating point arithmetic prior to conversion into 32-bit Float32Array Three.js matrices.

### 3. GPS + SLAM Pose Fusion & Origin Alignment Algorithm
- **Purpose:** Synchronize real-world outdoor GPS positions with local WebXR SLAM tracking space without sudden visual jumps.
- **Steps:**
  1. Receive high-frequency WebXR camera poses $(x_{slam}, y_{slam}, z_{slam})$ at 60Hz.
  2. Receive low-frequency GPS positions $(\text{lat}, \text{lon}, \text{alt})$ at 1Hz with accuracy radius $R_{acc}$.
  3. If GPS accuracy $R_{acc} > 15\text{m}$, ignore update to prevent anchor jumps.
  4. If GPS accuracy $R_{acc} \le 15\text{m}$, calculate target anchor offset between SLAM space origin and GPS coordinates.
  5. Apply low-pass exponential smoothing filter to smooth anchor origin transitions over a 2-second window:
     $$\mathbf{A}_{smooth}(t) = (1 - \alpha) \cdot \mathbf{A}_{smooth}(t - \Delta t) + \alpha \cdot \mathbf{A}_{target}$$
     where $\alpha = \min(1.0, \Delta t / 2.0)$.
- **Complexity:** $O(1)$ space and time complexity per frame.

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
```

- **Strict Recovery Rule:** Never allow an error to crash the WebXR frame loop or corrupt the underlying `IKmlDocument`. Any failing model or asset falls back gracefully to a colored bounding box placeholder mesh so that feature selection, translation, and lossless KML round-trip editing remain 100% functional.

---

## Performance Strategy

- **Target Frame Rate:** 60fps / 90fps uninterrupted WebXR animation loop.
- **Garbage Collection Optimization:** Pre-allocate all temporary raycasting vectors, matrices, quaternions, and color objects outside the animation frame callback to achieve zero per-frame heap allocations during WebXR rendering:
  ```typescript
  // Module-scoped reusable temp objects
  const TEMP_VEC3_A = new THREE.Vector3();
  const TEMP_VEC3_B = new THREE.Vector3();
  const TEMP_MAT4 = new THREE.Matrix4();
  const TEMP_RAYCASTER = new THREE.Raycaster();
  ```
- **Frustum Culling & Visibility Radius:** Features located further than 500 meters from the active AR anchor have their `THREE.Object3D.visible` property set to `false`, avoiding unnecessary draw calls and GPU matrix calculations.
- **Incremental Serialization:** Document serialization to XML string occurs only upon debounced save flushing, never during active touch drag interactions.
- **Asset Texture Reuse:** `IAssetProvider` caches Blob URLs in a Map; duplicate model/icon texture references reuse already loaded GPU textures.

---

## Testing Strategy

### 1. Unit Tests (`tests/ar-scene.unit.test.ts`)
- **WebXR Gesture Math:** Verify unprojection of screen NDC coordinates to 3D drag planes returns expected world points.
- **Altitude Policy:** Test `resolveArWorldY` produces correct Y-coordinates for `clampToGround`, `relativeToGround`, and `absolute` modes.
- **Anchor Synchronization:** Verify smooth low-pass filtering updates anchor matrix without precision loss.
- **HUD Event Stop Propagation:** Assert HUD button clicks do not propagate to WebXR 3D canvas touch listeners.

### 2. Integration Tests (`tests/ar-scene.integration.test.ts`)
- **Store & Command Wiring:** Verify that an AR touch gesture sequence (`touchstart` $\rightarrow$ `touchmove` $\rightarrow$ `touchend`) dispatches a valid `ICommand` into `IEditorStore` and mutates `IKmlDocument`.
- **Feature Registry Reconciliation:** Assert that adding or removing a feature in `IKmlDocument` updates the `ArSceneManager` Three.js scene graph.

### 3. Phone-Free Replay E2E Tests (`tests/ar-replay-e2e.test.ts`)
- **Deterministic Dataset Execution:** Load real Task 1 recorded dataset ZIP (`2026-06-24_13-58-24utc.zip`) using `ArReplayAdapter`.
- **Full Edit & Lossless Round-Trip Verification:**
  1. Load real Google Earth KMZ fixture containing placemarks, lines, ground overlays, and 3D COLLADA models.
  2. Replay sensor poses deterministically through `ArReplayAdapter`.
  3. Programmatically execute a marker move command and a model orientation command during replay.
  4. Save modified container to ArrayBuffer via `IPersistenceService`.
  5. Re-read output container and assert that:
     - Target marker `<coordinates>` and model `<Orientation>` reflect exact edited values.
     - Every untouched XML node, attribute, comment, and asset byte in the `.kmz` remains **100% byte-identical** to original input.

---

## Demo

- **Demo Path:** `demos/ar-scene-demo/index.html` (runnable via `pnpm run dev:ar-scene` or `vite --open /demos/ar-scene-demo/`).
- **Interactive Capabilities:**
  - On desktop: Uses `ArReplayAdapter` to play back recorded outdoor sensor trajectories in a simulated WebXR viewport. User can click features, drag handles, edit names in HUD, and trigger undo/redo.
  - On WebXR mobile device (Android Chrome over HTTPS): Launches native `immersive-ar` session. Features anchor to real world GPS positions. User moves markers/models via touch drag, edits properties, and watches debounced save status in HUD.
  - Export button: Allows downloading the edited `.kmz` file directly to test reopening in Google Earth.

---

## Dependencies

- `three` (`^0.184.0`): Standard 3D web rendering engine used across feature renderers and WebXR scene management.
- `gps-plus-slam-app-framework`: Monorepo workspace framework package providing WebXR session management, GPS/IMU pose fusion, sensor dataset storage, and replay utilities.
- `@reduxjs/toolkit` (`^2.11.2`): Shared state management store powering `IEditorStore`.

---

## Risks

| Severity | Risk | Detection Method | Mitigation Plan | Fallback Plan |
| :--- | :--- | :--- | :--- | :--- |
| **High** | Mobile Chrome File System Access API restriction prevents direct file handle write back | Check `persistenceService.hasNativeFileAccess` on session start | Utilize OPFS working copy with auto-save; prompt download on exit | Export/download button in AR HUD |
| **High** | GPS drift outdoor causes AR features to shift relative to visual SLAM environment | Monitor GPS Dilution of Precision (DOP) & accuracy radius | Apply low-pass anchor smoothing filter; restrict anchor updates when accuracy > 15m | Allow user to manually tap "Re-anchor Here" in HUD |
| **Medium**| Touch gesture ambiguity on mobile WebXR canvas (pan vs orbit vs object drag) | Interaction threshold unit tests | Require object selection tap before enabling 3D edit drag handles | Dedicated touch drag handle visual gizmo |
| **Medium**| Large COLLADA (.dae) model memory consumption causing WebXR crash | Monitor WebGL context loss events | Lazy load model geometries; apply frustum distance culling | Fall back to colored bounding box mesh |

---

## Milestones

### Milestone 1: WebXR Session Setup & Replay Harness Integration
- Implement `ArSessionManager`, `ArSceneManager`, and `ArReplayAdapter`.
- Achieve deterministic sensor pose playback using Task 1 recorded dataset.
- **Deliverable:** Working phone-free desktop replay demo displaying camera trajectory and static scene features.

### Milestone 2: Geo-Anchor Coordination & Feature Reconciliation
- Implement `ArAnchorCoordinator` and integrate `FeatureSceneRegistry`.
- Resolve `clampToGround`, `relativeToGround`, and `absolute` altitude policies in WebXR space.
- **Deliverable:** Real-world GPS coordinates successfully anchored into WebXR Three.js scene.

### Milestone 3: AR Touch Interactions & Command Layer Wiring
- Implement `ArInteractionController` for touch picking, 3D drag planes, and vertex handle manipulation.
- Connect touch gestures to `IEditorStore.executeCommand()`.
- **Deliverable:** Full spatial editing (move marker, drag line vertex, rotate model/overlay) functioning in WebXR and replay mode.

### Milestone 4: AR HUD, Persistence & End-to-End Acceptance Validation
- Implement `ArHud` DOM overlay (status, tracking, undo/redo, name editing).
- Run full phone-free replay e2e tests asserting byte-faithful lossless KMZ round-trip.
- **Deliverable:** Complete standalone demo (`demos/ar-scene-demo/`) verified on mobile WebXR hardware and successfully validated in Google Earth.
