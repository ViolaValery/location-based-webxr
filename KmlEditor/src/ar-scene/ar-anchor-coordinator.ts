import { AltitudeMode, GeoPosition, WorldPosition } from '../contracts/type';
import { IGeoBridge, GeoAnchor } from '../contracts/geo-bridge';
import { IEditorStore } from '../contracts/store';
import { localOffsetToGeo, inverseRotateHorizontal } from '../geo-bridge/math';

export class ArAnchorCoordinator {
    private isLocked = false;
    private bufferedGps: { position: GeoPosition; heading: number; accuracy: number } | null = null;
    private groundY = 0; // Local WebXR floor level Y
    private viewerPose: XRViewerPose | null = null;

    public constructor(
        private readonly geoBridge: IGeoBridge,
        private readonly store: IEditorStore
    ) {}

    public updateViewerPose(pose: XRViewerPose): void {
        this.viewerPose = pose;
    }

    public updateGps(latitude: number, longitude: number, altitude: number, heading = 0, accuracy = 5): void {
        this.store.setDeviceState({
            gpsPosition: { latitude, longitude, altitude },
            heading,
            accuracy,
        });

        const newPosition: GeoPosition = { lon: longitude, lat: latitude, alt: altitude };

        if (this.isLocked || accuracy > 15) {
            this.bufferedGps = { position: newPosition, heading, accuracy };
            return;
        }

        const currentAnchor = this.geoBridge.getAnchor();
        if (!currentAnchor) {
            this.geoBridge.setAnchor({ position: newPosition, heading });
        } else if (currentAnchor.heading === 0 && heading !== 0) {
            this.geoBridge.setAnchor({ position: currentAnchor.position, heading });
        }
        // As per the specification: "convert geo→world once at the anchor step and work in THREE.Vector3s after that"
        // We do NOT continuously update the anchor based on GPS once it is set.
        // This ensures markers do not move arbitrarily with phone position.
    }

    public setAnchorLock(locked: boolean): void {
        this.isLocked = locked;
        if (!locked && this.bufferedGps && this.bufferedGps.accuracy <= 15) {
            const { position, heading } = this.bufferedGps;
            this.geoBridge.setAnchor({ position, heading });
            this.bufferedGps = null;
        }
    }

    public isAnchorLocked(): boolean {
        return this.isLocked;
    }

    public setGroundY(y: number): void {
        this.groundY = y;
    }

    public getGroundY(): number {
        return this.groundY;
    }

    /**
     * Resolves the 3D local Y-coordinate for features based on KML altitudeMode in AR space.
     */
    public applyAltitudePolicy(position: GeoPosition, mode: AltitudeMode = 'clampToGround'): WorldPosition {
        const worldPos = this.geoBridge.geoToWorld(position, mode);
        let resolvedY = worldPos.y;

        switch (mode) {
            case 'clampToGround':
                resolvedY = this.groundY;
                break;
            case 'relativeToGround':
                resolvedY = this.groundY + position.alt;
                break;
            case 'absolute':
                const anchor = this.geoBridge.getAnchor();
                const anchorAlt = anchor ? anchor.position.alt : 0;
                resolvedY = position.alt - anchorAlt;
                break;
        }

        return {
            x: worldPos.x,
            y: resolvedY,
            z: worldPos.z,
        };
    }

    public resetAnchor(position: GeoPosition, heading = 0): void {
        this.geoBridge.setAnchor({ position, heading });
        this.bufferedGps = null;
    }
}
