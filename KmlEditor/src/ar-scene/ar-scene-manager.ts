import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
    getArWorldGroup,
    getCamera,
    getScene,
    registerFrameUpdate,
} from 'gps-plus-slam-app-framework/ar';
import { IFeatureView } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { IAssetProvider } from '../contracts/kmz-container';
import { IRendererFactory } from '../contracts/renderer';
import { FeatureId } from '../contracts/type';
import { FeatureSceneRegistry } from '../editor/feature-scene-registry';

const LARGE_FEATURE_THRESHOLD = 500;
const CULL_DISTANCE_METERS = 500;

/**
 * KmlSceneHelper — owns only the KML-specific scene objects:
 * - FeatureSceneRegistry (KML features → THREE.Object3D)
 * - featureGroup (child of getArWorldGroup())
 * - GPS accuracy ring helper mesh
 * - Desktop OrbitControls (non-AR mode only)
 *
 * Does NOT own: Scene, Renderer, Camera, AnimationLoop.
 * Those are created by initAR() and retrieved via getArWorldGroup() / getCamera().
 */
export class ArSceneManager {
    /** The group that holds all KML feature objects. Added to arWorldGroup after initAR(). */
    public readonly featureGroup: THREE.Group;
    private readonly overlayGroup: THREE.Group;
    private readonly accuracyRing: THREE.Mesh;
    private readonly registry: FeatureSceneRegistry;

    /** OrbitControls for desktop/replay mode. Only active when no XR session is presenting. */
    public controls: OrbitControls | null = null;

    private unregisterFrameUpdate: (() => void) | null = null;
    private largeFileWarningShown = false;

    public constructor(private readonly rendererFactory: IRendererFactory<THREE.Object3D>) {
        this.featureGroup = new THREE.Group();
        this.featureGroup.name = 'kml-feature-group';

        this.overlayGroup = new THREE.Group();
        this.overlayGroup.name = 'kml-overlay-group';

        this.featureGroup.add(this.overlayGroup);

        // GPS accuracy ring helper
        const ringGeo = new THREE.RingGeometry(0.98, 1.0, 64).rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
        });
        this.accuracyRing = new THREE.Mesh(ringGeo, ringMat);
        this.accuracyRing.position.y = 0.01;
        this.accuracyRing.visible = false;
        this.overlayGroup.add(this.accuracyRing);

        this.registry = new FeatureSceneRegistry(this.featureGroup, rendererFactory);
    }

    /**
     * Attach featureGroup to the framework's arWorldGroup and start the per-frame tick.
     * Call this after initAR() succeeds.
     *
     * @param rendererDomElement - Canvas element for OrbitControls (desktop/replay mode).
     */
    public attachToFrameworkScene(rendererDomElement?: HTMLElement): void {
        const worldGroup = getArWorldGroup();
        if (worldGroup && this.featureGroup.parent !== worldGroup) {
            // Basis transformation: Three.js (+X=East, -Z=North) -> arWorldGroup NUE (+X=North, +Z=East)
            this.featureGroup.rotation.y = -Math.PI / 2;
            worldGroup.add(this.featureGroup);
        }

        // Register a per-frame tick for OrbitControls update (desktop mode) & dynamic distance culling.
        this.unregisterFrameUpdate = registerFrameUpdate((_dt: number, _elapsed: number) => {
            if (this.controls) {
                this.controls.update();
            }
            this.cullDistantFeatures();
        });

        // Create OrbitControls for desktop/replay preview.
        if (rendererDomElement) {
            const cam = getCamera();
            if (cam) {
                this.controls = new OrbitControls(cam, rendererDomElement);
                this.controls.enableDamping = true;
                this.controls.target.set(0, 0, 0);
                this.controls.update();
            }
        }
    }

    /**
     * Detach featureGroup from arWorldGroup and clean up the frame tick.
     * Call this after endARSession() completes.
     */
    public detachFromFrameworkScene(): void {
        this.featureGroup.rotation.set(0, 0, 0);
        this.featureGroup.removeFromParent();

        if (this.unregisterFrameUpdate) {
            this.unregisterFrameUpdate();
            this.unregisterFrameUpdate = null;
        }

        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
    }

    public updateAccuracyRing(accuracyRadiusMeters: number): void {
        if (accuracyRadiusMeters <= 0 || !Number.isFinite(accuracyRadiusMeters)) {
            this.accuracyRing.visible = false;
            return;
        }
        this.accuracyRing.scale.set(accuracyRadiusMeters, accuracyRadiusMeters, 1);
        this.accuracyRing.visible = true;
    }

    /**
     * Reconcile IKmlDocument features to THREE.Object3D.
     * Runs async so the framework AnimationLoop is never blocked.
     * Shows a one-time warning when feature count exceeds LARGE_FEATURE_THRESHOLD.
     *
     * @returns true if the large-file warning was newly triggered (so ArHud can display it).
     */
    public async reconcileFeatures(
        features: readonly IFeatureView[],
        assets: IAssetProvider,
        bridge: IGeoBridge
    ): Promise<{ largeFileWarning: boolean }> {
        const largeFileWarning =
            features.length > LARGE_FEATURE_THRESHOLD && !this.largeFileWarningShown;
        if (largeFileWarning) {
            this.largeFileWarningShown = true;
        }

        await this.registry.reconcile(features, assets, bridge);
        this.cullDistantFeatures();
        return { largeFileWarning };
    }

    public getObjectForFeature(featureId: FeatureId): THREE.Object3D | null {
        return this.registry.getObject(featureId);
    }

    public findFeatureIdFromObject(object: THREE.Object3D): FeatureId | null {
        return this.registry.findFeatureId(object);
    }

    public getPickableObjects(): THREE.Object3D[] {
        return this.featureGroup.children.filter((c: THREE.Object3D) => c !== this.overlayGroup);
    }

    public dispose(): void {
        this.detachFromFrameworkScene();
        this.registry.dispose();
        this.accuracyRing.geometry.dispose();
        (this.accuracyRing.material as THREE.Material).dispose();
        this.featureGroup.clear();
    }

    /**
     * Cull features beyond CULL_DISTANCE_METERS from the camera.
     * Uses world-space distance (THREE.Vector3.distanceTo) — no geo math.
     */
    private cullDistantFeatures(): void {
        const cam = getCamera();
        if (!cam) return;
        const camWorldPos = new THREE.Vector3();
        cam.getWorldPosition(camWorldPos);

        const featurePos = new THREE.Vector3();
        for (const child of this.featureGroup.children) {
            if (child === this.overlayGroup) continue;
            child.getWorldPosition(featurePos);
            child.visible = featurePos.distanceTo(camWorldPos) <= CULL_DISTANCE_METERS;
        }
    }
}
