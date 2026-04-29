/**
 * File System Storage Module
 *
 * Previously used the File System Access API (showDirectoryPicker), but this
 * had a critical limitation on Android Chrome where createWritable() fails
 * with NoModificationAllowedError.
 *
 * Now uses OPFS (Origin Private File System) which works consistently across
 * Desktop Chrome, Android Chrome, and iOS Safari.
 *
 * This module maintains the same public API for backwards compatibility but
 * delegates to the opfs-storage module for actual storage operations.
 */

import type { LatLongAlt } from 'gps-plus-slam-js';
import type { ArPoseTuples } from '../types/ar-types';
import { createLogger } from '../utils/logger';
import { setFileSystemState } from '../sensors/permission-checker';
import {
  initOpfsStorage,
  createSession as createOpfsSession,
  writeAction as opfsWriteAction,
  writeFrame as opfsWriteFrame,
  writeSessionMetadata as opfsWriteSessionMetadata,
  listScenarios as opfsListScenarios,
  getScenarioHandle,
  getScenariosRootHandle,
  resetOpfsStorage,
  resetSessionHandles,
  type SessionMetadata,
} from './opfs-storage';

const log = createLogger('Storage');

// Track current session info for backwards compatibility
let _currentScenarioName: string | null = null;
let _currentSessionName: string | null = null;
let storageInitialized = false;

/**
 * Reset module state - exported for testing only
 * @internal
 */
export function resetStorageState(): void {
  _currentScenarioName = null;
  _currentSessionName = null;
  storageInitialized = false;
  resetOpfsStorage();
}

/**
 * Reset session-level state for a new recording.
 *
 * Clears scenario/session names and OPFS session handles, but preserves
 * `storageInitialized` and the OPFS root so `initStorage()` doesn't need
 * to be called again.
 *
 * Used during soft reset for new recordings (Issue 4, 2026-02-06 user feedback).
 */
export function resetForNewSession(): void {
  _currentScenarioName = null;
  _currentSessionName = null;
  resetSessionHandles();
}

/**
 * Result of write access verification.
 */
export interface WriteAccessResult {
  /** Whether write access was successfully verified */
  success: boolean;
  /** Error message if write verification failed */
  error?: string;
}

/**
 * Verify that we have actual write access to a directory.
 *
 * This probes the directory by creating a test file, writing content,
 * and cleaning up. This catches cases where showDirectoryPicker grants
 * a handle but the underlying file system is read-only.
 *
 * User Feedback Issue #1: Even with mode: 'readwrite', Android can
 * return a handle where getFileHandle({create: true}) succeeds but
 * createWritable() fails with NoModificationAllowedError.
 *
 * @param dirHandle - Directory handle to verify
 * @returns Success status and optional error message
 */
export async function verifyWriteAccess(
  dirHandle: FileSystemDirectoryHandle
): Promise<WriteAccessResult> {
  const testFilename = `.write-test-${Date.now()}`;

  try {
    // Step 1: Create a test file
    const fileHandle = await dirHandle.getFileHandle(testFilename, {
      create: true,
    });

    // Step 2: Attempt to write content (this is where read-only fails)
    const writable = await fileHandle.createWritable();
    await writable.write('write-test');
    await writable.close();

    // Step 3: Clean up (non-critical if this fails)
    try {
      await dirHandle.removeEntry(testFilename);
    } catch (cleanupErr) {
      log.warn('Write test cleanup failed (non-critical):', cleanupErr);
    }

    log.info('Write access verified for:', dirHandle.name);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Write verification failed:', error);

    // Provide user-friendly error based on error type
    if (error.name === 'NoModificationAllowedError') {
      return {
        success: false,
        error:
          'Folder is read-only. Please select a different folder with write access.',
      };
    }

    return {
      success: false,
      error: `Cannot write to folder: ${error.message}`,
    };
  }
}

/**
 * Initialize storage using OPFS.
 *
 * This replaces the old showDirectoryPicker approach which failed on Android Chrome.
 * OPFS is automatically available and doesn't require user folder selection.
 *
 * @returns List of existing scenario folder names
 * @throws Error if OPFS is not supported
 */
export async function initStorage(): Promise<string[]> {
  try {
    await initOpfsStorage();
    storageInitialized = true;

    // Update permission state to reflect successful init
    setFileSystemState({
      folderSelected: true,
      writeVerified: true,
    });

    // Get existing scenarios
    const scenarios = await opfsListScenarios();
    log.info('OPFS storage initialized, found scenarios:', scenarios);

    return scenarios;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('OPFS initialization failed:', error);

    setFileSystemState({
      folderSelected: false,
      writeVerified: false,
      writeError: error.message,
    });

    throw error;
  }
}

/**
 * Create or open a scenario folder, then create a new session folder.
 *
 * Now uses OPFS backend instead of showDirectoryPicker.
 *
 * @param scenarioName - Name of the scenario
 */
export async function startSession(
  scenarioName: string
): Promise<{ scenarioPath: string; sessionPath: string }> {
  if (!storageInitialized) {
    throw new Error('Storage not initialized. Call initStorage first.');
  }

  const result = await createOpfsSession(scenarioName, new Date());

  _currentScenarioName = result.scenarioName;
  _currentSessionName = result.sessionName;

  log.info('Session started:', `${result.scenarioName}/${result.sessionName}`);

  return {
    scenarioPath: result.scenarioName,
    sessionPath: result.sessionName,
  };
}

