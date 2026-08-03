import * as THREE from 'three';
import { IKmlDocument } from '../contracts/document-model';
import { IKmzContainer } from '../contracts/kmz-container';
import { IPersistenceService } from '../contracts/persistence';
import { IEditorStore } from '../contracts/store';
import { IGeoBridge } from '../contracts/geo-bridge';
import { KmzContainer } from '../kmz-io/container';
import { createKmlDocument } from '../document-model';
import { createPersistenceService } from '../persistence';
import { RendererFactory } from '../renderers';
import { createEditorStore } from '../store';
import { PersistenceCoordinator } from '../editor/persistence-coordinator';
import { ArAnchorCoordinator } from './ar-anchor-coordinator';
import { ArHud } from './ar-hud';
import { ArInteractionController } from './ar-interaction-controller';
import { ArReplayAdapter } from './ar-replay-adapter';
import { ArSceneManager } from './ar-scene-manager';
import { ArSessionManager } from './ar-session-manager';
import './ar-hud.css';

const DEFAULT_DEMO_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2" xmlns:atom="http://www.w3.org/2005/Atom">
<Document id="document">
	<name>Templergraben</name>
	<Placemark id="04688638DD40FC430ED0">
		<name>Balkon_1</name>
		<Point>
			<coordinates>6.077016328485207,50.77648778886836,182.1572560910104</coordinates>
		</Point>
	</Placemark>
	<Placemark id="0D646CBE3840FC437CD9">
		<name>Balkon_2</name>
		<Point>
			<coordinates>6.077011067411511,50.77647671515103,182.1266003787015</coordinates>
		</Point>
	</Placemark>
	<Placemark id="08CB96247640FC444D30">
		<name>Templergraben_1</name>
		<Point>
			<coordinates>6.076779734351103,50.77659467685434,177.8349206841328</coordinates>
		</Point>
	</Placemark>
	<Placemark id="0C32A715BE40FC44A578">
		<name>BlauesHaus</name>
		<Point>
			<coordinates>6.076693601751531,50.77663145268301,177.9759874956725</coordinates>
		</Point>
	</Placemark>
	<Placemark id="0F2B31ED5240FC44FB5B">
		<name>Parkplatz</name>
		<Point>
			<coordinates>6.076812101462215,50.77666895561171,177.7274421581052</coordinates>
		</Point>
	</Placemark>
	<Placemark id="0AE303128740FC45E9E7">
		<name>TemplerDreieck</name>
		<Polygon>
			<outerBoundaryIs>
				<LinearRing>
					<coordinates>
						6.076693496359235,50.77663166332717,0 6.076779894650257,50.7765947671442,0 6.076812144963577,50.77666926528035,0 6.076693496359235,50.77663166332717,0 
					</coordinates>
				</LinearRing>
			</outerBoundaryIs>
		</Polygon>
	</Placemark>
