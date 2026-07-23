import { createSlice, configureStore, PayloadAction } from '@reduxjs/toolkit';
import { IKmlDocument } from '../contracts/document-model';
import { IKmzContainer } from '../contracts/kmz-container';
import { FeatureId } from '../contracts/type';

/** Redux State definition */
export interface EditorReduxState {
    document: IKmlDocument | null;
    container: IKmzContainer | null;
    selectedFeatureId: FeatureId | null;
    version: number;
}

/** Initial state constant */
export const initialEditorState: EditorReduxState = {
    document: null,
    container: null,
    selectedFeatureId: null,
    version: 0,
};

/**
 * Redux Toolkit Slice generating state, action creators, and reducer logic
 */
const editorSlice = createSlice({
    name: 'editor',
    initialState: initialEditorState,
    reducers: {
        loadFileSuccess(state, action: PayloadAction<{ document: IKmlDocument; container: IKmzContainer }>) {
            // RTK uses Immer under the hood, enabling direct mutations safely
            state.document = action.payload.document;
            state.container = action.payload.container;
            state.selectedFeatureId = null;
            state.version += 1;
        },
        selectFeature(state, action: PayloadAction<FeatureId | null>) {
            state.selectedFeatureId = action.payload;
        },
        mutateDocument(state) {
            state.version += 1;
        },
        resetStore(state) {
            state.document = null;
            state.container = null;
            state.selectedFeatureId = null;
            state.version += 1;
        },
    },
});

export const { loadFileSuccess, selectFeature, mutateDocument, resetStore } = editorSlice.actions;
export const editorReducer = editorSlice.reducer;

/**
 * Configures the Redux Toolkit store.
 * Note: Disable serializabilityCheck middleware since we are storing class instances
 * (IKmlDocument, IKmzContainer) containing methods and non-serializable fields.
 */
export function createReduxStore() {
    return configureStore({
        reducer: editorReducer,
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                serializableCheck: false,
            }),
    });
}
