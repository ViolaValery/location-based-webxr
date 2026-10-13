/**
 * The Finish's rules, page-free (M6 E0, B10's "shared business logic",
 * root CLAUDE.md DEC-H3): from an open tour and the edits to it, the
 * finished zip - the manifest with the edits applied, the files to write
 * and to remove, a listed tour's series continued, rebuilt from the NEWEST
 * bytes. The phone's Finish (`creator-finish.ts`) and the desktop editor
 * call this one module; the page state around it (progress, the hand-off,
 * the session's end) stays with each page.
 *
 * @see finish-rebuild.ts.md
 */

import { TOUR_MANIFEST_ENTRY } from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  serializeTourManifest,
  type TourCaptureSpots,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  serializeSignedTourManifest,
  signedManifestFilesOf,
  successorManifest,
  type SignedTourManifest,
  type TourFileRecord,
} from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { rebuildZipWithEntries } from "gps-plus-slam-app-framework/storage";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";
import {
  applyObjectChanges,
  contentEntriesToRemove,
} from "./authoring-draft.js";
import type { LevelText } from "./code-book.js";
import { finishEntries, type FinishEntry } from "./finish-entries.js";
import { scanEntryNames } from "./tour-read-set.js";
import type { TourSession } from "./tour-session.js";

/** The open tour, as far as a rebuild reads it. */
export type FinishTour = Pick<
  TourSession,
  "entries" | "manifestWrap" | "integrity" | "budget" | "readWholeArchive"
>;

/** A previous rebuild of the same open tour: the newest bytes. */
export interface PreviousFinish {
  readonly blob: Blob;
  readonly signedManifest?: SignedTourManifest;
}

