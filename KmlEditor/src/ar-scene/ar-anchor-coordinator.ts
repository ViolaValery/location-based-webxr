import { AltitudeMode, GeoPosition, WorldPosition } from '../contracts/type';
import { IGeoBridge, GeoAnchor } from '../contracts/geo-bridge';
import { IEditorStore } from '../contracts/store';

export class ArAnchorCoordinator {
    private isLocked = false;
    private bufferedGps: { position: GeoPosition; heading: number; accuracy: number } | null = null;
    private groundY = 0; // Local WebXR floor level Y

    public constructor(
        private readonly geoBridge: IGeoBridge,
        private readonly store: IEditorStore
    ) {}

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
        } else {
            // Apply exponential low-pass filter to smooth anchor origin updates
            const alpha = 0.3;
            const smoothedPosition: GeoPosition = {
                lon: currentAnchor.position.lon + alpha * (newPosition.lon - currentAnchor.position.lon),
                lat: currentAnchor.position.lat + alpha * (newPosition.lat - currentAnchor.position.lat),
                alt: currentAnchor.position.alt + alpha * (newPosition.alt - currentAnchor.position.alt),
            };
            const smoothedHeading = currentAnchor.heading + alpha * (heading - currentAnchor.heading);

            this.geoBridge.setAnchor({ position: smoothedPosition, heading: smoothedHeading });
        }
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
