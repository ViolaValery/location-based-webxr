import { IEditorStore, EditorState, EditMode, DeviceState } from '../contracts/store';
import { IKmlDocument, IFeatureView } from '../contracts/document-model';
import { IKmzContainer } from '../contracts/kmz-container';
import { ICommandStack, ICommand } from '../contracts/commands';
import { IGeoBridge } from '../contracts/geo-bridge';
import { FeatureId } from '../contracts/type';
import { createKmzContainer } from '../kmz-io';
import { createKmlDocument } from '../document-model';
import { createGeoBridge } from '../geo-bridge';
import { createCommandStack } from '../commands';
import { CommandStackDelegator } from './delegator';
import {
    createReduxStore,
    setDocumentFeatures,
    setSelectedFeatureId,
    setEditMode,
    setDocumentStatus,
    setDeviceState,
    setUndoRedoState,
} from './redux-store';

export class EditorStoreImpl implements IEditorStore {
    public readonly geoBridge: IGeoBridge;

    private readonly _reduxStore: ReturnType<typeof createReduxStore>;
    private readonly _commandsDelegator: CommandStackDelegator;
    private _activeStack: ICommandStack | null = null;
    private _activeLoadController: AbortController | null = null;
    private _kmlDocument: IKmlDocument | null = null;
    private _kmzContainer: IKmzContainer | null = null;

    constructor() {
        this.geoBridge = createGeoBridge();
        this._commandsDelegator = new CommandStackDelegator();
        this._reduxStore = createReduxStore();
    }

    /** Returns current serializable Redux store state */
    public getState(): EditorState {
        return this._reduxStore.getState();
    }

    /** Document getter for private document reference */
    public get document(): IKmlDocument | null {
        return this._kmlDocument;
    }

    /** Container getter for private container reference */
    public get container(): IKmzContainer | null {
        return this._kmzContainer;
    }

    /** Command stack delegator facade for legacy/test access */
    public get commands(): ICommandStack {
        return this._commandsDelegator;
    }

    /** Selected feature ID shortcut */
    public get selectedFeatureId(): FeatureId | null {
        return this._reduxStore.getState().selectedFeatureId;
    }

    /** Load file async flow */
    public async loadFile(file: File): Promise<void> {
        if (this._activeLoadController) {
            this._activeLoadController.abort();
        }
        this._activeLoadController = new AbortController();
        const signal = this._activeLoadController.signal;

        this._reduxStore.dispatch(setDocumentStatus('loading'));
        const tempContainer = createKmzContainer();

        try {
            await tempContainer.open(file);
            if (signal.aborted) {
                tempContainer.dispose();
                throw new Error('Loading aborted');
            }

            const docKml = tempContainer.getDocKml();
            if (!docKml || !docKml.match(/<kml/i)) {
                throw new Error('Invalid KML document: Missing root <kml> element');
            }

            const tempDoc = createKmlDocument();
            tempDoc.parse(docKml);

            if (signal.aborted) {
                tempContainer.dispose();
                throw new Error('Loading aborted');
            }

            // Cleanup previous container
            if (this._kmzContainer) {
                this._kmzContainer.dispose();
            }

            this._kmzContainer = tempContainer;
            this._kmlDocument = tempDoc;

            // Set up command stack
            const newStack = createCommandStack(tempDoc, this.geoBridge);
            this._activeStack = newStack;
            this._commandsDelegator.setStack(newStack);

            // Re-establish coordinates anchor
            this.initializeAnchor(tempDoc);

            // Project features into Redux store
            this.syncProjection();
        } catch (error) {
            tempContainer.dispose();
            this._reduxStore.dispatch(setDocumentStatus('error'));
            throw error;
        } finally {
            if (this._activeLoadController?.signal === signal) {
                this._activeLoadController = null;
            }
        }
    }

    /** Select feature */
    public selectFeature(id: FeatureId | null): void {
        this._reduxStore.dispatch(setSelectedFeatureId(id));
    }

    /** Set UI edit mode */
    public setEditMode(mode: EditMode): void {
        this._reduxStore.dispatch(setEditMode(mode));
    }

    /** Set AR/Device state */
    public setDeviceState(state: Partial<DeviceState>): void {
        this._reduxStore.dispatch(setDeviceState(state));
    }

    /** Execute command */
    public executeCommand(command: ICommand): void {
        if (this._activeStack) {
            this._activeStack.execute(command);
            this.syncProjection();
        }
    }

    /** Undo */
    public undo(): void {
        if (this._activeStack) {
            this._activeStack.undo();
            this.syncProjection();
        }
    }

    /** Redo */
    public redo(): void {
        if (this._activeStack) {
            this._activeStack.redo();
            this.syncProjection();
        }
    }

    /** Subscribe to Redux store updates */
    public subscribe(listener: (state: EditorState) => void): () => void {
        const unsubscribe = this._reduxStore.subscribe(() => {
            listener(this._reduxStore.getState());
        });
        // Call immediately with current state
        listener(this._reduxStore.getState());
        return unsubscribe;
    }

