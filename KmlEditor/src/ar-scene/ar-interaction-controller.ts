import * as THREE from 'three';
import {
    createMoveMarkerCommand,
    createMoveModelCommand,
    createMoveOverlayCommand,
} from '../commands';
import { IKmlDocument, IMarkerFeature, IModelFeature, IGroundOverlayFeature } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { IEditorStore } from '../contracts/store';
import { FeatureId, WorldPosition } from '../contracts/type';
import { ArAnchorCoordinator } from './ar-anchor-coordinator';
import { ArSceneManager } from './ar-scene-manager';

const TEMP_VEC3_A = new THREE.Vector3();
const TEMP_VEC3_B = new THREE.Vector3();
const TEMP_RAYCASTER = new THREE.Raycaster();

export class ArInteractionController {
    private activeDragFeatureId: FeatureId | null = null;
    private dragPlane: THREE.Plane | null = null;
    private initialFeatureWorldPos: THREE.Vector3 | null = null;
    private initialTouchNdc = new THREE.Vector2();

    public constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly sceneManager: ArSceneManager,
        private readonly geoBridge: IGeoBridge,
        private readonly store: IEditorStore,
        private readonly anchorCoordinator: ArAnchorCoordinator,
        private readonly getDocument: () => IKmlDocument | null
    ) {
        this.canvas.style.touchAction = 'none';
        this.attachEventListeners();
    }

    public dispose(): void {
        this.detachEventListeners();
    }

    private attachEventListeners(): void {
        this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
        this.canvas.addEventListener('pointerdown', this.onPointerDown);
        this.canvas.addEventListener('pointermove', this.onPointerMove);
        this.canvas.addEventListener('pointerup', this.onPointerUp);
    }

    private detachEventListeners(): void {
        this.canvas.removeEventListener('touchstart', this.onTouchStart);
        this.canvas.removeEventListener('touchmove', this.onTouchMove);
        this.canvas.removeEventListener('touchend', this.onTouchEnd);
        this.canvas.removeEventListener('pointerdown', this.onPointerDown);
        this.canvas.removeEventListener('pointermove', this.onPointerMove);
        this.canvas.removeEventListener('pointerup', this.onPointerUp);
    }

    private onTouchStart = (event: TouchEvent): void => {
        if (event.touches.length !== 1) return;
        event.preventDefault();
        const touch = event.touches[0];
        this.handlePointerStart(touch.clientX, touch.clientY);
    };

    private onTouchMove = (event: TouchEvent): void => {
        if (event.touches.length !== 1 || !this.activeDragFeatureId) return;
        event.preventDefault();
        const touch = event.touches[0];
        this.handlePointerMove(touch.clientX, touch.clientY);
    };

    private onTouchEnd = (event: TouchEvent): void => {
        event.preventDefault();
        this.handlePointerEnd();
    };

    private onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === 'touch') return; // Handled by TouchEvent
        this.handlePointerStart(event.clientX, event.clientY);
    };

    private onPointerMove = (event: PointerEvent): void => {
        if (event.pointerType === 'touch' || !this.activeDragFeatureId) return;
        this.handlePointerMove(event.clientX, event.clientY);
    };

    private onPointerUp = (event: PointerEvent): void => {
        if (event.pointerType === 'touch') return;
        this.handlePointerEnd();
    };

    private handlePointerStart(clientX: number, clientY: number): void {
        const ndc = this.getNdc(clientX, clientY);
        this.initialTouchNdc.copy(ndc);

        const camera = this.sceneManager.getActiveCamera();
        TEMP_RAYCASTER.setFromCamera(ndc, camera);
        const intersects = TEMP_RAYCASTER.intersectObjects(this.sceneManager.getPickableObjects(), true);

        if (intersects.length > 0) {
            const hit = intersects[0];
            const featureId = this.sceneManager.findFeatureIdFromObject(hit.object);
            if (featureId) {
                this.store.selectFeature(featureId);
                const nativeObject = this.sceneManager.getObjectForFeature(featureId);
                if (nativeObject) {
                    this.activeDragFeatureId = featureId;
                    this.initialFeatureWorldPos = nativeObject.position.clone();

                    // Create camera-facing drag plane at hit object depth
                    const normal = TEMP_VEC3_A.copy(camera.position).sub(nativeObject.position).normalize();
                    this.dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, nativeObject.position);

                    // Disable orbit controls during active feature drag so camera does not move
                    if (this.sceneManager.controls) {
                        this.sceneManager.controls.enabled = false;
                    }

                    // Engage Anchor Lock during active 3D drag
                    this.anchorCoordinator.setAnchorLock(true);
                }
            }
        } else {
            this.store.selectFeature(null);
        }
    }

    private handlePointerMove(clientX: number, clientY: number): void {
        if (!this.activeDragFeatureId || !this.dragPlane || !this.initialFeatureWorldPos) return;

        const ndc = this.getNdc(clientX, clientY);
        const camera = this.sceneManager.getActiveCamera();
        TEMP_RAYCASTER.setFromCamera(ndc, camera);

        const targetPoint = TEMP_VEC3_B;
        if (TEMP_RAYCASTER.ray.intersectPlane(this.dragPlane, targetPoint)) {
            const nativeObject = this.sceneManager.getObjectForFeature(this.activeDragFeatureId);
            if (nativeObject) {
                nativeObject.position.copy(targetPoint);
            }
        }
    }

    private handlePointerEnd(): void {
        // Re-enable orbit controls after drag completes
        if (this.sceneManager.controls) {
            this.sceneManager.controls.enabled = true;
        }

        if (!this.activeDragFeatureId || !this.initialFeatureWorldPos) {
            this.activeDragFeatureId = null;
            this.dragPlane = null;
            this.initialFeatureWorldPos = null;
            this.anchorCoordinator.setAnchorLock(false);
            return;
        }

        const featureId = this.activeDragFeatureId;
        const nativeObject = this.sceneManager.getObjectForFeature(featureId);
        const doc = this.getDocument();

        if (nativeObject && doc) {
            const feature = doc.getFeatureById(featureId);
            if (feature) {
                const newWorldPos: WorldPosition = {
                    x: nativeObject.position.x,
                    y: nativeObject.position.y,
                    z: nativeObject.position.z,
                };
                const newGeoPos = this.geoBridge.worldToGeo(newWorldPos);

                if (feature.type === 'marker') {
                    const cmd = createMoveMarkerCommand(featureId, newWorldPos);
                    this.store.executeCommand(cmd);
                } else if (feature.type === 'model') {
                    const cmd = createMoveModelCommand(featureId, newGeoPos);
                    this.store.executeCommand(cmd);
                } else if (feature.type === 'ground-overlay') {
                    const overlay = feature as IGroundOverlayFeature;
                    const dLon = newGeoPos.lon - (overlay.latLonBox.east + overlay.latLonBox.west) / 2;
                    const dLat = newGeoPos.lat - (overlay.latLonBox.north + overlay.latLonBox.south) / 2;
                    const newLatLonBox = {
                        north: overlay.latLonBox.north + dLat,
                        south: overlay.latLonBox.south + dLat,
                        east: overlay.latLonBox.east + dLon,
                        west: overlay.latLonBox.west + dLon,
                        rotation: overlay.latLonBox.rotation,
                    };
                    const cmd = createMoveOverlayCommand(featureId, newLatLonBox, newGeoPos.alt, overlay.altitudeMode);
                    this.store.executeCommand(cmd);
                }
            }
        }

        this.activeDragFeatureId = null;
        this.dragPlane = null;
        this.initialFeatureWorldPos = null;
        this.anchorCoordinator.setAnchorLock(false);
    }

    private getNdc(clientX: number, clientY: number): THREE.Vector2 {
        const rect = this.canvas.getBoundingClientRect();
        return new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1
        );
    }
}
