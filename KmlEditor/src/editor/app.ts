import * as THREE from 'three';
import { createDeleteFeatureCommand, createSetDescriptionCommand, createSetNameCommand } from '../commands';
import { IFeatureView } from '../contracts/document-model';
import { IAssetProvider } from '../contracts/kmz-container';
import { IEditorStore } from '../contracts/store';
import { FeatureId } from '../contracts/type';
import { RendererFactory } from '../renderers';
import { createEditorStore } from '../store';
import { DesktopScene } from './desktop-scene';
import { FeatureSceneRegistry } from './feature-scene-registry';

const dummyAssetProvider: IAssetProvider = {
    getAssetUrl: async (href) => href,
    release: () => { },
    getAssetBytes: async () => new Uint8Array(0),
    hasAsset: () => false,
    dispose: () => { },
};

/** Mountable desktop editor. */
export class EditorApp {
    private readonly store: IEditorStore;
    private readonly scene: DesktopScene;
    private readonly registry: FeatureSceneRegistry;
    private readonly list: HTMLUListElement;
    private readonly nameInput: HTMLInputElement;
    private readonly descriptionInput: HTMLTextAreaElement;
    private readonly message: HTMLElement;
    private unsubscribe: (() => void) | null = null;
    private disposed = false;

    public constructor(private readonly host: HTMLElement, store: IEditorStore = createEditorStore()) {
        this.store = store;
        this.host.replaceChildren();
        const shell = document.createElement('div');
        shell.className = 'kml-editor';
        const sidebar = document.createElement('aside');
        const viewport = document.createElement('main');
        viewport.className = 'kml-editor__viewport';
        this.list = document.createElement('ul');
        this.list.setAttribute('aria-label', 'KML features');
        this.nameInput = document.createElement('input');
        this.nameInput.placeholder = 'Feature name';
        this.descriptionInput = document.createElement('textarea');
        this.descriptionInput.placeholder = 'Feature description';
        this.message = document.createElement('p');
        this.message.setAttribute('role', 'alert');
        const picker = document.createElement('input');
        picker.type = 'file'; picker.accept = '.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz';
        picker.addEventListener('change', () => { const file = picker.files?.[0]; if (file) void this.openFile(file); });
        const apply = button('Apply properties', () => this.applyProperties());
        const focus = button('Focus selected', () => this.focusSelected());
        const remove = button('Delete selected', () => this.deleteSelected());
        const undo = button('Undo', () => this.store.undo());
        const redo = button('Redo', () => this.store.redo());
        sidebar.append(picker, this.message, document.createTextNode('Features'), this.list, this.nameInput, this.descriptionInput, apply, focus, remove, undo, redo);
        shell.append(sidebar, viewport);
        this.host.appendChild(shell);
        injectStyles();
        this.scene = new DesktopScene(viewport);
        this.registry = new FeatureSceneRegistry(this.scene.featureRoot, new RendererFactory());
        this.scene.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => this.pick(event));

        // Right-side vertical zoom slider overlay
        const zoomControl = document.createElement('div');
        zoomControl.className = 'kml-editor__zoom-control';
        zoomControl.innerHTML = `<span style="font-weight:bold;font-size:0.9rem;">+</span><input type="range" min="0.3" max="4.7" step="0.01" value="2.5" class="kml-editor__zoom-slider" title="Zoom in / out"><span style="font-weight:bold;font-size:0.9rem;">−</span>`;
        viewport.appendChild(zoomControl);

        const zoomSlider = zoomControl.querySelector('input') as HTMLInputElement;
        zoomSlider.addEventListener('input', () => {
            const val = Number(zoomSlider.value);
            const dist = Math.pow(10, 5.0 - val);
            this.scene.setZoomDistance(dist);
        });

        this.scene.controls.addEventListener('change', () => {
            const dist = this.scene.getZoomDistance();
            const logVal = Math.log10(Math.max(2, dist));
            zoomSlider.value = (5.0 - logVal).toFixed(2);
        });

