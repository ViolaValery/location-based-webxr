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
} from 'gps-plus-slam-app-framework/ar';
import {
    createGpsPositionHandler,
    createSlamAppStore,
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
 * WebXR session lifecycle is fully delegated to the framework via
 * createEnableGpsArController() → enable() → initAR().
 *
 * Framework alignment:
 *   - createSlamAppStore initializes the Redux store with SLAM/GPS fusion tracking slices.
 *   - enableArWorldGroupAlignment connects the alignment matrix to arWorldGroup so that
 *     all features in featureGroup stay aligned to real-world North-Up-East space in AR.
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

    private readonly slamStore = createSlamAppStore({ storageBackend: new NullStorageBackend() });
    private readonly gpsHandler = createGpsPositionHandler({
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
        setTrackingStore(this.slamStore as any);

        // ── Framework: EnableGpsArController ────────────────────────────────
        this.enableGpsArController = createEnableGpsArController();

        // Probe AR support on boot so the HUD button can reflect availability.
        void this.enableGpsArController.refreshSupport();

        // ── App-owned modules ────────────────────────────────────────────────
        this.anchorCoordinator = new ArAnchorCoordinator(this.geoBridge, this.store);
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

        // Framework tracking-lost callback → HUD warning
        setTrackingLostCallback(() => {
            this.hud.updateTrackingState('lost');
            this.store.setDeviceState({ isArActive: false });
        });

        // EnableGpsArController state → HUD badge
        this.arStateUnsubscribe = this.enableGpsArController.subscribe(
            (state: EnableGpsArState) => {
                this.hud.updateTrackingState(state.status);
                this.store.setDeviceState({ isArActive: state.status === 'running' });
                if (state.status === 'error') {
                    this.hud.updateFileStatus(`AR Error: ${state.error ?? 'unknown'}`);
                }
            }
        );

        // Subscribe to store changes → scene reconciliation + persistence
        this.storeUnsubscribe = this.store.subscribe(() => void this.onStoreChange());

        // Preload the default demo document (non-blocking)
        void this.loadDefaultDemo();
    }

    /**
     * Open a .kml or .kmz file from a File object or ArrayBuffer and
     * load it into the scene / store.
     */
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

            // Reconcile into scene if a session is already active
            await this.reconcileIfActive();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.hud.updateFileStatus(`Error: ${msg}`);
        }
    }

    /**
     * Start an AR session. MUST be called from a user gesture (button click) so
     * the browser allows permission prompts.
     */
    public async startArSession(): Promise<void> {
        this.anchorCoordinator.resetSessionState();
        const container = this.hud['container'] as HTMLElement;

        const result = await this.enableGpsArController.enable({
            container,

            // Feed GPS fixes into framework tracking store + anchor coordinator
            onGpsPosition: (pos) => {
                this.gpsHandler.handlePosition(pos);

                const currentHeading = this.store.getState().device.heading ?? 0;
                this.anchorCoordinator.updateGps(
                    pos.lat,
                    pos.lon,
                    pos.altitude ?? 0,
                    currentHeading,
                    pos.accuracy
                );
                this.sceneManager.updateAccuracyRing(pos.accuracy);
            },

            // Feed device orientation into framework tracking store + anchor coordinator
            onOrientation: (orient) => {
                this.slamStore.dispatch(updateDeviceOrientation(orient));
                if (orient.alpha !== null) {
                    this.anchorCoordinator.updateHeading(orient.alpha);
                }
            },
        });

        if (!result.ok) {
            console.warn('[ArApp] AR session failed to start:', result.error);
            return;
        }

        // Start tracking session in framework SLAM store
        this.slamStore.dispatch(
            startSession({
                scenarioName: 'kml-ar',
                sessionName: 'live',
                startTime: Date.now(),
            })
        );

        // Enable group-level GPS alignment on arWorldGroup
        const arWorldGroup = getArWorldGroup();
        if (arWorldGroup) {
            enableArWorldGroupAlignment({
                store: this.slamStore as unknown as SubscribableStore,
                arWorldGroup,
            });
        }

        // Attach KML feature group to the framework's GPS-aligned world group.
        this.sceneManager.attachToFrameworkScene();

        // Reconcile features into the now-active framework scene.
        await this.reconcileIfActive();
    }

    /**
     * Stop the active AR session.
     */
    public async stopArSession(): Promise<void> {
        await this.enableGpsArController.disable();
        this.sceneManager.detachFromFrameworkScene();
        this.hud.updateTrackingState('ready');
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
            // Silently skip if the fixture isn't served — happens in tests
        }
    }

    /** Reconcile KML features into the Three.js scene when both scene and document are active. */
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
