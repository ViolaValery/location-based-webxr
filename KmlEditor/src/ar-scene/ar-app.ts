import { IKmlDocument } from '../contracts/document-model';
import { IKmzContainer } from '../contracts/kmz-container';
import { IPersistenceService } from '../contracts/persistence';
import { IGeoBridge } from '../contracts/geo-bridge';
import { KmzContainer } from '../kmz-io/container';
import { createPersistenceService } from '../persistence';
import { RendererFactory } from '../renderers';
import { EditorStoreImpl } from '../store';
import { PersistenceCoordinator } from '../editor/persistence-coordinator';
import { ArAnchorCoordinator } from './ar-anchor-coordinator';
import { ArHud } from './ar-hud';
import { ArInteractionController } from './ar-interaction-controller';
import { ArReplayAdapter } from './ar-replay-adapter';
import { ArSceneManager } from './ar-scene-manager';
import './ar-hud.css';

import {
    createEnableGpsArController,
    type EnableGpsArController,
    type EnableGpsArState,
    getArWorldGroup,
    getCurrentArPose,
    setTrackingLostCallback,
    setTrackingStore,
    type TrackingSubscribableStore,
} from 'gps-plus-slam-app-framework/ar';
import {
    createGpsPositionHandler,
    createSlamAppStore,
    endSession,
    setZeroPos,
    startSession,
    updateDeviceOrientation,
    type SubscribableStore,
} from 'gps-plus-slam-app-framework/state';
import { enableArWorldGroupAlignment } from 'gps-plus-slam-app-framework/visualization';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';

export interface ArAppOptions {
    container: HTMLElement;
    store?: EditorStoreImpl;
    persistenceService?: IPersistenceService;
}

/**
 * ArApp — top-level composition root for the KML AR editor (Component 8).
 *
 * Framework integration:
 *   1. createSlamAppStore initializes Redux SLAM/GPS fusion tracking slices.
 *   2. setZeroPos locks zeroReference in Redux to the stable document anchor.
 *   3. enableArWorldGroupAlignment dynamically aligns arWorldGroup.matrix
 *      to physical North-Up-East space every frame during active sessions.
 */
export class ArApp {
    private readonly store: EditorStoreImpl;
    private readonly persistence: IPersistenceService;
    private readonly rendererFactory = new RendererFactory();

    private readonly sceneManager: ArSceneManager;
    private readonly anchorCoordinator: ArAnchorCoordinator;
    private readonly interactionController: ArInteractionController;
    private readonly hud: ArHud;
    private readonly replayAdapter: ArReplayAdapter;
    private readonly persistenceCoordinator: PersistenceCoordinator;
    private readonly enableGpsArController: EnableGpsArController;

    private slamStore = createSlamAppStore({ storageBackend: new NullStorageBackend() });
    private gpsHandler = createGpsPositionHandler({
        store: this.slamStore,
        getArPose: getCurrentArPose,
    });

    private containerFile: IKmzContainer | null = null;
    private documentModel: IKmlDocument | null = null;
    private storeUnsubscribe: (() => void) | null = null;
    private arStateUnsubscribe: (() => void) | null = null;

    private get geoBridge(): IGeoBridge {
        return this.store.geoBridge;
    }

