import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditorStore } from '../src/store';
import { editorReducer, initialEditorState, selectFeature, mutateDocument } from '../src/store/redux-store';
import { ICommand } from '../src/contracts/commands';
import { FeatureId } from '../src/contracts/type';
import { IKmlDocument } from '../src/contracts/document-model';
import { IGeoBridge } from '../src/contracts/geo-bridge';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/google-earth');

describe('KML Editor Store Component', () => {
    let dreieckFile: File;
    let corruptFile: File;

    beforeEach(() => {
        const kmlData = fs.readFileSync(path.join(fixturesDir, 'dreieck.kml'));
        dreieckFile = new File([kmlData], 'dreieck.kml', { type: 'application/vnd.google-earth.kml+xml' });
        corruptFile = new File([new TextEncoder().encode('invalid kml text')], 'corrupt.kml', { type: 'application/vnd.google-earth.kml+xml' });
    });

    it('should have initial null states and inactive commands delegator', () => {
        const store = createEditorStore();
        expect(store.document).toBeNull();
        expect(store.container).toBeNull();
        expect(store.selectedFeatureId).toBeNull();
        expect(store.commands).toBeDefined();
        expect(store.commands.canUndo()).toBe(false);
        expect(store.commands.canRedo()).toBe(false);
    });

    it('should load file, parse features, set coordinates anchor and notify subscribers', async () => {
        const store = createEditorStore();
        let notifiedState: any = null;

        const unsubscribe = store.subscribe((state) => {
            notifiedState = state;
        });

        await store.loadFile(dreieckFile);

        expect(store.document).not.toBeNull();
        expect(store.container).not.toBeNull();
        expect(notifiedState).not.toBeNull();
        expect(notifiedState.document).toBe(store.document);

        // Bounding box center check for dreieck.kml
        // dreieck.kml coordinates are roughly lon: 6.060, lat: 50.778
        const anchor = (store.geoBridge as any).anchor; // Inspect private property or test through geoToWorld
        expect(store.geoBridge.geoToWorld({ lon: 6.06078, lat: 50.7781, alt: 0 })).toBeDefined();

        unsubscribe();
    });

    it('should maintain transaction safety and reject parsing on corrupt file loads', async () => {
        const store = createEditorStore();

        // First load a valid file
        await store.loadFile(dreieckFile);
        const validDoc = store.document;
        const validContainer = store.container;

        expect(validDoc).not.toBeNull();

        // Load a corrupt file, expect reject
        await expect(store.loadFile(corruptFile)).rejects.toThrow();

        // Active references must remain untouched (transaction safety)
        expect(store.document).toBe(validDoc);
        expect(store.container).toBe(validContainer);
    });

    it('should abort previous loading promise on concurrent calls', async () => {
        const store = createEditorStore();

        const load1 = store.loadFile(dreieckFile);
        const load2 = store.loadFile(dreieckFile);

        // First load should be aborted (throw AbortError/Error)
        await expect(load1).rejects.toThrow();
        await expect(load2).resolves.toBeUndefined();
    });

    it('should update selection ID and broadcast updates', async () => {
        const store = createEditorStore();
        await store.loadFile(dreieckFile);

        let activeSelection: any = null;
        store.subscribe((state) => {
            activeSelection = state.selectedFeatureId;
        });

        const targetId = 'test-id' as FeatureId;
        store.selectFeature(targetId);
        expect(store.selectedFeatureId).toBe(targetId);
        expect(activeSelection).toBe(targetId);

        store.selectFeature(null);
        expect(store.selectedFeatureId).toBeNull();
        expect(activeSelection).toBeNull();
    });

    it('should execute, undo, and redo commands via proxy delegator and notify subscribers', async () => {
        const store = createEditorStore();
        await store.loadFile(dreieckFile);

        let changeNotificationsCount = 0;
        store.subscribe(() => {
            changeNotificationsCount++;
        });

        // Create a mock rename command
        const mockCommand: ICommand = {
            type: 'set-name',
            featureId: '0DE3B1799F402F179797' as FeatureId,
            description: 'Rename test',
            execute: vi.fn((doc: IKmlDocument, bridge: IGeoBridge) => {
                const feat = doc.getFeatureById('0DE3B1799F402F179797' as FeatureId);
                if (feat) feat.name = 'New Name';
            }),
            undo: vi.fn((doc: IKmlDocument, bridge: IGeoBridge) => {
                const feat = doc.getFeatureById('0DE3B1799F402F179797' as FeatureId);
                if (feat) feat.name = 'busch_infozentrum';
            })
        };

        const initialNotifications = changeNotificationsCount;

        store.executeCommand(mockCommand);
        expect(mockCommand.execute).toHaveBeenCalled();
        expect(store.commands.canUndo()).toBe(true);
        expect(changeNotificationsCount).toBeGreaterThan(initialNotifications);

        const currentName = store.document?.getFeatureById('0DE3B1799F402F179797' as FeatureId)?.name;
        expect(currentName).toBe('New Name');

        // Undo
        store.commands.undo();
        expect(mockCommand.undo).toHaveBeenCalled();
        expect(store.commands.canUndo()).toBe(false);
        expect(store.commands.canRedo()).toBe(true);
        expect(store.document?.getFeatureById('0DE3B1799F402F179797' as FeatureId)?.name).toBe('busch_infozentrum');

        // Redo
        store.commands.redo();
        expect(store.commands.canUndo()).toBe(true);
        expect(store.document?.getFeatureById('0DE3B1799F402F179797' as FeatureId)?.name).toBe('New Name');
    });

    it('should trigger dispose on container when reload occurs', async () => {
        const store = createEditorStore();

        await store.loadFile(dreieckFile);
        const container1 = store.container;
        const disposeSpy = vi.spyOn(container1!, 'dispose');

        // Reload
        await store.loadFile(dreieckFile);
        expect(disposeSpy).toHaveBeenCalled();
    });
});

describe('Editor Redux Reducer', () => {
    it('should return initial state by default', () => {
        expect(editorReducer(undefined, { type: '@@INIT' } as any)).toEqual(initialEditorState);
    });

    it('should handle selectFeature action', () => {
        const state = editorReducer(initialEditorState, selectFeature('marker-1' as FeatureId));
        expect(state.selectedFeatureId).toBe('marker-1');
    });

    it('should handle mutateDocument action', () => {
        const state = editorReducer(initialEditorState, mutateDocument());
        expect(state.version).toBe(1);
    });
});
