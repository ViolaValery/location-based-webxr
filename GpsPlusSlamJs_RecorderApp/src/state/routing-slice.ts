/**
 * Routing Slice — Redux state for current application screen.
 *
 * Recorder-only routing state. The framework intentionally does not impose a
 * routing pattern; apps that don't need a `'setup' → 'ar' → 'recording' →
 * 'summary'` flow can compose their own slice (or skip Redux routing
 * entirely) via `createSlamAppStore`'s `extraReducers` seam.
 *
 * Moved here from the AppFramework as part of Iter 1 of the
 * AppFramework / RecorderApp boundary migration ([plan](../../../../GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md)).
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-04-06-spa-architecture-audit.md — Bug 2
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

/** Application screen states for history-based navigation. */
export type AppScreen = 'setup' | 'ar' | 'recording' | 'summary';

export interface RoutingState {
  currentScreen: AppScreen;
}

const initialState: RoutingState = {
  currentScreen: 'setup',
};

const routingSlice = createSlice({
  name: 'routing',
  initialState,
  reducers: {
    navigateTo(state, action: PayloadAction<AppScreen>) {
      state.currentScreen = action.payload;
    },
  },
});

export const { navigateTo } = routingSlice.actions;
export const routingReducer = routingSlice.reducer;
