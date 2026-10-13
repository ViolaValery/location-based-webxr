/**
 * The desktop editor's open tour and its edits (M6 E2a): the shared rules
 * of the phone's object list (`object-edits.ts`) over the tour the page
 * opened, and a Save built by the phone's own Finish rules
 * (`finish-rebuild.ts`). Page-free: the page shows `model()`, calls the
 * edits, and downloads what `save()` returns.
 *
 * @see editor-session.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  TourCaptureSpots,
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { SignedTourManifest } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  captureSpotsForRebuild,
  finishedFileName,
  pendingAfterRebuild,
  rebuildFinishedTour,
} from "../finish-rebuild.js";
import {
  authoringObjects,
  deleteObject,
  moveObjectTo,
  pinTextEdit,
  undoDelete,
  upsertPlaced,
  type AuthoringObject,
} from "../object-edits.js";
import type { TourSession } from "../tour-session.js";
import { buildEditorModel, type EditorModel } from "./editor-model.js";

/** An edited or moved object (the editor places nothing new yet). */
interface EditorEntry {
  readonly object: TourObject;
}

export interface EditorSave {
  readonly blob: Blob;
  /** The opened file's name, made safe to save (the Finish's rule). */
  readonly filename: string;
  /** Entries visitors never read that the save left out. */
  readonly scanLeftOut: readonly string[];
  /** Why the recorded photos could not be placed, when they could not. */
  readonly notPlaced?: string;
}

export interface EditorSession {
  /** The tour as it stands with the edits, for the rail and the map. */
  model(): EditorModel;
  /** Edits and deletions not yet in a saved file. */
  changeCount(): number;
  editText(
    id: string,
    text: string,
  ): { kind: "edited" | "unchanged" } | { kind: "refused"; reason: string };
  /** Move a note on the map (its height and facing kept). */
  move(id: string, lat: number, lon: number): void;
  /** Delete; returns its undo. */
  remove(id: string): () => void;
  /** Build the saved zip from the newest bytes; edits made while it runs
   *  wait for the next save. */
  save(options: { readonly keepScan: boolean }): Promise<EditorSave>;
}

export function createEditorSession(input: {
  readonly session: TourSession;
  readonly manifest: TourManifest;
  readonly levels: ReadonlyMap<string, QrLevel>;
  /** The file's name for the model's title (default: the session's). */
  readonly fileName?: string;
}): EditorSession {
  const { session, levels } = input;
  let manifest = input.manifest;
  let placed: EditorEntry[] = [];
  let deleted: string[] = [];
  let previous: { blob: Blob; signedManifest?: SignedTourManifest } | null =
    null;
  /** The photo spots, decided once per open (a decline is not re-baked on
   *  every save, E1 review #11). */
  let spots: Promise<{ spots?: TourCaptureSpots; notPlaced?: string }> | null =
    null;
  /** The saved file's name: the opened one's, made safe (the Finish's rule). */
  const savedName = finishedFileName(session);
  /** The name the page shows when the tour has no title. */
  const shownName = input.fileName ?? savedName;

  function objects(): AuthoringObject<EditorEntry>[] {
    return authoringObjects(manifest.objects, placed, deleted);
  }

  function find(id: string): AuthoringObject<EditorEntry> {
    const found = objects().find((o) => o.object.id === id);
    if (found === undefined) throw new Error(`no object ${id} in the tour`);
    return found;
  }

  return {
    model() {
      return buildEditorModel({
        manifest: { ...manifest, objects: objects().map((o) => o.object) },
        levels,
        fileName: shownName,
      });
    },
    changeCount() {
      return placed.length + deleted.length;
    },
    editText(id, text) {
      const found = find(id);
      const edit = pinTextEdit(found.object, text);
      if (edit.kind === "edited") {
        placed = upsertPlaced(placed, { object: edit.after });
        return { kind: "edited" };
      }
      return edit;
    },
    move(id, lat, lon) {
      const found = find(id);
      placed = upsertPlaced(placed, {
        object: moveObjectTo(found.object, lat, lon),
      });
    },
    remove(id) {
      const gone = deleteObject({ placed, deleted }, find(id));
      placed = gone.placed;
      deleted = gone.deleted;
      return () => {
        const back = undoDelete({ placed, deleted }, gone.record);
        placed = back.placed;
        deleted = back.deleted;
      };
    },
    async save(options) {
      // Snapshots before the first await: an edit made from here on waits
      // for the next save (`pendingAfterRebuild`).
      const placedNow = [...placed];
      const deletedNow = [...deleted];
      const manifestNow = manifest;
      spots ??= captureSpotsForRebuild(session, manifestNow);
      const photos = await spots;
      const finished = await rebuildFinishedTour({
        tour: session,
        manifest: manifestNow,
        placed: placedNow,
        deleted: deletedNow,
        levels: [],
        keepScan: options.keepScan,
        ...(photos.spots === undefined ? {} : { captureSpots: photos.spots }),
        previous,
      });
      if (finished === null) throw new Error("the save was stopped");
      previous = {
        blob: finished.blob,
        ...(finished.signedManifest === undefined
          ? {}
          : { signedManifest: finished.signedManifest }),
      };
      manifest = finished.written;
      const pending = pendingAfterRebuild(
        { placed, deleted },
        finished.written,
        deletedNow,
      );
      placed = pending.placed;
      deleted = pending.deleted;
      return {
        blob: finished.blob,
        filename: savedName,
        scanLeftOut: finished.scanLeftOut,
        ...(photos.notPlaced === undefined
          ? {}
          : { notPlaced: photos.notPlaced }),
      };
    },
  };
}
