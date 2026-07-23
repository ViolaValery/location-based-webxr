import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { IPersistenceService } from '../contracts/persistence';
import type { IKmzContainer } from '../contracts/kmz-container';
import type { IKmlDocument } from '../contracts/document-model';
import type { IGeoBridge } from '../contracts/geo-bridge';
import type { ICommandStack } from '../contracts/commands';
import { LoadingState, StoreState } from './types';

const initialState: StoreState = {
  container: null,
  document: null,
  geoBridge: null,
  commandStack: null,
  selectedFeatureId: null,
  loadingState: LoadingState.Idle,
  loadError: null,
  persistenceService: null,
};

const storeSlice = createSlice({
  name: 'store',
  initialState,
  reducers: {
    setLoadingState: (state, action: PayloadAction<LoadingState>) => {
      state.loadingState = action.payload;
    },
    setLoadError: (state, action: PayloadAction<Error | null>) => {
      state.loadError = action.payload;
    },
    setContainer: (state, action: PayloadAction<IKmzContainer | null>) => {
      state.container = action.payload;
    },
    setDocument: (state, action: PayloadAction<IKmlDocument | null>) => {
      state.document = action.payload;
    },
    setGeoBridge: (state, action: PayloadAction<IGeoBridge | null>) => {
      state.geoBridge = action.payload;
    },
    setCommandStack: (state, action: PayloadAction<ICommandStack | null>) => {
      state.commandStack = action.payload;
    },
    setSelectedFeatureId: (state, action: PayloadAction<string | null>) => {
      state.selectedFeatureId = action.payload;
    },
    setPersistenceService: (state, action: PayloadAction<IPersistenceService | null>) => {
      state.persistenceService = action.payload;
    },
    clearState: (state) => {
      state.container = null;
      state.document = null;
      state.geoBridge = null;
      state.commandStack = null;
      state.selectedFeatureId = null;
      state.loadingState = LoadingState.Idle;
      state.loadError = null;
    },
  },
});

export const {
  setLoadingState,
  setLoadError,
  setContainer,
  setDocument,
  setGeoBridge,
  setCommandStack,
  setSelectedFeatureId,
  setPersistenceService,
  clearState,
} = storeSlice.actions;

export default storeSlice.reducer;
