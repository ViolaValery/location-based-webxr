import type { IPersistenceService } from '../contracts/persistence';
import { StoreError, DocumentNotLoadedError, LoadFailedError } from './errors';
import { createKmlDocument } from '../document-model';
import { createGeoBridge } from '../geo-bridge';
import { createCommandStack } from '../commands';

export enum LoadingState {
  Idle = 'idle',
  Loading = 'loading',
  Loaded = 'loaded',
  Error = 'error'
}

export class Store {
  private _container: any = null;
  private _document: any = null;
  private _geoBridge: any = null;
  private _commandStack: any = null;
  private _selectedFeatureId: string | null = null;
  private _loadingState: LoadingState = LoadingState.Idle;
  private _loadError: Error | null = null;
  private _persistenceService: IPersistenceService | null = null;
  private _listeners: Set<() => void> = new Set();

  constructor(persistenceService?: IPersistenceService) {
    this._persistenceService = persistenceService || null;
  }

  get container(): any {
    return this._container;
  }

  get document(): any {
    return this._document;
  }

  get geoBridge(): any {
    return this._geoBridge;
  }

  get commandStack(): any {
    return this._commandStack;
  }

  get selectedFeatureId(): string | null {
    return this._selectedFeatureId;
  }

  get loadingState(): LoadingState {
    return this._loadingState;
  }

  get loadError(): Error | null {
    return this._loadError;
  }

  selectFeature(featureId: string | null): void {
    this._selectedFeatureId = featureId;
    this._emitChange();
  }

  async loadContainer(container: any): Promise<void> {
    if (container === null || container === undefined) {
      throw new StoreError('Container cannot be null or undefined');
    }

    this._loadingState = LoadingState.Loading;
    this._loadError = null;
    this._clearState();
    this._emitChange();

    try {
      const kmlString = container.getDocKml();
      const document = createKmlDocument();
      document.parse(kmlString);
      this._document = document;
      this._container = container;

      const geoBridge = createGeoBridge();
      geoBridge.setAnchor({ position: { lon: 0, lat: 0, alt: 0 }, heading: 0 });
      this._geoBridge = geoBridge;

      const commandStack = createCommandStack(this._document, this._geoBridge);
      this._commandStack = commandStack;

      this._selectedFeatureId = null;
      this._loadingState = LoadingState.Loaded;
      this._emitChange();
    } catch (error) {
      this._loadingState = LoadingState.Error;
      this._loadError = new LoadFailedError(error as Error);
      this._clearState();
      this._emitChange();
      throw this._loadError;
    }
  }

  private _validateDocumentLoaded(): void {
    if (this._loadingState !== LoadingState.Loaded || this._document === null) {
      throw new DocumentNotLoadedError();
    }
  }

  executeCommand(command: any): void {
    this._validateDocumentLoaded();

    this._commandStack!.execute(command);
    this._emitChange();

    if (this._persistenceService) {
      this._persistenceService.notifyChange();
    }
  }

  undo(): void {
    this._validateDocumentLoaded();

    const result = this._commandStack!.undo();
    if (result !== null) {
      this._emitChange();
      if (this._persistenceService) {
        this._persistenceService.notifyChange();
      }
    }
  }

  redo(): void {
    this._validateDocumentLoaded();

    const result = this._commandStack!.redo();
    if (result !== null) {
      this._emitChange();
      if (this._persistenceService) {
        this._persistenceService.notifyChange();
      }
    }
  }

  setPersistenceService(persistenceService: IPersistenceService | null): void {
    this._persistenceService = persistenceService;
  }

  onChange(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
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

  private _clearState(): void {
    if (this._container) {
      this._container.dispose();
      this._container = null;
    }
    this._document = null;
    this._geoBridge = null;
    if (this._commandStack) {
      this._commandStack = null;
    }
    this._selectedFeatureId = null;
  }

  private _emitChange(): void {
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
