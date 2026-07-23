import { Store, LoadingState } from './store';
import { StoreError, DocumentNotLoadedError, LoadFailedError } from './errors';

export function createStore(persistenceService?: import('../contracts/persistence').IPersistenceService): Store {
  return new Store(persistenceService);
}

export { Store, LoadingState };
export { StoreError, DocumentNotLoadedError, LoadFailedError };
