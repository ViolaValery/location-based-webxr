import { IEditorStore, EditorState } from '../contracts/store';
import { IKmlDocument } from '../contracts/document-model';
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
    loadFileSuccess,
    selectFeature,
    mutateDocument,
    EditorReduxState,
} from './redux-store';

export class EditorStoreImpl implements IEditorStore {
    public readonly geoBridge: IGeoBridge;

    private readonly _reduxStore: ReturnType<typeof createReduxStore>;
    private readonly _commandsDelegator: CommandStackDelegator;
    private _activeStack: ICommandStack | null = null;
    private _activeLoadController: AbortController | null = null;
    private _stackChangeListenerUnsubscribe: (() => void) | null = null;

    constructor() {
        this.geoBridge = createGeoBridge();
        this._commandsDelegator = new CommandStackDelegator();
        this._reduxStore = createReduxStore();
    }

    /** Document getter reading directly from Redux State */
    public get document(): IKmlDocument | null {
        return this._reduxStore.getState().document;
    }

    /** Container getter reading directly from Redux State */
    public get container(): IKmzContainer | null {
        return this._reduxStore.getState().container;
    }

    /** Commands stack delegator facade */
    public get commands(): ICommandStack {
        return this._commandsDelegator;
    }

    /** Selection ID getter reading directly from Redux State */
    public get selectedFeatureId(): FeatureId | null {
        return this._reduxStore.getState().selectedFeatureId;
    }

    /** Load file async flow dispatching RTK slice actions */
    public async loadFile(file: File): Promise<void> {
        // Abort previous loading controllers to protect concurrency
        if (this._activeLoadController) {
            this._activeLoadController.abort();
        }
        this._activeLoadController = new AbortController();
        const signal = this._activeLoadController.signal;

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

            // Transactional swap: clean up previous containers
            const oldContainer = this._reduxStore.getState().container;
            if (oldContainer) {
                oldContainer.dispose();
            }

            // Dispatch loadFileSuccess slice action to Redux Store
            this._reduxStore.dispatch(
                loadFileSuccess({ document: tempDoc, container: tempContainer })
            );

            // Set up command stack
            const newStack = createCommandStack(tempDoc, this.geoBridge);
            this._activeStack = newStack;
            this._commandsDelegator.setStack(newStack);

            // Re-establish coordinates anchor
            this.initializeAnchor(tempDoc);

            // Dispatches mutation action when commands execution history changes
            if (this._stackChangeListenerUnsubscribe) {
                this._stackChangeListenerUnsubscribe();
            }
            this._stackChangeListenerUnsubscribe = this._commandsDelegator.onChange(() => {
                this._reduxStore.dispatch(mutateDocument());
            });
        } catch (error) {
            tempContainer.dispose();
            throw error;
        } finally {
            if (this._activeLoadController?.signal === signal) {
                this._activeLoadController = null;
            }
        }
    }

    /** Dispatches selectFeature slice action */
    public selectFeature(id: FeatureId | null): void {
        if (this.selectedFeatureId !== id) {
            this._reduxStore.dispatch(selectFeature(id));
        }
    }

    /** Forwards execution down to the proxy delegator */
    public executeCommand(command: ICommand): void {
        this._commandsDelegator.execute(command);
    }

    /** Subscribes to the Redux Store, translating details to the EditorState contract */
    public subscribe(listener: (state: EditorState) => void): () => void {
        const unsubscribe = this._reduxStore.subscribe(() => {
            const state = this._reduxStore.getState();
            listener({
                document: state.document,
                container: state.container,
                selectedFeatureId: state.selectedFeatureId,
            });
        });

        // Immediately invoke listener on registration
        const state = this._reduxStore.getState();
        listener({
            document: state.document,
            container: state.container,
            selectedFeatureId: state.selectedFeatureId,
        });

        return unsubscribe;
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