</Document>
</kml>`;

import {
    startGpsWatch,
    stopGpsWatch,
    startOrientationWatch,
    stopOrientationWatch,
} from 'gps-plus-slam-app-framework/sensors';

export interface ArAppOptions {
    container: HTMLElement;
    store?: IEditorStore;
    persistenceService?: IPersistenceService;
}

export class ArApp {
    private readonly store: IEditorStore;
    private readonly persistence: IPersistenceService;
    private readonly rendererFactory = new RendererFactory();

    private readonly canvas: HTMLCanvasElement;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly sessionManager: ArSessionManager;
    private readonly sceneManager: ArSceneManager;
    private readonly anchorCoordinator: ArAnchorCoordinator;
    private readonly interactionController: ArInteractionController;
    private readonly hud: ArHud;
    private readonly replayAdapter: ArReplayAdapter;
    private readonly persistenceCoordinator: PersistenceCoordinator;

    private containerFile: IKmzContainer | null = null;
    private documentModel: IKmlDocument | null = null;
    private storeUnsubscribe: (() => void) | null = null;

    private get geoBridge(): IGeoBridge {
        return (this.store as any).geoBridge;
    }

    public constructor(options: ArAppOptions) {
        this.store = options.store ?? createEditorStore();
        this.persistence = options.persistenceService ?? createPersistenceService();

        options.container.replaceChildren();

        // WebGL Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        options.container.appendChild(this.canvas);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(options.container.clientWidth || window.innerWidth, options.container.clientHeight || window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.sceneManager = new ArSceneManager(this.rendererFactory);
        this.sceneManager.attachRenderer(this.renderer);

        this.anchorCoordinator = new ArAnchorCoordinator(this.geoBridge, this.store);
        this.sessionManager = new ArSessionManager({
            canvas: this.canvas,
            domOverlayRoot: options.container,
        });

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

        this.interactionController = new ArInteractionController(
            this.canvas,
            this.sceneManager,
            this.geoBridge,
            this.store,
            this.anchorCoordinator,
            () => this.documentModel
        );

        this.replayAdapter = new ArReplayAdapter(this.anchorCoordinator, this.store);

        this.persistenceCoordinator = new PersistenceCoordinator(
            this.store,
            this.persistence,
            () => this.containerFile,
            () => this.documentModel
        );

        this.sessionManager.onTrackingStateChange((state) => {
            this.hud.updateTrackingState(state);
            const isAr = state === 'tracking' || state === 'searching';
            this.store.setDeviceState({ isArActive: isAr });
            this.sceneManager.setGridVisible(!isAr);
        });

        // Set unified animation loop for both desktop preview and WebXR sessions
        this.renderer.setAnimationLoop((_time, frame) => {
            if (frame) {
                const refSpace = this.sessionManager.getReferenceSpace();
                if (refSpace) {
                    const pose = frame.getViewerPose(refSpace);
                    if (pose) {
                        this.anchorCoordinator.updateViewerPose(pose);
                    }
                }
            }
            this.sceneManager.render(this.renderer);
        });

        this.storeUnsubscribe = this.store.subscribe(() => void this.onStoreChange());
        window.addEventListener('resize', this.onWindowResize);

        // Preload default demo document on startup
        void this.loadDefaultDemo();
    }

    public async openFile(file?: File | ArrayBuffer): Promise<void> {
        const kmz = new KmzContainer();
        if (file instanceof File) {
            await kmz.open(file);
        } else if (file instanceof ArrayBuffer) {
            await kmz.open(file);
        } else {
            return;
        }

        await this.store.loadContainer(kmz);
        this.containerFile = kmz;
        this.documentModel = this.store.document;

        if (this.documentModel) {
            await this.sceneManager.reconcileFeatures(
                this.documentModel.getFeatures(),
                kmz.getAssetProvider(),
                this.geoBridge
            );

            const fileName = file instanceof File ? file.name : 'Document';
            this.hud.updateFileStatus(`Loaded ${fileName} (${this.documentModel.getFeatures().length} features)`);
        }
    }

    public async startArSession(): Promise<void> {
        this.sceneManager.setGridVisible(false);
        await this.sessionManager.requestSession(this.renderer);
        let firstGpsFix = true;

        startGpsWatch(
            (pos) => {
                if (firstGpsFix) {
                    firstGpsFix = false;
                    // Reset AR anchor to current device position on first fix
                    this.anchorCoordinator.resetAnchor({ lon: pos.lon, lat: pos.lat, alt: pos.altitude ?? 0 }, pos.heading ?? 0);
                    if (this.documentModel && this.containerFile) {
                        void this.sceneManager.reconcileFeatures(
                            this.documentModel.getFeatures(),
                            this.containerFile.getAssetProvider(),
                            this.geoBridge
                        );
                    }
                }
                this.anchorCoordinator.updateGps(
                    pos.lat,
                    pos.lon,
                    pos.altitude ?? 0,
                    pos.heading ?? 0,
                    pos.accuracy
                );
            },
            (err) => console.warn('[ArApp] GPS watch error:', err.message)
        );
        startOrientationWatch((orient) => {
            if (orient.alpha !== null) {
                const heading = (360 - orient.alpha) % 360;
                const currentGps = this.store.getState().device.gpsPosition;
                if (currentGps) {
                    this.anchorCoordinator.updateGps(
                        currentGps.latitude,
                        currentGps.longitude,
                        currentGps.altitude,
                        heading,
                        this.store.getState().device.accuracy
                    );
                }
            }
        });
    }

    public async stopArSession(): Promise<void> {
        stopGpsWatch();
        stopOrientationWatch();
        this.sceneManager.setGridVisible(true);
        await this.sessionManager.endSession();
    }

    public getReplayAdapter(): ArReplayAdapter {
        return this.replayAdapter;
    }

    public dispose(): void {
        stopGpsWatch();
        stopOrientationWatch();
        window.removeEventListener('resize', this.onWindowResize);
        if (this.storeUnsubscribe) this.storeUnsubscribe();
        this.sessionManager.dispose();
        this.sceneManager.dispose();
        this.interactionController.dispose();
        this.hud.dispose();
        this.replayAdapter.dispose();
        this.persistenceCoordinator.dispose();
        this.renderer.dispose();
    }

    private async loadDefaultDemo(): Promise<void> {
        const kmz = new KmzContainer();
        kmz.setDocKml(DEFAULT_DEMO_KML);
        await this.store.loadContainer(kmz);
        this.containerFile = kmz;
        this.documentModel = this.store.document;

        if (this.documentModel) {
            const features = this.documentModel.getFeatures();
            if (features.length > 0 && !this.geoBridge.getAnchor()) {
                const first = features[0];
                if ('position' in first && (first as any).position) {
                    this.geoBridge.setAnchor({ position: (first as any).position, heading: 0 });
                }
            }
            await this.sceneManager.reconcileFeatures(
                features,
                kmz.getAssetProvider(),
                this.geoBridge
            );
            this.hud.updateFileStatus(`Templergraben Loaded (${features.length} features)`);
        }
    }

    private onWindowResize = (): void => {
        const width = this.canvas.parentElement?.clientWidth || window.innerWidth;
        const height = this.canvas.parentElement?.clientHeight || window.innerHeight;
        this.cameraAspect(width, height);
        this.renderer.setSize(width, height);
    };

    private cameraAspect(width: number, height: number): void {
        this.sceneManager.camera.aspect = width / height;
        this.sceneManager.camera.updateProjectionMatrix();
    }

    private async onStoreChange(): Promise<void> {
        if (this.documentModel && this.containerFile) {
            await this.sceneManager.reconcileFeatures(
                this.documentModel.getFeatures(),
                this.containerFile.getAssetProvider(),
                this.geoBridge
            );
        }
    }
}

export function mountArApp(container: HTMLElement, options?: Omit<ArAppOptions, 'container'>): ArApp {
    return new ArApp({ container, ...options });
}
