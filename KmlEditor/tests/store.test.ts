import { describe, it, expect, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import {
  rootReducer,
  setContainer,
  setDocument,
  setGeoBridge,
  setCommandStack,
  setSelectedFeatureId,
  setLoadingState,
  setLoadError,
  setPersistenceService,
  undo,
  redo,
  jump,
  clearHistory,
  selectContainer,
  selectDocument,
  selectGeoBridge,
  selectCommandStack,
  selectCommandStackHistory,
  selectCanUndo,
  selectCanRedo,
  selectSelectedFeatureId,
  selectLoadingState,
  selectLoadError,
  selectPersistenceService,
} from "../src/store/store";
import type { IKmzContainer } from "../src/contracts/kmz-container";
import type { IKmlDocument } from "../src/contracts/document-model";
import type { IGeoBridge } from "../src/contracts/geo-bridge";
import type { ICommandStack } from "../src/contracts/commands";
import type { IPersistenceService } from "../src/contracts/persistence";

// The module only exports a pre-built singleton `store`. To keep tests
// isolated (esp. the undo/redo history), build a fresh store per test
// from the exported `rootReducer` instead of importing the singleton.
function createTestStore() {
  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
}

describe("store", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  describe("initial state", () => {
    it("should start with all fields at their defaults", () => {
      const state = store.getState();

      expect(selectContainer(state)).toBeNull();
      expect(selectDocument(state)).toBeNull();
      expect(selectGeoBridge(state)).toBeNull();
      expect(selectSelectedFeatureId(state)).toBeNull();
      expect(selectLoadingState(state)).toBe("idle");
      expect(selectLoadError(state)).toBeNull();
      expect(selectPersistenceService(state)).toBeNull();

      expect(selectCommandStack(state)).toBeNull();
      expect(selectCanUndo(state)).toBe(false);
      expect(selectCanRedo(state)).toBe(false);
    });
  });

  describe("plain field slices", () => {
    it("setContainer updates and clears the container", () => {
      const mockContainer = {} as IKmzContainer;

      store.dispatch(setContainer(mockContainer));
      expect(selectContainer(store.getState())).toBe(mockContainer);

      store.dispatch(setContainer(null));
      expect(selectContainer(store.getState())).toBeNull();
    });

    it("setDocument updates the document", () => {
      const mockDoc = {} as IKmlDocument;
      store.dispatch(setDocument(mockDoc));
      expect(selectDocument(store.getState())).toBe(mockDoc);
    });

    it("setGeoBridge updates the geo bridge", () => {
      const mockBridge = {} as IGeoBridge;
      store.dispatch(setGeoBridge(mockBridge));
      expect(selectGeoBridge(store.getState())).toBe(mockBridge);
    });

    it("setSelectedFeatureId updates and clears the selection", () => {
      store.dispatch(setSelectedFeatureId("feature-123"));
      expect(selectSelectedFeatureId(store.getState())).toBe("feature-123");

      store.dispatch(setSelectedFeatureId(null));
      expect(selectSelectedFeatureId(store.getState())).toBeNull();
    });

    it("setLoadingState transitions through states", () => {
      store.dispatch(setLoadingState("loading" as any));
      expect(selectLoadingState(store.getState())).toBe("loading");

      store.dispatch(setLoadingState("loaded" as any));
      expect(selectLoadingState(store.getState())).toBe("loaded");
    });

    it("setLoadError stores and clears an error", () => {
      const error = new Error("boom");
      store.dispatch(setLoadError(error));
      expect(selectLoadError(store.getState())).toBe(error);

      store.dispatch(setLoadError(null));
      expect(selectLoadError(store.getState())).toBeNull();
    });

    it("setPersistenceService updates and clears the service", () => {
      const mockPersistence = {} as IPersistenceService;
      store.dispatch(setPersistenceService(mockPersistence));
      expect(selectPersistenceService(store.getState())).toBe(mockPersistence);

      store.dispatch(setPersistenceService(null));
      expect(selectPersistenceService(store.getState())).toBeNull();
    });
  });

  describe("commandStack history (redux-undo)", () => {
    const stackA = { id: "A" } as unknown as ICommandStack;
    const stackB = { id: "B" } as unknown as ICommandStack;
    const stackC = { id: "C" } as unknown as ICommandStack;

    it("the first setCommandStack establishes the baseline present without a past entry", () => {
      // redux-undo quirk: the very first state change from the initial
      // value becomes the new baseline "present" directly, it does not
      // get pushed into `past`. History only starts accumulating from
      // the *second* change onward.
      store.dispatch(setCommandStack(stackA));
      expect(selectCommandStack(store.getState())).toBe(stackA);
      expect(selectCanUndo(store.getState())).toBe(false);
      expect(selectCanRedo(store.getState())).toBe(false);
    });

    it("setCommandStack pushes the previous present onto past from the second change onward", () => {
      store.dispatch(setCommandStack(stackA));
      store.dispatch(setCommandStack(stackB));

      expect(selectCommandStack(store.getState())).toBe(stackB);
      expect(selectCanUndo(store.getState())).toBe(true);
    });

    it("undo() steps present back and enables redo", () => {
      store.dispatch(setCommandStack(stackA));
      store.dispatch(setCommandStack(stackB));

      store.dispatch(undo());

      expect(selectCommandStack(store.getState())).toBe(stackA);
      expect(selectCanRedo(store.getState())).toBe(true);
    });

    it("redo() steps present forward again", () => {
      store.dispatch(setCommandStack(stackA));
      store.dispatch(setCommandStack(stackB));
      store.dispatch(undo());

      store.dispatch(redo());

      expect(selectCommandStack(store.getState())).toBe(stackB);
      expect(selectCanRedo(store.getState())).toBe(false);
    });

    it("undo() at the start of history is a no-op", () => {
      store.dispatch(undo());
      expect(selectCommandStack(store.getState())).toBeNull();
      expect(selectCanUndo(store.getState())).toBe(false);
    });

    it("redo() at the end of history is a no-op", () => {
      store.dispatch(setCommandStack(stackA));
      store.dispatch(redo());
      expect(selectCommandStack(store.getState())).toBe(stackA);
    });

    it("jump(-1) behaves like undo, jump(1) behaves like redo", () => {
      store.dispatch(setCommandStack(stackA));
      store.dispatch(setCommandStack(stackB));

      store.dispatch(jump(-1));
      expect(selectCommandStack(store.getState())).toBe(stackA);

      store.dispatch(jump(1));
      expect(selectCommandStack(store.getState())).toBe(stackB);
    });

    it("clearHistory() wipes past/future but keeps the current present", () => {
      store.dispatch(setCommandStack(stackA));
      store.dispatch(setCommandStack(stackB));
      store.dispatch(undo()); // present -> stackA, future -> [stackB]

      store.dispatch(clearHistory());

      const history = selectCommandStackHistory(store.getState());
      expect(history.past).toEqual([]);
      expect(history.future).toEqual([]);
      expect(selectCommandStack(store.getState())).toBe(stackA);
      expect(selectCanUndo(store.getState())).toBe(false);
      expect(selectCanRedo(store.getState())).toBe(false);
    });

    it("a new setCommandStack after undo() discards the redo future", () => {
      store.dispatch(setCommandStack(stackA));
      store.dispatch(setCommandStack(stackB));
      store.dispatch(undo()); // present -> stackA, future -> [stackB]

      store.dispatch(setCommandStack(stackC));

      expect(selectCommandStack(store.getState())).toBe(stackC);
      expect(selectCanRedo(store.getState())).toBe(false);
    });
  });
});
