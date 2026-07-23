export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

export class DocumentNotLoadedError extends StoreError {
  constructor() {
    super('Cannot perform operation: no document is loaded. Call loadContainer() first.');
    this.name = 'DocumentNotLoadedError';
  }
}

export class LoadFailedError extends StoreError {
  cause: Error;

  constructor(cause: Error) {
    super(`Failed to load document: ${cause.message}`);
    this.name = 'LoadFailedError';
    this.cause = cause;
  }
}
