import type { IPersistenceService } from '../contracts/persistence';
import type { IKmzContainer } from '../contracts/kmz-container';
import type { IKmlDocument } from '../contracts/document-model';
import type { IGeoBridge } from '../contracts/geo-bridge';
import type { ICommandStack } from '../contracts/commands';

export enum LoadingState {
  Idle = 'idle',
  Loading = 'loading',
  Loaded = 'loaded',
  Error = 'error'
}

export interface StoreState {
  container: IKmzContainer | null;
  document: IKmlDocument | null;
  geoBridge: IGeoBridge | null;
  commandStack: ICommandStack | null;
  selectedFeatureId: string | null;
  loadingState: LoadingState;
  loadError: Error | null;
  persistenceService: IPersistenceService | null;
}
