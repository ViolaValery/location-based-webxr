// Basistypen die von allen Komponenten geteilt werden

/** Opaque Feature-ID (intern generiert, stabil über die Session) */
type FeatureId = string & { readonly __brand: unique symbol };

/** Geographische Position (KML-Konvention: lon, lat, alt) */
interface GeoPosition {
    readonly lon: number;
    readonly lat: number;
    readonly alt: number;
}

/** Three.js-Weltkoordinaten */
interface WorldPosition {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** KML altitudeMode */
type AltitudeMode = 'clampToGround' | 'relativeToGround' | 'absolute';

/** KML LatLonBox (für GroundOverlays) */
interface LatLonBox {
    readonly north: number;
    readonly south: number;
    readonly east: number;
    readonly west: number;
    readonly rotation: number;
}

/** 3D-Model-Orientierung (KML Orientation) */
interface ModelOrientation {
    readonly heading: number;  // Grad, 0=Nord
    readonly tilt: number;     // Grad
    readonly roll: number;     // Grad
}

/** 3D-Model-Skalierung (KML Scale) */
interface ModelScale {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** Snapshot eines entfernten Features (für Undo/Redo) */
interface FeatureSnapshot {
    readonly id: FeatureId;
    readonly type: FeatureType;
    /** Serialisierter KML-Knoten zur Wiederherstellung */
    readonly kmlFragment: string;
    /** Position im Dokument (für exakte Wiederherstellung) */
    readonly insertionIndex: number;
}

/** Template für neue Features */
type FeatureTemplate =
    | { type: 'marker'; name: string; position: GeoPosition }
    | { type: 'line'; name: string; coordinates: GeoPosition[] }
    | { type: 'ground-overlay'; name: string; imageHref: string; latLonBox: LatLonBox }
    | { type: 'model'; name: string; modelHref: string; location: GeoPosition; orientation?: ModelOrientation; scale?: ModelScale };
