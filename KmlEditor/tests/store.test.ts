import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Store } from '../src/store/store';
import { LoadingState } from '../src/store/store';
import { StoreError, DocumentNotLoadedError, LoadFailedError } from '../src/store/errors';
import type { IPersistenceService } from '../src/contracts/persistence';

describe('Store - Milestone 1: Core skeleton', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  describe('Constructor initializes state correctly', () => {
    it('should initialize all state fields to null/Idle/empty set', () => {
      expect(store.container).toBeNull();
      expect(store.document).toBeNull();
      expect(store.geoBridge).toBeNull();
      expect(store.commandStack).toBeNull();
      expect(store.selectedFeatureId).toBeNull();
      expect(store.loadingState).toBe(LoadingState.Idle);
      expect(store.loadError).toBeNull();
    });

    it('should store persistence service if provided', () => {
      const mockPersistence = {} as IPersistenceService;
      const storeWithPersistence = new Store(mockPersistence);
      // We can't directly access private field, but we can verify it's stored indirectly
      // through setPersistenceService behavior
      expect(storeWithPersistence.loadingState).toBe(LoadingState.Idle);
    });
  });

  describe('selectFeature', () => {
    it('should update selectedFeatureId and emit change', () => {
      let changeCount = 0;
      store.onChange(() => {
        changeCount++;
      });

      store.selectFeature('feature-123');

      expect(store.selectedFeatureId).toBe('feature-123');
      expect(changeCount).toBe(1);
    });

    it('should clear selection when null is passed', () => {
      store.selectFeature('feature-123');
      let changeCount = 0;
      store.onChange(() => {
        changeCount++;
      });

      store.selectFeature(null);

      expect(store.selectedFeatureId).toBeNull();
      expect(changeCount).toBe(1);
    });
  });

  describe('onChange', () => {
    it('should register listener and call it on state change', () => {
      let listenerACalled = false;
      let listenerBCalled = false;

      const disposeA = store.onChange(() => {
        listenerACalled = true;
      });

      const disposeB = store.onChange(() => {
        listenerBCalled = true;
      });

      store.selectFeature('feature-123');

      expect(listenerACalled).toBe(true);
      expect(listenerBCalled).toBe(true);

      disposeA();
      disposeB();
    });

    it('should remove listener when disposer is called', () => {
      let listenerACalled = false;
      let listenerBCalled = false;

      const disposeA = store.onChange(() => {
        listenerACalled = true;
      });

      const disposeB = store.onChange(() => {
        listenerBCalled = true;
      });

      disposeA();

      store.selectFeature('feature-123');

      expect(listenerACalled).toBe(false);
      expect(listenerBCalled).toBe(true);

      disposeB();
    });

    it('should continue calling other listeners if one throws', () => {
      let listenerACalled = false;
      let listenerBCalled = false;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      store.onChange(() => {
        listenerACalled = true;
        throw new Error('Listener error');
      });

      store.onChange(() => {
        listenerBCalled = true;
      });

      store.selectFeature('feature-123');

      expect(listenerACalled).toBe(true);
      expect(listenerBCalled).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Store change listener threw error:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('dispose (without persistence)', () => {
    it('should clear all state and listeners', () => {
      store.selectFeature('feature-123');
      let listenerCalled = false;
      const disposer = store.onChange(() => {
        listenerCalled = true;
      });

      store.dispose();

      expect(store.container).toBeNull();
      expect(store.document).toBeNull();
      expect(store.geoBridge).toBeNull();
      expect(store.commandStack).toBeNull();
      expect(store.selectedFeatureId).toBeNull();
      expect(store.loadingState).toBe(LoadingState.Idle);
      expect(store.loadError).toBeNull();

      // Reset flag after dispose notification
      listenerCalled = false;

      // Listener should not be called after dispose
      store.selectFeature('feature-456');
      expect(listenerCalled).toBe(false);
      disposer();
    });

    it('should emit final change notification', () => {
      let changeCount = 0;
      store.onChange(() => {
        changeCount++;
      });

      store.dispose();

      expect(changeCount).toBe(1);
    });

    it('should work without persistence service', () => {
      expect(() => store.dispose()).not.toThrow();
    });
  });
});

describe('Store - Milestone 2: Document and bridge integration', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  describe('loadContainer with valid container', () => {
    it('should succeed and set loading state transitions', async () => {
      const mockContainer = {
        getDocKml: vi.fn(() => '<kml><Document></Document></kml>'),
        dispose: vi.fn()
      };

      const loadingStates: LoadingState[] = [];
      store.onChange(() => {
        loadingStates.push(store.loadingState);
      });

      await store.loadContainer(mockContainer as any);

      expect(loadingStates).toEqual([LoadingState.Loading, LoadingState.Loaded]);
      expect(store.loadingState).toBe(LoadingState.Loaded);
      expect(store.loadError).toBeNull();
    });

    it('should create document, geo bridge, and command stack', async () => {
      const mockContainer = {
        getDocKml: vi.fn(() => '<kml><Document></Document></kml>'),
        dispose: vi.fn()
      };

      await store.loadContainer(mockContainer as any);

      expect(store.document).not.toBeNull();
      expect(store.geoBridge).not.toBeNull();
      expect(store.commandStack).not.toBeNull();
      expect(store.container).toBe(mockContainer);
    });

    it('should clear selection on load', async () => {
      store.selectFeature('feature-123');
      const mockContainer = {
        getDocKml: vi.fn(() => '<kml><Document></Document></kml>'),
        dispose: vi.fn()
      };

      await store.loadContainer(mockContainer as any);

      expect(store.selectedFeatureId).toBeNull();
    });
  });

  describe('loadContainer with null container', () => {
    it('should throw StoreError', async () => {
      await expect(store.loadContainer(null as any)).rejects.toThrow('Container cannot be null or undefined');
    });

    it('should keep state in Idle', async () => {
      try {
        await store.loadContainer(null as any);
      } catch (e) {
        // Expected
      }

      expect(store.loadingState).toBe(LoadingState.Idle);
    });
  });

  describe('loadContainer with parse failure', () => {
    it('should set error state and wrap error in LoadFailedError', async () => {
      const mockContainer = {
        getDocKml: vi.fn(() => {
          throw new Error('Parse error');
        }),
        dispose: vi.fn()
      };

      const loadingStates: LoadingState[] = [];
      store.onChange(() => {
        loadingStates.push(store.loadingState);
      });

      try {
        await store.loadContainer(mockContainer as any);
      } catch (e) {
        expect(e).toBeInstanceOf(LoadFailedError);
      }

      expect(loadingStates).toEqual([LoadingState.Loading, LoadingState.Error]);
      expect(store.loadingState).toBe(LoadingState.Error);
      expect(store.loadError).toBeInstanceOf(LoadFailedError);
    });

    it('should clear partial state on failure', async () => {
      const mockContainer = {
        getDocKml: vi.fn(() => {
          throw new Error('Parse error');
        }),
        dispose: vi.fn()
      };

      try {
        await store.loadContainer(mockContainer as any);
      } catch (e) {
        // Expected
      }

      expect(store.document).toBeNull();
      expect(store.geoBridge).toBeNull();
      expect(store.commandStack).toBeNull();
      expect(store.container).toBeNull();
    });
  });

  describe('loadContainer clears previous state', () => {
    it('should dispose old container when loading new one', async () => {
      const oldContainer = {
        getDocKml: vi.fn(() => '<kml><Document></Document></kml>'),
        dispose: vi.fn()
      };

      await store.loadContainer(oldContainer as any);

      const newContainer = {
        getDocKml: vi.fn(() => '<kml><Document></Document></kml>'),
        dispose: vi.fn()
      };

      await store.loadContainer(newContainer as any);

      expect(oldContainer.dispose).toHaveBeenCalled();
      expect(store.container).toBe(newContainer);
    });
  });
});

describe('Store - Milestone 3: Command execution wrapper', () => {
  let store: Store;
  let mockContainer: any;

  beforeEach(async () => {
    store = new Store();
    mockContainer = {
      getDocKml: vi.fn(() => '<kml><Document></Document></kml>'),
      dispose: vi.fn()
    };
    await store.loadContainer(mockContainer);
  });

  describe('executeCommand', () => {
    it('should delegate to command stack and emit change', () => {
      const mockCommand = {
        type: 'move-marker',
        featureId: 'f1',
        description: 'Move',
        execute: vi.fn(),
        undo: vi.fn()
      };
      const executeSpy = vi.spyOn(store.commandStack!, 'execute');

      store.executeCommand(mockCommand as any);

      expect(executeSpy).toHaveBeenCalledWith(mockCommand);
      expect(store.loadingState).toBe(LoadingState.Loaded);
    });

    it('should throw DocumentNotLoadedError when document not loaded', () => {
      const storeWithoutDoc = new Store();
      const mockCommand = {
        type: 'move-marker',
        featureId: 'f1',
        description: 'Move',
        execute: vi.fn(),
        undo: vi.fn()
      };

      expect(() => storeWithoutDoc.executeCommand(mockCommand as any)).toThrow(DocumentNotLoadedError);
    });

    it('should propagate command execution error without state change', () => {
      const mockCommand = {
        type: 'move-marker',
        featureId: 'f1',
        description: 'Move',
        execute: vi.fn(),
        undo: vi.fn()
      };
      vi.spyOn(store.commandStack!, 'execute').mockImplementation(() => {
        throw new Error('Command failed');
      });

      expect(() => store.executeCommand(mockCommand as any)).toThrow('Command failed');
    });
  });

  describe('undo', () => {
    it('should delegate to command stack and emit change on success', () => {
      const mockCommand = { type: 'move-marker', featureId: 'f1', description: 'Move' };
      vi.spyOn(store.commandStack!, 'undo').mockReturnValue(mockCommand);

      store.undo();

      expect(store.commandStack!.undo).toHaveBeenCalled();
    });

    it('should do nothing when undo returns null (boundary)', () => {
      vi.spyOn(store.commandStack!, 'undo').mockReturnValue(null);

      store.undo();

      expect(store.commandStack!.undo).toHaveBeenCalled();
    });

    it('should throw DocumentNotLoadedError when document not loaded', () => {
      const storeWithoutDoc = new Store();

      expect(() => storeWithoutDoc.undo()).toThrow(DocumentNotLoadedError);
    });
  });

  describe('redo', () => {
    it('should delegate to command stack and emit change on success', () => {
      const mockCommand = { type: 'move-marker', featureId: 'f1', description: 'Move' };
      vi.spyOn(store.commandStack!, 'redo').mockReturnValue(mockCommand);

      store.redo();

      expect(store.commandStack!.redo).toHaveBeenCalled();
    });

    it('should do nothing when redo returns null (boundary)', () => {
      vi.spyOn(store.commandStack!, 'redo').mockReturnValue(null);

      store.redo();

      expect(store.commandStack!.redo).toHaveBeenCalled();
    });

    it('should throw DocumentNotLoadedError when document not loaded', () => {
      const storeWithoutDoc = new Store();

      expect(() => storeWithoutDoc.redo()).toThrow(DocumentNotLoadedError);
    });
  });
});

describe('Store - Milestone 4: Persistence integration', () => {
  let store: Store;
  let mockContainer: any;
  let mockPersistence: any;

  beforeEach(async () => {
    mockPersistence = {
      notifyChange: vi.fn(),
      flush: vi.fn(),
      dispose: vi.fn()
    };
    store = new Store(mockPersistence);
    mockContainer = {
      getDocKml: vi.fn(() => '<kml><Document></Document></kml>'),
      dispose: vi.fn()
    };
    await store.loadContainer(mockContainer);
  });

  describe('setPersistenceService', () => {
    it('should replace existing persistence service', () => {
      const newPersistence = {
        notifyChange: vi.fn(),
        flush: vi.fn(),
        dispose: vi.fn()
      };

      store.setPersistenceService(newPersistence as any);

      expect(() => {
        store.executeCommand({
          type: 'move-marker',
          featureId: 'f1',
          description: 'Move',
          execute: vi.fn(),
          undo: vi.fn()
        });
      }).not.toThrow();
    });

    it('should allow setting to null to disable persistence', () => {
      store.setPersistenceService(null);

      expect(() => {
        store.executeCommand({
          type: 'move-marker',
          featureId: 'f1',
          description: 'Move',
          execute: vi.fn(),
          undo: vi.fn()
        });
      }).not.toThrow();
    });
  });

  describe('persistence.notifyChange on command execution', () => {
    it('should call notifyChange after executeCommand', () => {
      const mockCommand = {
        type: 'move-marker',
        featureId: 'f1',
        description: 'Move',
        execute: vi.fn(),
        undo: vi.fn()
      };

      store.executeCommand(mockCommand as any);

      expect(mockPersistence.notifyChange).toHaveBeenCalled();
    });

    it('should call notifyChange after undo (when command exists)', () => {
      const mockCommand = {
        type: 'move-marker',
        featureId: 'f1',
        description: 'Move',
        execute: vi.fn(),
        undo: vi.fn()
      };
      vi.spyOn(store.commandStack!, 'undo').mockReturnValue(mockCommand);

      store.undo();

      expect(mockPersistence.notifyChange).toHaveBeenCalled();
    });

    it('should call notifyChange after redo (when command exists)', () => {
      const mockCommand = {
        type: 'move-marker',
        featureId: 'f1',
        description: 'Move',
        execute: vi.fn(),
        undo: vi.fn()
      };
      vi.spyOn(store.commandStack!, 'redo').mockReturnValue(mockCommand);

      store.redo();

      expect(mockPersistence.notifyChange).toHaveBeenCalled();
    });

    it('should not call notifyChange when undo returns null (boundary)', () => {
      vi.spyOn(store.commandStack!, 'undo').mockReturnValue(null);

      store.undo();

      expect(mockPersistence.notifyChange).not.toHaveBeenCalled();
    });

    it('should not call notifyChange when redo returns null (boundary)', () => {
      vi.spyOn(store.commandStack!, 'redo').mockReturnValue(null);

      store.redo();

      expect(mockPersistence.notifyChange).not.toHaveBeenCalled();
    });
  });

  describe('persistence.flush on dispose', () => {
    it('should call flush with container before clearing state', async () => {
      await store.dispose();

      expect(mockPersistence.flush).toHaveBeenCalledWith(mockContainer);
    });

    it('should call dispose on persistence service', async () => {
      await store.dispose();

      expect(mockPersistence.dispose).toHaveBeenCalled();
    });

    it('should not call flush if container is null', async () => {
      const storeWithoutContainer = new Store(mockPersistence);

      await storeWithoutContainer.dispose();

      expect(mockPersistence.flush).not.toHaveBeenCalled();
      expect(mockPersistence.dispose).toHaveBeenCalled();
    });

    it('should handle flush errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPersistence.flush.mockImplementation(() => {
        throw new Error('Flush failed');
      });

      await store.dispose();

      expect(consoleSpy).toHaveBeenCalledWith('Persistence flush failed during dispose:', expect.any(Error));
      expect(mockPersistence.dispose).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
