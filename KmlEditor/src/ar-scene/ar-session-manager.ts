import * as THREE from 'three';

export type TrackingState = 'uninitialized' | 'searching' | 'tracking' | 'lost';

export interface ArSessionManagerOptions {
    canvas: HTMLCanvasElement;
    domOverlayRoot?: HTMLElement;
}

export class ArSessionManager {
    private session: XRSession | null = null;
    private referenceSpace: XRReferenceSpace | null = null;
    private trackingState: TrackingState = 'uninitialized';
    private frameCallback: ((time: DOMHighResTimeStamp, frame: XRFrame) => void) | null = null;
    private stateListeners = new Set<(state: TrackingState) => void>();

    public constructor(private readonly options: ArSessionManagerOptions) {}

    public static async isSupported(): Promise<boolean> {
        if (typeof navigator === 'undefined' || !navigator.xr) return false;
        try {
            return await navigator.xr.isSessionSupported('immersive-ar');
        } catch {
            return false;
        }
    }

    public async requestSession(renderer?: THREE.WebGLRenderer): Promise<XRSession> {
        if (this.session) return this.session;
        if (typeof navigator === 'undefined' || !navigator.xr) {
            throw new Error('WebXR API is not available on this device or browser.');
        }

        const sessionInit: XRSessionInit = {
            requiredFeatures: ['local-floor'],
            optionalFeatures: ['dom-overlay', 'unbounded'],
        };

        if (this.options.domOverlayRoot) {
            sessionInit.domOverlay = { root: this.options.domOverlayRoot };
        }

        const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
        this.session = session;
        this.setTrackingState('searching');

        if (renderer) {
            renderer.xr.enabled = true;
            await renderer.xr.setSession(session);
        }

        let refSpace: XRReferenceSpace;
        try {
            refSpace = await session.requestReferenceSpace('unbounded');
        } catch {
            refSpace = await session.requestReferenceSpace('local-floor');
        }
        this.referenceSpace = refSpace;

        session.addEventListener('end', () => {
            this.session = null;
            this.referenceSpace = null;
            this.setTrackingState('uninitialized');
        });

        session.addEventListener('visibilitychange', () => {
            if (session.visibilityState === 'hidden' || session.visibilityState === 'visible-blurred') {
                this.setTrackingState('lost');
            } else if (session.visibilityState === 'visible') {
                this.setTrackingState('tracking');
            }
        });

        const onXRFrame: XRFrameRequestCallback = (time, frame) => {
            if (!this.session) return;
            const pose = frame.getViewerPose(this.referenceSpace!);
            if (pose) {
                if (pose.emulatedPosition) {
                    this.setTrackingState('searching');
                } else {
                    this.setTrackingState('tracking');
                }
            } else {
                this.setTrackingState('lost');
            }

            if (this.frameCallback) {
                this.frameCallback(time, frame);
            }

            this.session.requestAnimationFrame(onXRFrame);
        };

        session.requestAnimationFrame(onXRFrame);
        return session;
    }

    public async endSession(): Promise<void> {
        if (this.session) {
            await this.session.end();
            this.session = null;
            this.referenceSpace = null;
            this.setTrackingState('uninitialized');
        }
    }

    public onFrame(callback: (time: DOMHighResTimeStamp, frame: XRFrame) => void): void {
        this.frameCallback = callback;
    }

    public getSession(): XRSession | null {
        return this.session;
    }

    public getReferenceSpace(): XRReferenceSpace | null {
        return this.referenceSpace;
    }

    public getTrackingState(): TrackingState {
        return this.trackingState;
    }

    public onTrackingStateChange(listener: (state: TrackingState) => void): () => void {
        this.stateListeners.add(listener);
        listener(this.trackingState);
        return () => this.stateListeners.delete(listener);
    }

    public dispose(): void {
        void this.endSession();
        this.stateListeners.clear();
        this.frameCallback = null;
    }

    private setTrackingState(state: TrackingState): void {
        if (this.trackingState === state) return;
        this.trackingState = state;
        for (const listener of this.stateListeners) {
            listener(state);
        }
    }
}