    public constructor(options: ArAppOptions) {
        this.store = options.store ?? new EditorStoreImpl();
        this.persistence = options.persistenceService ?? createPersistenceService();

        options.container.replaceChildren();

        // Register tracking store with framework
        setTrackingStore(this.slamStore as unknown as TrackingSubscribableStore);

        this.enableGpsArController = createEnableGpsArController();
        void this.enableGpsArController.refreshSupport();

        // ── App-owned modules ────────────────────────────────────────────────
        this.anchorCoordinator = new ArAnchorCoordinator(this.geoBridge, this.store);
        this.anchorCoordinator.onAnchorChange = (anchor) => {
            this.slamStore.dispatch(
                setZeroPos({
                    lat: anchor.position.lat,
                    lon: anchor.position.lon,
                    altitude: anchor.position.alt,
                })
            );
            void this.reconcileIfActive();
        };
        this.sceneManager = new ArSceneManager(this.rendererFactory);

        this.hud = new ArHud(
            options.container,
            this.store,
            this.persistence,
            () => this.documentModel,
            (file) => void this.openFile(file),
            () => void this.startArSession(),
            () => void this.stopArSession()
        );
        this.hud.mount();

        const sentinelCanvas = document.createElement('canvas');
        this.interactionController = new ArInteractionController(
            sentinelCanvas,
            this.sceneManager,
            this.geoBridge,
            this.store,
            this.anchorCoordinator,
            () => this.documentModel
        );

        this.replayAdapter = new ArReplayAdapter(this.anchorCoordinator, this.store);
        this.persistenceCoordinator = new PersistenceCoordinator(this.persistence);

        setTrackingLostCallback(() => {
            this.hud.updateTrackingState('lost');
            this.store.setDeviceState({ isArActive: false });
        });

        this.arStateUnsubscribe = this.enableGpsArController.subscribe(
            (state: EnableGpsArState) => {
                this.hud.updateTrackingState(state.status);
                this.store.setDeviceState({ isArActive: state.status === 'running' });
                if (state.status === 'error') {
                    this.hud.updateFileStatus(`AR Error: ${state.error ?? 'unknown'}`);
                }
            }
        );

        this.storeUnsubscribe = this.store.subscribe(() => void this.onStoreChange());
        void this.loadDefaultDemo();
    }

    public async openFile(file: File | ArrayBuffer): Promise<void> {
        try {
            const kmz = new KmzContainer();
            await kmz.open(file);
            await this.store.loadContainer(kmz);
            this.containerFile = kmz;
            this.documentModel = this.store.document;

            const featureCount = this.documentModel?.getFeatures().length ?? 0;
            const fileName = file instanceof File ? file.name : 'Document';
            this.hud.updateFileStatus(`Loaded ${fileName} (${featureCount} features)`);

            await this.reconcileIfActive();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.hud.updateFileStatus(`Error: ${msg}`);
        }
    }

