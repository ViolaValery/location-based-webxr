# KML Desktop Editor Component Implementation Plan

## Overview

The `editor` component is the **Non-AR desktop editor** (Goal-2 composition). It integrates all preceding components (`kmz-io`, `kml-model`, `geo-bridge`, `renderers`, `commands`, `persistence`, and `store`) into a phone-free, browser-based 3D workspace. It renders the features inside a Three.js scene, enables mouse selection and gizmo-driven spatial editing, tracks history, and manages autosave persistence.

### Boundaries & Constraints
*   **What it owns:**
    *   The Three.js viewport lifecycle (WebGLRenderer, Scene, perspective Camera, Lighting, OrbitControls).
    *   The rendering synchronization loop (listening to store state changes and updating meshes).
    *   Raycasting and pointer collision detection for selection.
    *   Transform controls and gizmos for translating, rotating, and scaling features.
    *   The replay execution player (animating mock GPS logs for simulation).
*   **What it never owns:**
    *   Direct XML structure manipulation (delegated to `kml-model`).
    *   Geographic-to-meters projection math (delegated to `geo-bridge`).
    *   File handle writing (delegated to `persistence`).
    *   WebXR or camera-pose matrix tracking (delegated to `ar-scene`).
*   **Contracts Consumed:**
    *   `IEditorStore` (from `contracts/store.ts`)
    *   `IFeatureRenderer` (from `contracts/renderer.ts`)
    *   `IGeoBridge` (from `contracts/geo-bridge.ts`)
    *   `IPersistenceService` (from `contracts/persistence.ts`)
    *   `ICommand` (from `contracts/commands.ts`)

---

## Internal Architecture

The component is divided into decoupled helper modules coordinate by a central controller to keep Three.js view states isolated from interaction algorithms.

```
       +-------------------------------------------------------+
       |               DesktopEditorController                 |
       +-------+------------------+------------------+---------+
               |                  |                  |
               v                  v                  v
       [ SceneManager ]   [ InteractionManager ]  [ ReplayPlayer ]
               |                  |
               +--------+---------+
                        |
                        v
               [ Three.js Scene ]
```

### 1. DesktopEditorController
*   **Responsibility:** Main controller orchestrating the component. Mounts the viewport on a DOM node, initiates the render loop, binds to the store, and coordinates window resizing and teardowns.
*   **Inputs:** DOM Container Element, `IEditorStore` instance, optional `IPersistenceService` instance.
*   **Outputs:** Canvas rendering frame, window resizing events.
*   **Dependencies:** `three`, `store`.

### 2. SceneManager
*   **Responsibility:** Monitors the `IEditorStore` state changes. Dynamically instantiates new feature renderers using `RendererFactory`, removes deleted meshes, and invokes `.update()` on modified objects.
*   **Inputs:** `EditorState` from store subscriptions.
*   **Outputs:** Three.js scene hierarchy modifications.
*   **Dependencies:** `three`, `renderers`, `store`.
*   **Invariants:** Keeps a stable 1:1 map of `FeatureId -> IFeatureRenderer` references. Disposes of WebGL memory (geometries, materials) immediately when features are removed.

### 3. InteractionManager
*   **Responsibility:** Manages raycasting collision checks, mouse hover indicators, and integrates transform gizmos for spatial transformations (moving point markers, dragging line vertices, rotating ground overlays, scaling models).
*   **Inputs:** Pointer events (move, down, up), active selection state.
*   **Outputs:** Dispatches edit commands to the store when drags are committed.
*   **Dependencies:** `three`, `three/addons/controls/TransformControls.js`, `store`, `commands`.

### 4. ReplayPlayer
*   **Responsibility:** Parses outdoor walk recordings containing device GPS tracks and pose orientation logs, animating a representation of the user camera through the 3D scene.
*   **Inputs:** Walk JSON recording payload, execution playback controls (play, pause, speed).
*   **Outputs:** Updates virtual camera positions relative to the geo-bridge anchor.
*   **Dependencies:** `geo-bridge`.

---

## Runtime Data Flow

