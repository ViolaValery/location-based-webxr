import { MockKmzContainer, MockGeoBridge, MockCommandStack, MockPersistenceService, MockCommand } from './mocks.js';

// Simplified Store implementation for demo (mimicking the real implementation)
class LoadingState {
  static Idle = 'idle';
  static Loading = 'loading';
  static Loaded = 'loaded';
  static Error = 'error';
}

class Store {
  constructor(persistenceService = null) {
    this._container = null;
    this._document = null;
    this._geoBridge = null;
    this._commandStack = null;
    this._selectedFeatureId = null;
    this._loadingState = LoadingState.Idle;
    this._loadError = null;
    this._persistenceService = persistenceService;
    this._listeners = new Set();
  }

  get container() { return this._container; }
  get document() { return this._document; }
  get geoBridge() { return this._geoBridge; }
  get commandStack() { return this._commandStack; }
  get selectedFeatureId() { return this._selectedFeatureId; }
  get loadingState() { return this._loadingState; }
  get loadError() { return this._loadError; }

  selectFeature(featureId) {
    this._selectedFeatureId = featureId;
    this._emitChange();
  }

  async loadContainer(container) {
    if (container === null || container === undefined) {
      throw new Error('Container cannot be null or undefined');
    }

    this._loadingState = LoadingState.Loading;
    this._loadError = null;
    this._clearState();
    this._emitChange();

    try {
      const kmlString = container.getDocKml();
      this._document = { xml: kmlString }; // Mock document
      this._container = container;

      this._geoBridge = new MockGeoBridge();
      this._geoBridge.setAnchor({ position: { lon: 0, lat: 0, alt: 0 }, heading: 0 });

      this._commandStack = new MockCommandStack(this._document, this._geoBridge);

      this._selectedFeatureId = null;
      this._loadingState = LoadingState.Loaded;
      this._emitChange();
    } catch (error) {
      this._loadingState = LoadingState.Error;
      this._loadError = error;
      this._clearState();
      this._emitChange();
      throw error;
    }
  }

  executeCommand(command) {
    if (this._loadingState !== LoadingState.Loaded || this._document === null) {
      throw new Error('Cannot perform operation: no document is loaded');
    }

    this._commandStack.execute(command);
    this._emitChange();

    if (this._persistenceService) {
      this._persistenceService.notifyChange();
    }
  }

  undo() {
    if (this._loadingState !== LoadingState.Loaded || this._document === null) {
      throw new Error('Cannot perform operation: no document is loaded');
    }

    const result = this._commandStack.undo();
    if (result !== null) {
      this._emitChange();
      if (this._persistenceService) {
        this._persistenceService.notifyChange();
      }
    }
  }

  redo() {
    if (this._loadingState !== LoadingState.Loaded || this._document === null) {
      throw new Error('Cannot perform operation: no document is loaded');
    }

    const result = this._commandStack.redo();
    if (result !== null) {
      this._emitChange();
      if (this._persistenceService) {
        this._persistenceService.notifyChange();
      }
    }
  }

  setPersistenceService(persistenceService) {
    this._persistenceService = persistenceService;
  }

  onChange(listener) {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  async dispose() {
    if (this._persistenceService) {
      try {
        if (this._container) {
          await this._persistenceService.flush(this._container);
        }
      } catch (error) {
        console.error('Persistence flush failed during dispose:', error);
      }
      this._persistenceService.dispose();
      this._persistenceService = null;
    }

    this._clearState();
    this._loadingState = LoadingState.Idle;
    this._loadError = null;
    this._emitChange();
    this._listeners.clear();
  }

  _clearState() {
    if (this._container) {
      this._container.dispose();
      this._container = null;
    }
    this._document = null;
    this._geoBridge = null;
    this._commandStack = null;
    this._selectedFeatureId = null;
  }

  _emitChange() {
    const listeners = Array.from(this._listeners);
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error('Store change listener threw error:', error);
      }
    }
  }
}

// Demo setup
const persistence = new MockPersistenceService();
const store = new Store(persistence);
let commandCount = 0;

// UI elements
const loadingStateEl = document.getElementById('loadingState');
const selectionStateEl = document.getElementById('selectionState');
const commandStateEl = document.getElementById('commandState');
const eventLogEl = document.getElementById('eventLog');

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  eventLogEl.appendChild(entry);
  eventLogEl.scrollTop = eventLogEl.scrollHeight;
}

function updateUI() {
  loadingStateEl.textContent = `Loading State: ${store.loadingState}`;
  selectionStateEl.textContent = `Selected: ${store.selectedFeatureId || 'null'}`;
  
  if (store.loadError) {
    loadingStateEl.textContent += ` (Error: ${store.loadError.message})`;
  }

  if (store.commandStack) {
    commandStateEl.textContent = `Commands: ${store.commandStack.history.length} executed, cursor at ${store.commandStack.cursor + 1}`;
  } else {
    commandStateEl.textContent = 'No commands executed';
  }
}

// Subscribe to store changes
store.onChange(() => {
  updateUI();
  log(`Store changed: state=${store.loadingState}, selected=${store.selectedFeatureId}`);
});

// Event handlers
document.getElementById('loadBtn').addEventListener('click', async () => {
  try {
    log('Loading container...', 'info');
    const container = new MockKmzContainer('<kml><Document><Placemark id="feature1"><name>Test Feature</name></Placemark></Document></kml>');
    await store.loadContainer(container);
    log('Container loaded successfully', 'success');
  } catch (error) {
    log(`Load failed: ${error.message}`, 'error');
  }
});

document.getElementById('loadErrorBtn').addEventListener('click', async () => {
  try {
    log('Loading container with error...', 'info');
    const container = new MockKmzContainer(null);
    await store.loadContainer(container);
  } catch (error) {
    log(`Load failed as expected: ${error.message}`, 'error');
  }
});

document.getElementById('disposeBtn').addEventListener('click', async () => {
  log('Disposing store...', 'info');
  await store.dispose();
  log('Store disposed', 'success');
});

document.getElementById('selectBtn').addEventListener('click', () => {
  const featureId = `feature-${Math.floor(Math.random() * 1000)}`;
  store.selectFeature(featureId);
  log(`Selected feature: ${featureId}`, 'success');
});

document.getElementById('clearSelectBtn').addEventListener('click', () => {
  store.selectFeature(null);
  log('Selection cleared', 'info');
});

document.getElementById('executeBtn').addEventListener('click', () => {
  try {
    commandCount++;
    const command = new MockCommand('move-marker', `Move marker ${commandCount}`);
    store.executeCommand(command);
    log(`Executed command: ${command.description}`, 'success');
  } catch (error) {
    log(`Command execution failed: ${error.message}`, 'error');
  }
});

document.getElementById('undoBtn').addEventListener('click', () => {
  try {
    store.undo();
    log('Undo performed', 'success');
  } catch (error) {
    log(`Undo failed: ${error.message}`, 'error');
  }
});

document.getElementById('redoBtn').addEventListener('click', () => {
  try {
    store.redo();
    log('Redo performed', 'success');
  } catch (error) {
    log(`Redo failed: ${error.message}`, 'error');
  }
});

document.getElementById('clearLogBtn').addEventListener('click', () => {
  eventLogEl.innerHTML = '';
  log('Log cleared', 'info');
});

// Initial UI update
updateUI();
log('Demo initialized', 'success');
