import {
  configureStore,
  createSlice,
  combineReducers,
  createSelector,
  PayloadAction,
} from "@reduxjs/toolkit";
import undoable, { ActionCreators as UndoActionCreators } from "redux-undo";
import { IKmzContainer, IKmlDocument, ICommandStack, IGeoBridge } from "types";
import { IPersistenceService } from "../contracts/persistence";

enum LoadingState {
  Idle = "idle",
  Loading = "loading",
  Loaded = "loaded",
  Error = "error",
}

// --- Slices ---

const containerSlice = createSlice({
  name: "container",
  initialState: null as IKmzContainer | null,
  reducers: {
    setContainer: (_state, action: PayloadAction<IKmzContainer | null>) =>
      action.payload,
  },
});

const documentSlice = createSlice({
  name: "document",
  initialState: null as IKmlDocument | null,
  reducers: {
    setDocument: (_state, action: PayloadAction<IKmlDocument | null>) =>
      action.payload,
  },
});

const geoBridgeSlice = createSlice({
  name: "geoBridge",
  initialState: null as IGeoBridge | null,
  reducers: {
    setGeoBridge: (_state, action: PayloadAction<IGeoBridge | null>) =>
      action.payload,
  },
});

const commandStackSlice = createSlice({
  name: "commandStack",
  initialState: null as ICommandStack | null,
  reducers: {
    setCommandStack: (_state, action: PayloadAction<ICommandStack | null>) =>
      action.payload,
  },
});

const selectedFeatureIdSlice = createSlice({
  name: "selectedFeatureId",
  initialState: null as string | null,
  reducers: {
    setSelectedFeatureId: (_state, action: PayloadAction<string | null>) =>
      action.payload,
  },
});

const loadingStateSlice = createSlice({
  name: "loadingState",
  initialState: LoadingState.Idle,
  reducers: {
    setLoadingState: (_state, action: PayloadAction<LoadingState>) =>
      action.payload,
  },
});

const loadErrorSlice = createSlice({
  name: "loadError",
  initialState: null as Error | null,
  reducers: {
    setLoadError: (_state, action: PayloadAction<Error | null>) =>
      action.payload,
  },
});

const persistenceServiceSlice = createSlice({
  name: "persistenceService",
  initialState: null as IPersistenceService | null,
  reducers: {
    setPersistenceService: (
      _state,
      action: PayloadAction<IPersistenceService | null>,
    ) => action.payload,
  },
});

// --- Root reducer ---

// redux-undo's config keys are "undoType" / "redoType" (not "undoActionType" / "redoActionType")
const UNDO_TYPE = "container/undo";
const REDO_TYPE = "container/redo";

const rootReducer = combineReducers({
  container: containerSlice.reducer,
  document: documentSlice.reducer,
  geoBridge: geoBridgeSlice.reducer,
  // redux-undo wraps this slice's state into { past, present, future }
  commandStack: undoable(commandStackSlice.reducer, {
    undoType: UNDO_TYPE,
    redoType: REDO_TYPE,
  }),
  selectedFeatureId: selectedFeatureIdSlice.reducer,
  loadingState: loadingStateSlice.reducer,
  loadError: loadErrorSlice.reducer,
  persistenceService: persistenceServiceSlice.reducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

// --- Types ---

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// --- Actions ---
// Actions live on each slice, not on the store itself (store.actions doesn't exist)

export const { setContainer } = containerSlice.actions;
export const { setDocument } = documentSlice.actions;
export const { setGeoBridge } = geoBridgeSlice.actions;
export const { setCommandStack } = commandStackSlice.actions;
export const { setSelectedFeatureId } = selectedFeatureIdSlice.actions;
export const { setLoadingState } = loadingStateSlice.actions;
export const { setLoadError } = loadErrorSlice.actions;
export const { setPersistenceService } = persistenceServiceSlice.actions;

// redux-undo's built-in action creators — dispatch these to step through history
// e.g. store.dispatch(undo())
export const { undo, redo, jump, clearHistory } = UndoActionCreators;

// --- Selectors ---

export const selectContainer = (state: RootState) => state.container;
export const selectDocument = (state: RootState) => state.document;
export const selectGeoBridge = (state: RootState) => state.geoBridge;

// commandStack is wrapped by redux-undo: { past: T[], present: T, future: T[] }
export const selectCommandStackHistory = (state: RootState) =>
  state.commandStack;

export const selectCommandStack = createSelector(
  selectCommandStackHistory,
  (history) => history.present,
);

export const selectCanUndo = createSelector(
  selectCommandStackHistory,
  (history) => history.past.length > 0,
);

export const selectCanRedo = createSelector(
  selectCommandStackHistory,
  (history) => history.future.length > 0,
);

export const selectSelectedFeatureId = (state: RootState) =>
  state.selectedFeatureId;
export const selectLoadingState = (state: RootState) => state.loadingState;
export const selectLoadError = (state: RootState) => state.loadError;
export const selectPersistenceService = (state: RootState) =>
  state.persistenceService;
