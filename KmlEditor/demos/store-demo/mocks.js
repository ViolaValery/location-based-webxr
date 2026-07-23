// Mock implementations for store component demo

export class MockKmzContainer {
  constructor(kmlContent) {
    this.kmlContent = kmlContent;
    this.disposed = false;
  }

  getDocKml() {
    return this.kmlContent;
  }

  dispose() {
    this.disposed = true;
  }
}

export class MockGeoBridge {
  constructor() {
    this.anchor = null;
  }

  setAnchor(anchor) {
    this.anchor = anchor;
  }

  dispose() {
    // No-op for mock
  }
}

export class MockCommandStack {
  constructor(document, geoBridge) {
    this.document = document;
    this.geoBridge = geoBridge;
    this.history = [];
    this.cursor = -1;
  }

  execute(command) {
    command.execute(this.document, this.geoBridge);
    this.history.splice(this.cursor + 1);
    this.history.push(command);
    this.cursor = this.history.length - 1;
  }

  undo() {
    if (this.cursor < 0) return null;
    const command = this.history[this.cursor];
    command.undo(this.document, this.geoBridge);
    this.cursor--;
    return command;
  }

  redo() {
    if (this.cursor >= this.history.length - 1) return null;
    this.cursor++;
    const command = this.history[this.cursor];
    command.execute(this.document, this.geoBridge);
    return command;
  }

  dispose() {
    // No-op for mock
  }
}

export class MockPersistenceService {
  constructor() {
    this.changeCount = 0;
    this.flushCount = 0;
    this.disposed = false;
  }

  notifyChange() {
    this.changeCount++;
  }

  async flush(container) {
    this.flushCount++;
  }

  dispose() {
    this.disposed = true;
  }
}

// Mock command for testing
export class MockCommand {
  constructor(type, description) {
    this.type = type;
    this.description = description;
  }

  execute(document, geoBridge) {
    // No-op for mock
  }

  undo(document, geoBridge) {
    // No-op for mock
  }
}
