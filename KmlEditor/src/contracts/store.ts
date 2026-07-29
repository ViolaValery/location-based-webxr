import { FeatureId } from './type';
import { IFeatureView } from './document-model';
import { ICommand } from './commands';

export type EditMode = 'select' | 'move' | 'line-vertex' | 'overlay-transform' | 'model-transform';

export interface DeviceState {
    gpsPosition: { latitude: number; longitude: number; altitude: number } | null;
    heading: number | null;
    accuracy: number | null;
    isArActive: boolean;
}

/** Pure, serializable Redux store state */
export interface EditorState {
    readonly featuresById: Readonly<Record<FeatureId, IFeatureView>>;
    readonly featureOrder: readonly FeatureId[];
    readonly selectedFeatureId: FeatureId | null;
    readonly editMode: EditMode;
    readonly documentStatus: 'empty' | 'loading' | 'ready' | 'error';
    readonly device: DeviceState;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
}

export interface IEditorStore {
    /** Retreive current serializable state */
    getState(): EditorState;

    /** Feature selection */
    selectFeature(id: FeatureId | null): void;

    /** UI Edit Mode setter */
    setEditMode(mode: EditMode): void;

    /** Device / GPS state update */
    setDeviceState(state: Partial<DeviceState>): void;

    /** Execute edit command action */
    executeCommand(command: ICommand): void;

    /** Undo last edit action */
    undo(): void;

    /** Redo last undone action */
    redo(): void;

    /** Listener for state changes */
    subscribe(listener: (state: EditorState) => void): () => void;
}
