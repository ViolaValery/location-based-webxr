/**
 * Reference Point Recovery Module
 *
 * Extracts full RefPointDefinition objects from ZIP files in a folder and
 * merges observations by ref point ID. Unlike ref-point-importer.ts (which
 * returns simplified ImportedRefPoint with only lat/lon), this module
 * preserves complete observation data (AR poses, GPS, timestamps) needed
 * for 3D display and OPFS restoration after browser data loss.
 *
 * Used by the recovery flow: when OPFS is empty after browser data clear,
 * this module reconstructs the full scenario-level ref point state from
 * session ZIPs so the user can continue recording with prior ref points visible.
 *
 * Uses @zip.js/zip.js for ZIP reading (same library as zip-export.ts
 * and ref-point-importer.ts).
 */

import type { RefPointDefinition } from './ref-point-loader';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  extractRefPointEntriesFromZip,
  isRefPointDefinitionShape,
  isZipFileName,
} from './ref-point-zip-helpers';

const log = createLogger('RefPointRecovery');

// ============================================================================
// Types
// ============================================================================

/**
 * Result of recovering ref point definitions from ZIP files.
 */
export interface RefPointRecoveryResult {
  /** Merged, deduplicated RefPointDefinition objects from all ZIPs */
  readonly definitions: RefPointDefinition[];
  /** Number of ZIP files successfully scanned */
  readonly zipFilesScanned: number;
  /** Error messages from failed ZIPs or malformed ref points */
  readonly errors: string[];
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate parsed JSON matches RefPointDefinition shape.
 * Looser than ref-point-loader's validator: accepts empty observations
 * (schema-valid, preserves identity) and doesn't require arPose/gpsPoint
 * validation on every observation (the importer's validator already checks
 * first obs structure).
 */
const isValidRefPointDefinition = isRefPointDefinitionShape;

// ============================================================================
// ZIP Processing
// ============================================================================

/**
 * Extract full RefPointDefinition objects from a single ZIP file.
 */
async function extractDefinitionsFromZip(
  zipBlob: Blob,
  zipFileName: string
): Promise<{ definitions: RefPointDefinition[]; errors: string[] }> {
  const { items, errors } = await extractRefPointEntriesFromZip(
    zipBlob,
    zipFileName,
    isValidRefPointDefinition,
    (def) => def
  );
  return { definitions: items, errors };
}

// ============================================================================
// Merge Logic
// ============================================================================

/**
 * Merge observations from multiple RefPointDefinitions with the same ID.
 * Deduplicates observations by sessionId + timestamp.
 * Uses earliest createdAt and first-encountered name.
 */
function mergeDefinitions(allDefs: RefPointDefinition[]): RefPointDefinition[] {
  const byId = new Map<
    string,
    { def: RefPointDefinition; seen: Set<string> }
  >();

  for (const def of allDefs) {
    let entry = byId.get(def.id);
    if (!entry) {
      entry = {
        def: {
          id: def.id,
          name: def.name,
          createdAt: def.createdAt,
          observations: [],
        },
        seen: new Set<string>(),
      };
      byId.set(def.id, entry);
    } else if (def.createdAt < entry.def.createdAt) {
      entry.def.createdAt = def.createdAt;
    }

    // Unified dedup: every observation (initial or merged) passes through seen
    for (const obs of def.observations) {
      const key = `${obs.sessionId}:${obs.timestamp}`;
      if (!entry.seen.has(key)) {
        entry.seen.add(key);
        entry.def.observations.push(obs);
      }
    }
  }

  // Sort by createdAt for deterministic output
  return Array.from(byId.values())
    .map((e) => e.def)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract full RefPointDefinition objects from all ZIPs in a folder,
 * merge observations by ref point ID, and return the merged definitions.
 *
 * Unlike importRefPointsFromFolder() which returns simplified ImportedRefPoint[],
 * this preserves full observation data (AR poses, GPS, timestamps) needed for
 * 3D display and OPFS recovery.
 *
 * @param folderHandle - Read-only directory handle from showDirectoryPicker
 * @returns Result containing merged definitions, scan count, and errors
 */
export async function recoverRefPointDefinitionsFromZips(
  folderHandle: FileSystemDirectoryHandle
): Promise<RefPointRecoveryResult> {
  const allDefinitions: RefPointDefinition[] = [];
  const allErrors: string[] = [];
  let zipFilesScanned = 0;

  log.info(`Recovery scan: ${folderHandle.name}`);

  try {
    for await (const entry of folderHandle.values()) {
      if (entry.kind !== 'file' || !isZipFileName(entry.name)) continue;

      log.debug(`Processing ZIP: ${entry.name}`);

      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        const { definitions, errors } = await extractDefinitionsFromZip(
          file,
          entry.name
        );

        zipFilesScanned++;
        allErrors.push(...errors);
        allDefinitions.push(...definitions);
      } catch (zipErr) {
        const errorMsg = `Failed to process ${entry.name}: ${(zipErr as Error).message}`;
        log.warn(errorMsg);
        allErrors.push(errorMsg);
      }
    }

    const merged = mergeDefinitions(allDefinitions);
    log.info(
      `Recovered ${merged.length} ref points from ${zipFilesScanned} ZIP files`
    );

    return {
      definitions: merged,
      zipFilesScanned,
      errors: allErrors,
    };
  } catch (err) {
    const errorMsg = `Failed to scan folder: ${(err as Error).message}`;
    log.error(errorMsg);
    return {
      definitions: mergeDefinitions(allDefinitions),
      zipFilesScanned,
      errors: [...allErrors, errorMsg],
    };
  }
}