    private syncProjection(): void {
        if (!this._kmlDocument) return;

        const features = this._kmlDocument.getFeatures();
        const featuresById: Record<FeatureId, IFeatureView> = {};
        const featureOrder: FeatureId[] = [];

        for (const feature of features) {
            featuresById[feature.id] = toSerializableFeature(feature);
            featureOrder.push(feature.id);
        }

        // Update container's doc.kml string with serialized document
        if (this._kmzContainer) {
            this._kmzContainer.setDocKml(this._kmlDocument.serialize());
        }

        this._reduxStore.dispatch(setDocumentFeatures({ featuresById, featureOrder }));

        const canUndo = this._activeStack ? this._activeStack.canUndo() : false;
        const canRedo = this._activeStack ? this._activeStack.canRedo() : false;
        this._reduxStore.dispatch(setUndoRedoState({ canUndo, canRedo }));
    }

    private initializeAnchor(document: IKmlDocument): void {
        const features = document.getFeatures();
        let minLon = Infinity;
        let maxLon = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        let foundSpatial = false;

        for (const feature of features) {
            if (feature.type === 'marker') {
                const f = feature as any;
                if (f.position) {
                    minLon = Math.min(minLon, f.position.lon);
                    maxLon = Math.max(maxLon, f.position.lon);
                    minLat = Math.min(minLat, f.position.lat);
                    maxLat = Math.max(maxLat, f.position.lat);
                    foundSpatial = true;
                }
            } else if (feature.type === 'line') {
                const f = feature as any;
                if (f.coordinates && f.coordinates.length > 0) {
                    f.coordinates.forEach((coord: any) => {
                        minLon = Math.min(minLon, coord.lon);
                        maxLon = Math.max(maxLon, coord.lon);
                        minLat = Math.min(minLat, coord.lat);
                        maxLat = Math.max(maxLat, coord.lat);
                    });
                    foundSpatial = true;
                }
            } else if (feature.type === 'ground-overlay') {
                const f = feature as any;
                if (f.latLonBox) {
                    minLon = Math.min(minLon, f.latLonBox.west, f.latLonBox.east);
                    maxLon = Math.max(maxLon, f.latLonBox.west, f.latLonBox.east);
                    minLat = Math.min(minLat, f.latLonBox.south, f.latLonBox.north);
                    maxLat = Math.max(maxLat, f.latLonBox.south, f.latLonBox.north);
                    foundSpatial = true;
                }
            } else if (feature.type === 'model') {
                const f = feature as any;
                if (f.location) {
                    minLon = Math.min(minLon, f.location.lon);
                    maxLon = Math.max(maxLon, f.location.lon);
                    minLat = Math.min(minLat, f.location.lat);
                    maxLat = Math.max(maxLat, f.location.lat);
                    foundSpatial = true;
                }
            }
        }

        if (foundSpatial) {
            const lonCenter = (minLon + maxLon) / 2;
            const latCenter = (minLat + maxLat) / 2;
            this.geoBridge.setAnchor({
                position: { lon: lonCenter, lat: latCenter, alt: 0 },
                heading: 0,
            });
        } else {
            this.geoBridge.setAnchor({
                position: { lon: 0, lat: 0, alt: 0 },
                heading: 0,
            });
        }
    }
}

function toSerializableFeature(feature: IFeatureView): IFeatureView {
    const base = {
        id: feature.id,
        type: feature.type,
        name: feature.name,
        description: feature.description,
        ...(feature.kmlId ? { kmlId: feature.kmlId } : {}),
    };

    if (feature.type === 'marker') {
        const f = feature as any;
        return {
            ...base,
            type: 'marker',
            position: f.position ? { lon: f.position.lon, lat: f.position.lat, alt: f.position.alt ?? 0 } : { lon: 0, lat: 0, alt: 0 },
            iconHref: f.iconHref ?? null,
            iconScale: f.iconScale ?? 1,
        } as any;
    } else if (feature.type === 'line') {
        const f = feature as any;
        return {
            ...base,
            type: 'line',
            coordinates: (f.coordinates || []).map((c: any) => ({ lon: c.lon, lat: c.lat, alt: c.alt ?? 0 })),
        } as any;
    } else if (feature.type === 'ground-overlay') {
        const f = feature as any;
        return {
            ...base,
            type: 'ground-overlay',
            imageHref: f.imageHref || '',
            latLonBox: f.latLonBox ? { ...f.latLonBox } : { north: 0, south: 0, east: 0, west: 0, rotation: 0 },
            altitude: f.altitude || 0,
            altitudeMode: f.altitudeMode || 'clampToGround',
        } as any;
    } else if (feature.type === 'model') {
        const f = feature as any;
        return {
            ...base,
            type: 'model',
            location: f.location ? { lon: f.location.lon, lat: f.location.lat, alt: f.location.alt ?? 0 } : { lon: 0, lat: 0, alt: 0 },
            orientation: f.orientation ? { ...f.orientation } : { heading: 0, tilt: 0, roll: 0 },
            scale: f.scale ? { ...f.scale } : { x: 1, y: 1, z: 1 },
            modelHref: f.modelHref || '',
            altitudeMode: f.altitudeMode || 'clampToGround',
        } as any;
    }

    return base as IFeatureView;
}
