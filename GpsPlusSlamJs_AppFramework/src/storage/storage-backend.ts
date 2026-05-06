/**
 * StorageBackend Interface
 *
 * Abstraction over session lifecycle and action/frame/metadata persistence.
 * Decouples the store from the concrete OPFS implementation, enabling clean
 * testing (NullStorageBackend), replay mode, and composable backends
 * (e.g. ScenarioWrappingStorageBackend layering scenarios on top).
 *
 * See also: Finding F2 in docs/2026-02-15-replay-integration-test-review.md
 */

import type { SessionMetadata } from './opfs-storage';

export interface CreateSessionResult {
  sessionName: string;
}

/**
 * Contract for session lifecycle and recording persistence.
 *
 * Implementations:
 * - OpfsStorageBackend: production — flat sessions under OPFS
 * - NullStorageBackend: tests/replay — silent no-ops
 * - ScenarioWrappingStorageBackend (recorder): layers scenario hierarchy on top
 */
export interface StorageBackend {
  /** Create a new recording session. Returns the session name for reference. */
  createSession(
    timestamp: Date,
    contextTag?: string
  ): Promise<CreateSessionResult>;
  /** List all session names managed by this backend. */
  listSessions(): Promise<string[]>;
  /** Persist a Redux action as a numbered JSON file. */
  writeAction(action: unknown, index: number): Promise<void>;
  /** Persist a captured camera frame as a numbered JPEG. */
  writeFrame(blob: Blob, index: number): Promise<void>;
  /** Persist session metadata (session.json). */
  writeSessionMetadata(metadata: SessionMetadata): Promise<void>;
}
