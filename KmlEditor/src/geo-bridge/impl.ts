import { AnchorNotSetError, InvalidGeoPositionError, InvalidWorldPositionError } from './errors';
import { formatCoordinate } from './format';
import {
    geoToLocalOffset,
    localOffsetToGeo,
    inverseRotateHorizontal,
    rotateHorizontal,
    validateGeoPosition,
    validateWorldPosition,
} from './math';
import { AltitudeMode, GeoPosition, WorldPosition } from '../contracts/type';
import { GeoAnchor, IGeoBridge } from '../contracts/geo-bridge';
import { geoAltitudeToWorldY, worldYToGeoAltitude } from './altitude-policy';

export class GeoBridgeImpl implements IGeoBridge {
    private anchor: GeoAnchor | null = null;

    public setAnchor(anchor: GeoAnchor): void {
        try {
            validateGeoPosition(anchor.position);
        } catch (error) {
            throw new InvalidGeoPositionError(error instanceof Error ? error.message : 'Invalid geo position');
        }

        if (!Number.isFinite(anchor.heading)) {
            throw new InvalidGeoPositionError('Anchor heading must be finite');
        }

        this.anchor = anchor;
    }

    public geoToWorld(position: GeoPosition, altitudeMode: AltitudeMode = 'clampToGround'): WorldPosition {
        const anchor = this.requireAnchor();

        try {
            validateGeoPosition(position);
        } catch (error) {
            throw new InvalidGeoPositionError(error instanceof Error ? error.message : 'Invalid geo position');
        }

        const { east, north } = geoToLocalOffset(anchor.position, position);
        const rotated = rotateHorizontal(east, north, -anchor.heading * Math.PI / 180);

        return {
            x: rotated.x,
            y: geoAltitudeToWorldY(position, anchor.position.alt, altitudeMode),
            z: rotated.z,
        };
    }

    public worldToGeo(position: WorldPosition, altitudeMode: AltitudeMode = 'clampToGround'): GeoPosition {
        const anchor = this.requireAnchor();

        try {
            validateWorldPosition(position);
        } catch (error) {
            throw new InvalidWorldPositionError(error instanceof Error ? error.message : 'Invalid world position');
        }

        const unrotated = inverseRotateHorizontal(position.x, position.z, anchor.heading * Math.PI / 180);
        const geo = localOffsetToGeo(anchor.position, unrotated.east, unrotated.north);

        return {
            lon: geo.lon,
            lat: geo.lat,
            alt: worldYToGeoAltitude(position, anchor.position.alt, altitudeMode),
        };
    }

    public formatCoordinate(value: number, originalString?: string): string {
        return formatCoordinate(value, originalString);
    }

    private requireAnchor(): GeoAnchor {
        if (!this.anchor) {
            throw new AnchorNotSetError();
        }

        return this.anchor;
    }
}