    public async startArSession(): Promise<void> {
        this.resetSlamStore();
        this.anchorCoordinator.resetSessionState();
        const container = this.hud['container'] as HTMLElement;

        // Lock zeroReference in SLAM store to document anchor so zeroReference never shifts with raw GPS jitter
        const docAnchor = this.geoBridge.getAnchor();
        if (docAnchor) {
            this.slamStore.dispatch(
                setZeroPos({
                    lat: docAnchor.position.lat,
                    lon: docAnchor.position.lon,
                    altitude: docAnchor.position.alt,
                })
            );
        }

        const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) => {
            setTimeout(() => {
                resolve({
                    ok: false,
                    error: 'Location/WebXR permission timed out. Ensure you access via http://localhost:5173 (via Chrome Port Forwarding) or HTTPS.',
                });
            }, 8000);
        });

        try {
            const result = await Promise.race([
                this.enableGpsArController.enable({
                    container,

                    // Feed GPS fixes into framework tracking store + anchor coordinator
                    onGpsPosition: (pos) => {
                        this.gpsHandler(pos);

                        const currentHeading = this.store.getState().device.heading ?? 0;
                        this.anchorCoordinator.updateGps(
                            pos.lat,
                            pos.lon,
                            pos.altitude ?? 0,
                            currentHeading,
                            pos.accuracy
                        );
                        this.sceneManager.updateAccuracyRing(pos.accuracy);
                        this.hud.updateDiagnosticInfo(this.anchorCoordinator.getDiagnosticInfo());
                    },

                    // Feed device orientation into framework tracking store + anchor coordinator
                    onOrientation: (orient) => {
                        updateDeviceOrientation(orient);
                        if (orient.alpha !== null) {
                            this.anchorCoordinator.updateHeading(orient.alpha);
                            this.hud.updateDiagnosticInfo(this.anchorCoordinator.getDiagnosticInfo());
                        }
                    },
                }),
                timeoutPromise,
            ]);

            if (!result.ok) {
                console.warn('[ArApp] AR session failed to start:', result.error);
                this.hud.updateFileStatus(`AR Error: ${result.error ?? 'failed to start'}`);
                await this.enableGpsArController.disable();
                this.hud.updateTrackingState('ready');
                return;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[ArApp] Exception during startArSession:', err);
            this.hud.updateFileStatus(`AR Exception: ${msg}`);
            await this.enableGpsArController.disable();
            this.hud.updateTrackingState('ready');
            return;
        }

        // Dispatch session start to framework SLAM store
        this.slamStore.dispatch(
            startSession({
                scenarioName: 'kml-ar',
                sessionName: 'live',
                startTime: Date.now(),
            })
        );

        // Bind framework alignment lerp onto arWorldGroup
        const arWorldGroup = getArWorldGroup();
        if (arWorldGroup) {
            enableArWorldGroupAlignment({
                store: this.slamStore as unknown as SubscribableStore,
                arWorldGroup,
            });
        }

        // Attach KML feature group to framework scene
        this.sceneManager.attachToFrameworkScene();
        await this.reconcileIfActive();
    }

    public async stopArSession(): Promise<void> {
        try {
            this.slamStore.dispatch(endSession());
        } catch (_err) {
            // ignore
        }
        await this.enableGpsArController.disable();
        this.sceneManager.detachFromFrameworkScene();
        this.resetSlamStore();
        this.hud.updateTrackingState('ready');
        this.hud.updateDiagnosticInfo('');
    }

    public getReplayAdapter(): ArReplayAdapter {
        return this.replayAdapter;
    }

    public dispose(): void {
        void this.enableGpsArController.disable();
        if (this.arStateUnsubscribe) this.arStateUnsubscribe();
        if (this.storeUnsubscribe) this.storeUnsubscribe();
        this.sceneManager.dispose();
        this.interactionController.dispose();
        this.hud.dispose();
        this.replayAdapter.dispose();
        this.anchorCoordinator.dispose();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private resetSlamStore(): void {
        this.slamStore = createSlamAppStore({ storageBackend: new NullStorageBackend() });
        setTrackingStore(this.slamStore as unknown as TrackingSubscribableStore);
        this.gpsHandler = createGpsPositionHandler({
            store: this.slamStore,
            getArPose: getCurrentArPose,
        });

        // Re-apply zeroReference to document anchor if document is loaded
        const docAnchor = this.geoBridge.getAnchor();
        if (docAnchor) {
            this.slamStore.dispatch(
                setZeroPos({
                    lat: docAnchor.position.lat,
                    lon: docAnchor.position.lon,
                    altitude: docAnchor.position.alt,
                })
            );
        }
    }

    private async loadDefaultDemo(): Promise<void> {
        try {
            const response = await fetch('/fixtures/google-earth/Templergraben.kml');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const kmlText = await response.text();

            const kmz = new KmzContainer();
            kmz.setDocKml(kmlText);
            await this.store.loadContainer(kmz);
            this.containerFile = kmz;
            this.documentModel = this.store.document;

            const featureCount = this.documentModel?.getFeatures().length ?? 0;
            this.hud.updateFileStatus(`Templergraben (${featureCount} features)`);
            this.persistenceCoordinator.observe(this.documentModel, this.containerFile);
        } catch (_err) {
            // Silently skip if fixture isn't served
        }
    }

    private async reconcileIfActive(): Promise<void> {
        if (!this.documentModel || !this.containerFile) return;
        if (!this.sceneManager.featureGroup.parent) return;

        const result = await this.sceneManager.reconcileFeatures(
            this.documentModel.getFeatures(),
            this.containerFile.getAssetProvider(),
            this.geoBridge
        );

        if (result.largeFileWarning) {
            const count = this.documentModel.getFeatures().length;
            this.hud.updateFileStatus(
                `⚠️ Large file (${count} features): only features within 500 m are rendered`
            );
        }
    }

    private async onStoreChange(): Promise<void> {
        if (this.documentModel && this.containerFile) {
            this.persistenceCoordinator.observe(this.documentModel, this.containerFile);
        }
        await this.reconcileIfActive();
    }
}

export function mountArApp(container: HTMLElement, options?: Omit<ArAppOptions, 'container'>): ArApp {
    return new ArApp({ container, ...options });
}
