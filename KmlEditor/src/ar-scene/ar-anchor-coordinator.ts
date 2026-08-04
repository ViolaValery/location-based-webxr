import { AltitudeMode, GeoPosition, WorldPosition } from '../contracts/type';
import { IGeoBridge } from '../contracts/geo-bridge';
import { IEditorStore } from '../contracts/store';

/**
 * ArAnchorCoordinator — fuses GPS + heading into the IGeoBridge anchor.
 *
 * Receives GPS and orientation events from the framework sensor callbacks
 * (onGpsPosition / onOrientation inside EnableGpsArController) and updates
 * IGeoBridge accordingly. Implements Anchor Lock during active 3D drags.
 *
 * CRITICAL STABILITY RULE:
 * IGeoBridge's anchor position is initialized by the document loader (store.loadContainer)
 * to the document's spatial center. updateGps() MUST NOT overwrite the anchor position
 * with raw, noisy phone GPS fixes on session start — doing so causes feature positions
 * in featureGroup to jump around by 5-15 meters every time AR is restarted.
 *
 * updateGps() only sets an initial anchor if geoBridge has NO anchor yet.
 * Orientation/heading is applied to the existing anchor once compass data arrives.
 */
export class ArAnchorCoordinator {
    private isLocked = false;
    private bufferedGps: { position: GeoPosition; heading: number; accuracy: number } | null = null;
    private groundY = 0; // Local WebXR floor level Y (Y=0 in local-floor reference space)

    /** True once a non-zero compass heading has been applied to the anchor. */
    private initialHeadingSet = false;

    public constructor(
        private readonly geoBridge: IGeoBridge,
        private readonly store: IEditorStore
    ) {}

    /**
     * Called by the framework GPS callback (onGpsPosition from EnableGpsArController).
     * Updates device state in the store. Sets geo anchor ONLY if no anchor exists yet.
     */
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
            // No anchor set yet — set initial anchor to this GPS position
            this.geoBridge.setAnchor({ position: newPosition, heading });
            if (heading !== 0) {
                this.initialHeadingSet = true;
            }
        } else if (!this.initialHeadingSet && heading !== 0) {
            // Anchor exists (e.g. set to document center), apply compass heading once
            this.initialHeadingSet = true;
            this.geoBridge.setAnchor({ position: currentAnchor.position, heading });
        }
    }

    /**
     * Called by the framework orientation callback (onOrientation from EnableGpsArController).
     * Applies compass heading to the existing anchor once.
     *
     * @param alpha - DeviceOrientationEvent.alpha (compass heading in degrees).
     */
    public updateHeading(alpha: number): void {
        if (alpha === null || alpha === 0) return;

        this.store.setDeviceState({ heading: alpha });

        if (this.initialHeadingSet) return;

        const currentAnchor = this.geoBridge.getAnchor();
        if (currentAnchor) {
            this.initialHeadingSet = true;
            this.geoBridge.setAnchor({ position: currentAnchor.position, heading: alpha });
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
     * Resolves the 3D local Y-coordinate for features based on KML altitudeMode.
     *
     * Policy (documented in plan.md):
     *   clampToGround    → Y = 0 (AR local-floor ground plane)
     *   relativeToGround → Y = kml.alt (meters above AR ground plane)
     *   absolute         → Y = kml.alt − anchor.alt (via geoBridge)
     */
    public applyAltitudePolicy(position: GeoPosition, mode: AltitudeMode = 'clampToGround'): WorldPosition {
        const worldPos = this.geoBridge.geoToWorld(position, mode);

        switch (mode) {
            case 'clampToGround':
                return { x: worldPos.x, y: this.groundY, z: worldPos.z };
            case 'relativeToGround':
                return { x: worldPos.x, y: this.groundY + position.alt, z: worldPos.z };
            case 'absolute': {
                const anchor = this.geoBridge.getAnchor();
                const anchorAlt = anchor ? anchor.position.alt : 0;
                return { x: worldPos.x, y: position.alt - anchorAlt, z: worldPos.z };
            }
            default:
                return worldPos;
        }
    }

    /**
     * Resets the geo anchor to a specific position and heading.
     * Used by ArReplayAdapter to inject synthetic sensor data.
     */
    public resetAnchor(position: GeoPosition, heading = 0): void {
        this.geoBridge.setAnchor({ position, heading });
        this.bufferedGps = null;
    }

    /**
     * Resets session flags so a newly started AR session can capture initial heading.
     */
    public resetSessionState(): void {
        this.initialHeadingSet = false;
        this.bufferedGps = null;
    }

    public dispose(): void {
        this.bufferedGps = null;
    }
}