export interface FinishInput {
  readonly tour: FinishTour;
  /** The manifest the tour carries now (after any earlier rebuild). */
  readonly manifest: TourManifest;
  /** Objects placed or edited, each replacing its id's record; a photo
   *  with bytes writes them as its content file. Read synchronously at the
   *  call, before the first await: pass a snapshot, never a list the page
   *  keeps changing (E0 review #6). */
  readonly placed: readonly {
    readonly object: TourObject;
    readonly blob?: Blob;
  }[];
  /** Ids to delete; a deleted photo takes its content file with it. */
  readonly deleted: readonly string[];
  /** The code levels to write, in order. */
  readonly levels: readonly LevelText[];
  /** The tour's name as typed; one that says something becomes `title`. */
  readonly title?: string | null;
  /** The recorded photos' spots, when the tour has them. */
  readonly captureSpots?: TourCaptureSpots;
  /** Keep the entries visitors never read (the walk, S-D10). */
  readonly keepScan: boolean;
  /** The last rebuild of this open tour; null or absent for the first,
   *  which reads the tour and inflates it under its budget. */
  readonly previous?: PreviousFinish | null;
  /** The clock for the series version's `createdAt`. */
  readonly now?: () => Date;
  /** False once the caller no longer wants the result (the tour was
   *  closed meanwhile): checked after the read, before the rebuild. */
  readonly shouldContinue?: () => boolean;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface FinishedTour {
  readonly blob: Blob;
  /** The manifest the zip carries. */
  readonly written: TourManifest;
  /** A listed tour's continued file list. */
  readonly signedManifest?: SignedTourManifest;
  /** The entries visitors never read that were left out. */
  readonly scanLeftOut: readonly string[];
}

/** The title a finished tour carries: the name typed in step 3 when it
 *  says something, else the title the tour had (polish round M4a: the
 *  visitor's start page leads with it). */
function finishTitle(
  current: string | undefined,
  typed: string | null,
): string | undefined {
  const name = typed?.trim() ?? "";
  return name === "" ? current : name;
}

/** A written entry's record for `manifest.json`: the SHA-256 and size of
 *  the bytes the zip will hold (a string is written as UTF-8). */
async function fileRecordOf(
  data: Blob | Uint8Array | string,
): Promise<TourFileRecord> {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(await data.arrayBuffer());
  return { sha256: await sha256Hex(bytes), size: bytes.length };
}

/**
 * The finished tour, or null when `shouldContinue` said stop. Throws what
 * the serializer, the read and the rebuild throw (a duplicate id, a cap, a
 * failed integrity check): the caller shows it.
 */
export async function rebuildFinishedTour(
  input: FinishInput,
): Promise<FinishedTour | null> {
  const { tour, manifest } = input;
  // One expression for "is there a previous rebuild": the read and the
  // budget rule below must never disagree (E0 review #8).
  const previous = input.previous ?? null;
  const entryNames = tour.entries.map((e) => e.filename);
  // The session derived this prefix when it opened the zip; deriving
  // it a second time here is how the writer and the reader drifted
  // apart in the first place (PR #435 review).
  const wrap = tour.manifestWrap;
  const manifestPath = `${wrap}${TOUR_MANIFEST_ENTRY}`;
  // The manifest: what the zip carried, with this device's records
  // REPLACING theirs by id (an edit or a move of a hosted object),
  // the new ones appended and the deleted ones filtered out (plan
  // §3.4, M4); the photos' bytes become content entries next to it.
  const deleted = [...input.deleted];
  const title = finishTitle(manifest.title, input.title ?? null);
  const written: TourManifest = {
    ...manifest,
    ...(title === undefined ? {} : { title }),
    ...(input.captureSpots === undefined
      ? {}
      : { captureSpots: input.captureSpots }),
    // Never an id twice, and not for tidiness: the serializer REJECTS
    // duplicates, so one restored object that is already in the
    // manifest would make every finish throw - for as long as the
    // draft is restored, with no escape inside the app (M5 review #4).
    objects: applyObjectChanges(
      manifest.objects,
      input.placed.map((p) => p.object),
      deleted,
    ),
  };
  // A deleted photo takes its content file with it. A signature over
  // the old list cannot cover the files this Finish rewrites, so it
  // goes - the output is unsigned until K2 signs on export. The list
  // itself CONTINUES for a listed tour (K1 milestone review R7, below);
  // anything else carrying the name is dropped with it.
  const [listName, ...signatureNames] = signedManifestFilesOf(entryNames);
  const listed =
    tour.integrity.kind === "listed" && listName !== undefined
      ? { integrity: tour.integrity, entry: listName }
      : null;
  // The published copy carries only what visitors read unless the
  // creator keeps the walk (S-D10): the walk, its unbaked frames, depth.
  // Never without baked spots (S1 milestone review #2): the walk is
  // then the only way a viewer can place the photos, and the hosted
  // file may be the creator's only copy of it.
  const scanLeftOut =
    input.keepScan || written.captureSpots === undefined
      ? []
      : scanEntryNames(entryNames, written, wrap);
  const removed = [
    ...contentEntriesToRemove(manifest.objects, deleted, wrap),
    ...scanLeftOut,
    ...signatureNames,
    ...(listed === null && listName !== undefined ? [listName] : []),
  ];
  // The level replaced where the zip holds it (also wrapped), a new
  // one inside a listed tour's folder or at the root
  // (`finish-entries.ts`), then the manifest and the photos.
  const entries: FinishEntry[] = finishEntries({
    entryNames,
    levels: input.levels,
    wrap,
    listed: listed !== null,
    manifestPath,
    manifestJson: serializeTourManifest(written),
    photos: input.placed.flatMap((p) =>
      p.object.kind === "photo" && p.blob !== undefined
        ? [{ image: p.object.image, blob: p.blob }]
        : [],
    ),
  });
  // The input is the NEWEST bytes for this tour: a previous finish's
  // rebuild when there is one, because it already carries that
  // batch's content entries - rebuilding from the hosted zip again
  // would write a manifest referencing photos the archive does not
  // contain (PR #435 review, the second half of the second-finish
  // bug). A caller passes no previous rebuild for a tour it has just
  // opened, so that one starts from what is actually hosted.
  const source =
    previous === null ? await tour.readWholeArchive() : previous.blob;
  if (input.shouldContinue?.() === false) return null;
  // The series' list, continued: the same series id, the next
  // version, and the hash of every file this zip will hold - the
  // kept ones from the list the input carries (checked at open and
  // as a whole by readWholeArchive, or written by the last Finish),
  // the written ones hashed here. Without it the series id's only
  // home was dropped (R7).
  let signedManifest: SignedTourManifest | undefined;
  if (listed !== null) {
    signedManifest = successorManifest(
      listed.integrity.manifest,
      listed.entry,
      {
        ...(previous?.signedManifest === undefined
          ? {}
          : { baseFiles: previous.signedManifest.files }),
        removed,
        written: new Map(
          await Promise.all(
            entries.map(
              async (e) => [e.path, await fileRecordOf(e.data)] as const,
            ),
          ),
        ),
        createdAt: (input.now?.() ?? new Date()).toISOString(),
      },
    );
    entries.push({
      path: listed.entry,
      data: serializeSignedTourManifest(signedManifest),
    });
  }
  const blob = await rebuildZipWithEntries(source, entries, {
    remove: removed,
    // The open archive is untrusted, so its rebuild inflates under
    // the session's own budget (K0 milestone review R1). A previous
    // Finish's zip is this page's own output, stored and bounded:
    // the rebuild sizes a budget for it itself.
    ...(previous === null ? { budget: tour.budget } : {}),
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
  });
  return {
    blob,
    written,
    ...(signedManifest === undefined ? {} : { signedManifest }),
    scanLeftOut,
  };
}
