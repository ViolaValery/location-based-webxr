import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IFeatureView } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { IAssetProvider } from '../contracts/kmz-container';
import { IRendererFactory } from '../contracts/renderer';
import { FeatureId } from '../contracts/type';
import { FeatureSceneRegistry } from '../editor/feature-scene-registry';

const VRAM_BUDGET_BYTES = 256 * 1024 * 1024; // 256MB

export class ArSceneManager {
    public readonly scene: THREE.Scene;
    public readonly camera: THREE.PerspectiveCamera;
    public readonly featureGroup: THREE.Group;
    public readonly overlayGroup: THREE.Group;
    public readonly reticle: THREE.Mesh;
    public controls: OrbitControls | null = null;

    private readonly registry: FeatureSceneRegistry;
    private renderer: THREE.WebGLRenderer | null = null;
    private currentVramUsage = 0;

    public constructor(rendererFactory: IRendererFactory<THREE.Object3D>) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        this.camera.position.set(0, 15, 30);
        this.camera.lookAt(0, 0, 0);

        // Lighting tuned for outdoor AR
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(5, 20, 7);

        const grid = new THREE.GridHelper(200, 100, 0x3b82f6, 0x1e293b);
        grid.position.y = -0.01;

        this.scene.add(ambientLight, directionalLight, grid);

        // Feature and overlay group hierarchy
        this.featureGroup = new THREE.Group();
        this.featureGroup.name = 'ar-feature-group';

        this.overlayGroup = new THREE.Group();
        this.overlayGroup.name = 'ar-overlay-group';

        this.scene.add(this.featureGroup, this.overlayGroup);

        // WebXR Reticle helper
        const reticleGeo = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
        const reticleMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide });
        this.reticle = new THREE.Mesh(reticleGeo, reticleMat);
        this.reticle.visible = false;
        this.scene.add(this.reticle);

        this.registry = new FeatureSceneRegistry(this.featureGroup, rendererFactory);
    }

    public attachRenderer(renderer: THREE.WebGLRenderer): void {
        this.renderer = renderer;
        renderer.xr.enabled = true;
        this.controls = new OrbitControls(this.camera, renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    public updateControls(): void {
        if (this.controls && (!this.renderer || !this.renderer.xr.isPresenting)) {
            this.controls.update();
        }
    }

    public async reconcileFeatures(
        features: readonly IFeatureView[],
        assets: IAssetProvider,
        bridge: IGeoBridge
    ): Promise<void> {
        await this.registry.reconcile(features, assets, bridge);
        this.updateVramUsage();
    }

    public getObjectForFeature(featureId: FeatureId): THREE.Object3D | null {
        return this.registry.getObject(featureId);
    }

    public findFeatureIdFromObject(object: THREE.Object3D): FeatureId | null {
        return this.registry.findFeatureId(object);
    }

    public getPickableObjects(): THREE.Object3D[] {
        return this.featureGroup.children;
    }

    public setReticlePosition(position: THREE.Vector3, visible = true): void {
        this.reticle.position.copy(position);
        this.reticle.visible = visible;
    }

    public render(renderer: THREE.WebGLRenderer): void {
        this.updateControls();
        renderer.render(this.scene, this.camera);
    }

    public dispose(): void {
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
        this.registry.dispose();
        this.reticle.geometry.dispose();
        (this.reticle.material as THREE.Material).dispose();
        this.scene.clear();
    }

    private updateVramUsage(): void {
        if (!this.renderer) return;
        const info = this.renderer.info;
        const textureMemory = info.memory.textures * 2 * 1024 * 1024;
        this.currentVramUsage = textureMemory;

        if (this.currentVramUsage > VRAM_BUDGET_BYTES) {
            console.warn(`[ArSceneManager] VRAM usage (${Math.round(this.currentVramUsage / 1024 / 1024)}MB) exceeds budget (${VRAM_BUDGET_BYTES / 1024 / 1024}MB). Culling distant features.`);
            this.cullDistantFeatures(100);
        }
    }

    private cullDistantFeatures(maxDistanceMeters: number): void {
        const cameraPos = this.camera.position;
        for (const child of this.featureGroup.children) {
            const dist = child.position.distanceTo(cameraPos);
            child.visible = dist <= maxDistanceMeters;
        }
    }
}