/**
 * Write a Redux action to OPFS as a JSON file.
 */
export async function writeAction(
  action: unknown,
  index: number
): Promise<void> {
  await opfsWriteAction(action, index);
}

/**
 * Write a captured frame image to OPFS.
 */
export async function writeFrame(blob: Blob, index: number): Promise<void> {
  await opfsWriteFrame(blob, index);
}

/**
 * Write session metadata (session.json) to OPFS.
 * Contains timing, counts, and user agent for the recording session.
 */
export async function writeSessionMetadata(
  metadata: SessionMetadata
): Promise<void> {
  await opfsWriteSessionMetadata(metadata);
}

/**
 * Shape of a parsed action file for type safety
 */
interface ParsedRefPointAction {
  type: string;
  payload: {
    id: string;
    gpsPosition?: LatLongAlt;
    arPose?: ArPoseTuples;
  };
}

/**
 * Type guard for reference point actions
 * Exported for testing
 */
export function isRefPointAction(
  action: unknown
): action is ParsedRefPointAction {
  if (typeof action !== 'object' || action === null) {
    return false;
  }
  const obj = action as Record<string, unknown>;
  const payload = obj.payload;
  return (
    obj.type === 'recorder/markRefPoint' &&
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload)
  );
}

/**
 * Parse action files from a session's actions directory
 */
async function parseSessionRefPoints(
  actionsDir: FileSystemDirectoryHandle,
  sessionName: string
): Promise<RefPointRecord[]> {
  const refPoints: RefPointRecord[] = [];

  for await (const actionEntry of actionsDir.values()) {
    if (actionEntry.kind !== 'file' || !actionEntry.name.endsWith('.json')) {
      continue;
    }

    const fileHandle = await actionsDir.getFileHandle(actionEntry.name);
    const file = await fileHandle.getFile();
    const text = await file.text();

    try {
      const action: unknown = JSON.parse(text);
      if (isRefPointAction(action)) {
        refPoints.push({
          id: action.payload.id,
          sessionName,
          gpsPosition: action.payload.gpsPosition,
          arPose: action.payload.arPose,
        });
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return refPoints;
}

/**
 * Load existing reference points from a scenario (across all sessions).
 * Now uses OPFS storage backend.
 */
export async function loadScenarioRefPoints(
  scenarioName: string
): Promise<RefPointRecord[]> {
  const scenariosRoot = getScenariosRootHandle();
  if (!scenariosRoot) {
    return [];
  }

  const refPoints: RefPointRecord[] = [];

  try {
    const scenarioHandle = await scenariosRoot.getDirectoryHandle(scenarioName);

    // Iterate through all session folders
    for await (const sessionEntry of scenarioHandle.values()) {
      if (sessionEntry.kind !== 'directory') {
        continue;
      }

      const sessionHandle = await scenarioHandle.getDirectoryHandle(
        sessionEntry.name
      );

      // Look for actions folder
      let actionsDir: FileSystemDirectoryHandle;
      try {
        actionsDir = await sessionHandle.getDirectoryHandle('actions');
      } catch {
        continue; // No actions folder
      }

      // Parse reference points from this session
      const sessionRefPoints = await parseSessionRefPoints(
        actionsDir,
        sessionEntry.name
      );
      refPoints.push(...sessionRefPoints);
    }
  } catch {
    // Scenario doesn't exist yet
  }

  return refPoints;
}

/**
 * Get the current scenario handle (for loading prior sessions).
 * Now delegates to OPFS storage backend.
 */
export function getCurrentScenarioHandle(): FileSystemDirectoryHandle | null {
  return getScenarioHandle();
}

/**
 * Set the current scenario handle (when user selects a scenario).
 * With OPFS, we just store the name - the actual handle is retrieved when needed.
 */
export async function setCurrentScenario(
  scenarioName: string
): Promise<FileSystemDirectoryHandle | null> {
  const scenariosRoot = getScenariosRootHandle();
  if (!scenariosRoot) {
    return null;
  }

  try {
    const handle = await scenariosRoot.getDirectoryHandle(scenarioName);
    _currentScenarioName = scenarioName;
    return handle;
  } catch {
    log.warn('Scenario not found:', scenarioName);
    return null;
  }
}

/**
 * Ensure a scenario directory exists in OPFS, creating it if necessary.
 * Used during OPFS recovery when the scenario directory was lost but ZIP
 * data is available for restoration.
 *
 * Unlike setCurrentScenario() which only reads, this creates on demand.
 */
export async function ensureScenarioDirectory(
  scenarioName: string
): Promise<FileSystemDirectoryHandle | null> {
  const scenariosRoot = getScenariosRootHandle();
  if (!scenariosRoot) {
    return null;
  }

  try {
    const handle = await scenariosRoot.getDirectoryHandle(scenarioName, {
      create: true,
    });
    _currentScenarioName = scenarioName;
    return handle;
  } catch (err) {
    log.error('Failed to create scenario directory:', err);
    return null;
  }
}

/**
 * Reference point record from prior sessions
 */
export interface RefPointRecord {
  id: string;
  sessionName: string;
  gpsPosition?: LatLongAlt;
  arPose?: ArPoseTuples;
}
