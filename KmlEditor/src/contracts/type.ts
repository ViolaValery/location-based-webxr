// Basistypen die von allen Komponenten geteilt werden

/** Opaque Feature-ID (intern generiert, stabil über die Session) */
export type FeatureId = string & { readonly __brand: unique symbol };

/** Geographische Position (KML-Konvention: lon, lat, alt) */
export interface GeoPosition {
    readonly lon: number;
    readonly lat: number;
    readonly alt: number;
}

/** Three.js-Weltkoordinaten */
export interface WorldPosition {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** KML altitudeMode */
export type AltitudeMode = 'clampToGround' | 'relativeToGround' | 'absolute';

/** KML LatLonBox (für GroundOverlays) */
export interface LatLonBox {
    readonly north: number;
    readonly south: number;
    readonly east: number;
    readonly west: number;
    readonly rotation: number;
}

/** 3D-Model-Orientierung (KML Orientation) */
export interface ModelOrientation {
    readonly heading: number;  // Grad, 0=Nord
    readonly tilt: number;     // Grad
    readonly roll: number;     // Grad
}

/** 3D-Model-Skalierung (KML Scale) */
export interface ModelScale {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** Snapshot eines entfernten Features (für Undo/Redo) */
export interface FeatureSnapshot {
    readonly id: FeatureId;
    readonly type: string; // Changed to string as FeatureType is not defined in this file
    /** Serialisierter KML-Knoten zur Wiederherstellung */
    readonly kmlFragment: string;
    /** Position im Dokument (für exakte Wiederherstellung) */
    readonly insertionIndex: number;
}

/** Template für neue Features */
export type FeatureTemplate =
    | { type: 'marker'; name: string; position: GeoPosition }
    | { type: 'line'; name: string; coordinates: GeoPosition[] }
    | { type: 'ground-overlay'; name: string; imageHref: string; latLonBox: LatLonBox }
    | { type: 'model'; name: string; modelHref: string; location: GeoPosition; orientation?: ModelOrientation; scale?: ModelScale };

/** Entry to be written to a ZIP archive (used by kmz-io) */
export interface ZipArchiveEntry {
    path: string;
    data: Uint8Array;
}

/** State of the Redux store */
import type { IPersistenceService } from "../contracts/persistence";
import type { IKmzContainer } from "../contracts/kmz-container";
import type { IKmlDocument } from "../contracts/document-model";
import type { IGeoBridge } from "../contracts/geo-bridge";
import type { ICommandStack } from "../contracts/commands";

export enum LoadingState {
  Idle = "idle",
  Loading = "loading",
  Loaded = "loaded",
  Error = "error",
}
export interface StoreState {
  container: IKmzContainer | null;
  document: IKmlDocument | null;
  geoBridge: IGeoBridge | null;
  commandStack: ICommandStack | null;
  selectedFeatureId: string | null;
  loadingState: LoadingState;
  loadError: Error | null;
  persistenceService: IPersistenceService | null;
}