        this.unsubscribe = this.store.subscribe((state) => {
            const features = state.featureOrder.map((id) => state.featuresById[id]).filter(Boolean);
            const container = (this.store as any).container;
            const assets = container ? container.getAssetProvider() : dummyAssetProvider;
            void this.render(features, assets, state.selectedFeatureId);
        });
    }

    public async openFile(file: File): Promise<void> {
        if (!/\.kml|\.kmz$/i.test(file.name)) { this.setMessage('Choose a .kml or .kmz file.'); return; }
        this.setMessage('Loading…');
        try {
            await this.store.loadFile(file);
            this.setMessage(`Loaded '${file.name}' successfully.`);
        }
        catch (error) { this.setMessage(error instanceof Error ? error.message : 'Could not load the file.'); }
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe?.(); this.unsubscribe = null;
        this.registry.dispose();
        this.scene.dispose();
        this.host.replaceChildren();
    }

    private async render(features: readonly IFeatureView[], assets: IAssetProvider, selected: FeatureId | null): Promise<void> {
        if (this.disposed) { this.list.replaceChildren(); return; }
        try { await this.registry.reconcile(features, assets, this.store.geoBridge); }
        catch (error) { this.setMessage(error instanceof Error ? `Preview warning: ${error.message}` : 'Preview warning.'); }
        this.list.replaceChildren(...features.map((feature) => {
            const item = document.createElement('li');
            const select = button(`${feature.type}: ${feature.name || '(unnamed)'}`, () => this.store.selectFeature(feature.id));
            select.setAttribute('aria-pressed', String(feature.id === selected));
            item.appendChild(select);
            return item;
        }));
        const active = selected ? features.find((feature) => feature.id === selected) ?? null : null;
        this.nameInput.value = active?.name ?? '';
        this.descriptionInput.value = active?.description ?? '';
    }

    private pick(event: PointerEvent): void {
        const canvas = this.scene.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, this.scene.camera);
        const hit = raycaster.intersectObjects(this.scene.featureRoot.children, true)[0];
        this.store.selectFeature(hit ? this.registry.findFeatureId(hit.object) : null);
    }

    private applyProperties(): void {
        const selected = this.store.selectedFeatureId;
        if (!selected) return;
        const feature = this.store.getState().featuresById[selected] ?? null;
        if (!feature) return;
        if (this.nameInput.value !== feature.name) this.store.executeCommand(createSetNameCommand(selected, this.nameInput.value));
        if (this.descriptionInput.value !== feature.description) this.store.executeCommand(createSetDescriptionCommand(selected, this.descriptionInput.value));
    }

    private focusSelected(): void {
        const selected = this.store.selectedFeatureId;
        if (!selected) {
            this.setMessage('Select a feature first to focus.');
            return;
        }
        const object = this.registry.getObject(selected);
        if (object) {
            this.scene.focusOn(object);
            this.setMessage('Focused camera on selected feature.');
        } else {
            this.setMessage('Feature object not found in 3D scene.');
        }
    }

    private deleteSelected(): void {
        const selected = this.store.selectedFeatureId;
        if (!selected) return;
        this.store.executeCommand(createDeleteFeatureCommand(selected));
        this.store.selectFeature(null);
    }

    private setMessage(value: string): void { this.message.textContent = value; }
}

export function mountEditor(host: HTMLElement): EditorApp { return new EditorApp(host); }

function button(label: string, onClick: () => void): HTMLButtonElement {
    const result = document.createElement('button');
    result.type = 'button'; result.textContent = label; result.addEventListener('click', onClick); return result;
}

function injectStyles(): void {
    if (document.getElementById('kml-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'kml-editor-styles';
    style.textContent = `
        .kml-editor__viewport { position: relative; min-width: 0; min-height: 0; }
        .kml-editor__zoom-control {
            position: absolute;
            right: 1.25rem;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
            background: rgba(16, 19, 26, 0.85);
            border: 1px solid #31405a;
            padding: 0.8rem 0.5rem;
            border-radius: 24px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            backdrop-filter: blur(8px);
            z-index: 10;
            color: #9ca3af;
            user-select: none;
        }
        .kml-editor__zoom-slider {
            writing-mode: bt-lr;
            -webkit-appearance: slider-vertical;
            appearance: slider-vertical;
            width: 18px;
            height: 180px;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);
}