### 1. Initialization and Rendering Flow
1.  App mounts `DesktopEditorController(container, store, persistence)`.
2.  Controller sets up three.js WebGL context, camera, lighting, OrbitControls, and starts the render loop.
3.  Controller subscribes to `store.subscribe()`.
4.  When store dispatches state updates:
    *   `SceneManager` compares the list of features against its cached meshes map.
    *   For any new feature, it creates a renderer using the factory and adds it to the scene.
    *   For any removed feature, it calls `renderer.dispose()` and removes it.
    *   For existing features, it calls `renderer.update(feature, assetProvider)`.

### 2. Mouse Selection & Gizmo Editing Flow
```
[User: pointerdown on Marker]
             |
             v
[Raycaster: intersects Mesh] ---> [Store: selectFeature(id)]
                                              |
                                              v
[State Update] ---> [InteractionManager: Attach TransformControls]
                                              |
[User: Drags Gizmo along plane]               v
[User: pointerup / releases drag]
             |
             v
[Read World Position THREE.Vector3]
             |
             v
[GeoBridge: worldToGeo(vector3)] ---> [GeoPosition calculated]
                                              |
                                              v
[Create Command: MoveMarkerCommand(id, geoPos)]
             |
             v
[Store: executeCommand(command)]
             |
             v
[Store dispatches MUTATE_DOCUMENT] ---> [Autosave debounced flush]
```

---

## Public Surface

```typescript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { IEditorStore } from '../contracts/store';
import { IPersistenceService } from '../contracts/persistence';

export interface DesktopEditorOptions {
    container: HTMLElement;
    store: IEditorStore;
    persistence?: IPersistenceService;
}

export class DesktopEditorController {
    public readonly scene: THREE.Scene;
    public readonly camera: THREE.PerspectiveCamera;
    public readonly renderer: THREE.WebGLRenderer;
    public readonly controls: OrbitControls;
    
    private readonly sceneManager: SceneManager;
    private readonly interactionManager: InteractionManager;
    private readonly replayPlayer: ReplayPlayer;
    private _animationFrameId: number | null = null;

    constructor(options: DesktopEditorOptions);
    public mount(): void;
    public destroy(): void;
    public start(): void;
    public stop(): void;
    public loadReplay(logJson: string): void;
}

class SceneManager {
    constructor(scene: THREE.Scene);
    public sync(featuresList: any[], assetProvider: any): void;
    public updateSelectionHighlight(selectedId: string | null): void;
    public dispose(): void;
}

class InteractionManager {
    public readonly transformControls: TransformControls;
    constructor(controller: DesktopEditorController, store: IEditorStore);
    public handlePointerDown(e: PointerEvent): void;
    public dispose(): void;
}

class ReplayPlayer {
    constructor(geoBridge: any, camera: THREE.Camera);
    public load(log: Array<{ lat: number; lon: number; alt: number; heading: number; time: number }>): void;
    public tick(deltaTime: number): void;
}
```

---

## Algorithms

### 1. Pointer Drag to Coordinate Conversion
When the user translates a marker/model/overlay along the horizontal ground plane:
1.  Define a virtual plane at $y = \text{height of the feature in world coordinates}$:
    $$\mathbf{n} = (0, 1, 0), \quad d = -h$$
2.  Cast a ray from the camera through the mouse pointer.
3.  Calculate the intersection point $\mathbf{P} = (x, y, z)$ on the virtual plane:
    $$\mathbf{P} = \mathbf{O} + t\mathbf{D}$$
4.  Pass the world coordinate $\mathbf{P}$ to the geo-bridge:
    $$\mathbf{G} = \text{geoBridge.worldToGeo}(\mathbf{P})$$
5.  Maintain stable precision: Round latitude/longitude values to 6 decimal places to prevent decimal jitter during updates:
    $$\text{lon}_{\text{rounded}} = \text{Math.round}(G.\text{lon} \times 10^6) / 10^6$$

### 2. Vertex-Handle Collision Indexing
For line features containing multiple points:
1.  When a Line is selected, individual sphere meshes representing vertices are rendered in a single `InstancedMesh` draw call.
2.  On raycast hit, extract the instance index `instanceId` from the intersection result.
3.  Store the active vertex index: `activeVertexIndex = instanceId`.
4.  As the user drags, translate the sphere coordinate, convert the intersection point to geo coordinates, update the line's coordinates array at `activeVertexIndex`, and commit the `MoveLineVertexCommand`.

