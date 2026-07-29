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
    release: () => {},
    getAssetBytes: async () => new Uint8Array(0),
    hasAsset: () => false,
    dispose: () => {},
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
        const remove = button('Delete selected', () => this.deleteSelected());
        const undo = button('Undo', () => this.store.undo());
        const redo = button('Redo', () => this.store.redo());
        sidebar.append(picker, this.message, document.createTextNode('Features'), this.list, this.nameInput, this.descriptionInput, apply, remove, undo, redo);
        shell.append(sidebar, viewport);
        this.host.appendChild(shell);
        this.scene = new DesktopScene(viewport);
        this.registry = new FeatureSceneRegistry(this.scene.featureRoot, new RendererFactory());
        this.scene.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => this.pick(event));
        
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
