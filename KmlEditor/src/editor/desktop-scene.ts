import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Browser-owned Three.js shell. Feature renderers are mounted below featureRoot. */
export class DesktopScene {
    public readonly scene = new THREE.Scene();
    public readonly featureRoot = new THREE.Group();
    public readonly overlayRoot = new THREE.Group();
    public readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100_000);
    public readonly renderer: THREE.WebGLRenderer;
    public readonly controls: OrbitControls;
    private frameId: number | null = null;
    private readonly resizeObserver: ResizeObserver;
    private disposed = false;

    public constructor(private readonly host: HTMLElement) {
        this.scene.background = new THREE.Color(0x10131a);
        this.scene.add(this.featureRoot, this.overlayRoot, new THREE.HemisphereLight(0xffffff, 0x263040, 2));
        const key = new THREE.DirectionalLight(0xffffff, 2);
        key.position.set(20, 40, 20);
        this.scene.add(key, new THREE.GridHelper(100, 100, 0x4e678a, 0x253244));
        this.camera.position.set(25, 25, 25);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.domElement.setAttribute('aria-label', '3D KML preview');
        this.host.appendChild(this.renderer.domElement);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
        this.resize();
        this.renderLoop();
    }

    public resize(): void {
        const width = Math.max(1, this.host.clientWidth);
        const height = Math.max(1, this.host.clientHeight);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.frameId !== null) cancelAnimationFrame(this.frameId);
        this.resizeObserver.disconnect();
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    private renderLoop = (): void => {
        if (this.disposed) return;
        this.frameId = requestAnimationFrame(this.renderLoop);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    };
}