---

## State Management

*   **Three.js Visual Meshes:** Owned by the WebGL viewport lifecycle. Created, synchronized, and removed purely in response to `EditorState` updates.
*   **Workspace state (selected id, active document):** Managed exclusively inside the `store` component. The editor controller subscribes to changes and never caches state values locally.
*   **OrbitControls Status:** Temporarily disabled when `TransformControls` is active (dragging a gizmo) to prevent viewport rotation conflict.

---

## Error Strategy

1.  **WebGL Context Loss:**
    *   *Symptom:* Browser drops WebGL context.
    *   *Recovery:* Listen to `webglcontextlost`. Pause the animation loop, destroy the old renderer, and prompt the user to restore the session by rebuilding the renderer on `webglcontextrestored`.
2.  **Invalid COLLADA Model Loading:**
    *   *Symptom:* `ColladaLoader` crashes or fails to fetch referenced assets.
    *   *Recovery:* Catch loading errors in `ModelRenderer`. Immediately spawn a transparent yellow placeholder box with dimensions $1\text{m} \times 1\text{m} \times 1\text{m}$ at the correct transform origin so the feature is still visible, selectable, and editable.

---

## Performance Strategy

*   **Render Loop Throttling:** If no animations are active and the user is not interacting (dragging or orbiting), freeze the requestAnimationFrame loop to conserve CPU/GPU usage. Wake up the loop on pointer movements or store updates.
*   **Raycast Filtering:** Apply raycasting intersections *only* to a specialized "interactive" group layer containing feature meshes, ignoring background elements, skyboxes, and grid lines.

---

## Testing Strategy

### 1. Headless Integration Test
*   Verify that loading a KML fixture instantiates the correct count of visual meshes.
*   Verify that selecting a feature updates the store's selection ID.

### 2. End-to-End Deterministic Replay Test
*   **The acceptance gate:**
    1.  Initialize the editor store, loading a real Google Earth KMZ fixture.
    2.  Instantiate `DesktopEditorController`.
    3.  Programmatically select a marker and translate it by 15 meters:
        ```typescript
        const cmd = createMoveMarkerCommand('marker-1', newGeoPos);
        store.executeCommand(cmd);
        ```
    4.  Verify that the corresponding KML node has updated its `<coordinates>` tag.
    5.  Trigger saving via the persistence layer.
    6.  Re-load the saved file from disk and assert that the coordinates match the new position, while every other node remains byte-identical.

---

## Demo

The standalone demo will reside in `demos/editor-demo/index.html`.

### Interactive Sandbox Interface:
1.  **WebGL Viewport:** Renders the 3D scene containing loaded features with full OrbitControls.
2.  **Transform Gizmo:** Dragging markers, lines, or overlays updates the 3D position.
3.  **GPS Replay Controller:** A media control bar (Play/Pause/Speed) that plays back a walk recording, showing a moving camera icon traversing the scene.
4.  **Autosave Indicator:** Displays "Saved" or "Saving..." as edits are made.

---

## Dependencies

*   **Three.js (`three`):** Viewport render engine.
*   **OrbitControls & TransformControls:** Viewport navigation and mesh translation.

---

## Risks

| Risk | Severity | Detection | Mitigation |
| :--- | :--- | :--- | :--- |
| **Viewport Coordinate Drift** | **High** | Math conversions do not round-trip within millimeter tolerances. | Add unit tests verifying `worldToGeo(geoToWorld(coord))` consistency. |
| **Orbit vs. Transform Conflict** | **Medium** | OrbitControls rotates the screen while dragging a gizmo. | Enforce that OrbitControls are disabled immediately when the transform controller is grabbed. |

---

## Milestones

*   **Milestone 1: Viewport Setup & OrbitControls**
    *   Construct Three.js scene, camera, lighting, and mount container lifecycle.
*   **Milestone 2: Scene Synchronization**
    *   Implement `SceneManager` syncing mesh states from store subscription events.
*   **Milestone 3: Raycasting & Transform Controls**
    *   Wire pointer events, hit detection, transform gizmos, and command dispatches.
*   **Milestone 4: Replay Player & E2E Verification**
    *   Implement GPS track playback player and run deterministic Vitest integration tests.
