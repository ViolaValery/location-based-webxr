/**
 * Tests for routingSlice — Redux state for application screen navigation.
 *
 * Why this test matters: Bug 2 (SPA architecture audit) — the navigation
 * module stored `currentScreen` as a module-level mutable variable
 * disconnected from Redux, causing desync on rapid transitions and
 * preventing time-travel debugging. This slice makes the current screen
 * part of the Redux store, the single source of truth.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-04-06-spa-architecture-audit.md — Bug 2
 */

import { describe, it, expect } from 'vitest';
import {
  routingReducer,
  navigateTo,
  type RoutingState,
  type AppScreen,
} from './routing-slice';

describe('routingSlice reducer', () => {
  it('has correct initial state with setup screen', () => {
    // Why: the app always starts on the setup screen
    const state = routingReducer(undefined, { type: '@@INIT' });
    expect(state.currentScreen).toBe('setup');
  });

  describe('navigateTo', () => {
    it('updates currentScreen to the target screen', () => {
      // Why: screen transitions must be reflected in Redux state
      const state = routingReducer(undefined, navigateTo('ar'));
      expect(state.currentScreen).toBe('ar');
    });

    it('supports all valid screen transitions', () => {
      // Why: all four screens must be representable in Redux state
      const screens: AppScreen[] = ['setup', 'ar', 'recording', 'summary'];
      for (const screen of screens) {
        const state = routingReducer(undefined, navigateTo(screen));
        expect(state.currentScreen).toBe(screen);
      }
    });

    it('overwrites previous screen on successive navigations', () => {
      // Why: only the latest screen matters (no history stack in Redux)
      let state: RoutingState = routingReducer(undefined, navigateTo('ar'));
      state = routingReducer(state, navigateTo('recording'));
      state = routingReducer(state, navigateTo('summary'));
      expect(state.currentScreen).toBe('summary');
    });

    it('allows navigating back to setup', () => {
      // Why: soft reset returns to setup via navigateTo('setup')
      let state: RoutingState = routingReducer(undefined, navigateTo('ar'));
      state = routingReducer(state, navigateTo('setup'));
      expect(state.currentScreen).toBe('setup');
    });
  });
});
