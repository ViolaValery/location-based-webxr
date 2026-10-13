/**
 * What an edit, a delete and an undo do to the lists a Finish writes (M6
 * E0c, lifted from `object-editing.ts` the way E0 lifted the Finish): the
 * phone's object list and the desktop editor call these, so the two pages
 * cannot disagree about what a tour holds. Pure; generic over the page's
 * own entry type (an object, maybe its photo's bytes, maybe more).
 *
 * @see object-edits.ts.md
 */

import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { applyObjectChanges } from "./authoring-draft.js";
import type { ObjectListEntry } from "./object-list.js";

/** A page's entry for an object it placed, edited or moved. */
export interface EditEntry {
  readonly object: TourObject;
}

/** One object of the tour as the creator sees it now. */
export interface AuthoringObject<
  P extends EditEntry = EditEntry,
> extends ObjectListEntry {
  /** This page's entry for it (a placement, an edit, a move), if any. */
  readonly placed: P | null;
}

/** The lists a Finish writes: the page's entries and the deleted ids. */
export interface EditLists<P extends EditEntry> {
  readonly placed: readonly P[];
  readonly deleted: readonly string[];
}

/** What a delete took away, for its undo. */
export interface DeletedRecord<P extends EditEntry> {
  readonly object: TourObject;
  readonly placed: P | null;
  /** Its place among the entries, so the Finish order is kept. */
  readonly index: number;
  readonly hosted: boolean;
}

/**
 * The tour's objects now: the manifest's, this page's replacing them by
 * id, new ones appended, deleted ones gone - the Finish's own rule
 * (`applyObjectChanges`), so the list, the previews and the zip can never
 * disagree about what the tour holds.
 */
export function authoringObjects<P extends EditEntry>(
  manifest: readonly TourObject[],
  placed: readonly P[],
  deleted: readonly string[],
): AuthoringObject<P>[] {
  const hosted = new Set(manifest.map((o) => o.id));
  const byId = new Map<string, P>();
  for (const entry of placed) byId.set(entry.object.id, entry);
  return applyObjectChanges(
    manifest,
    placed.map((p) => p.object),
    deleted,
  ).map((object) => {
    const entry = byId.get(object.id) ?? null;
    return {
      object,
      hosted: hosted.has(object.id),
      changed: entry !== null,
      placed: entry,
    };
  });
}

/** Replace the entry with `entry`'s id, or append it. */
export function upsertPlaced<P extends EditEntry>(
  placed: readonly P[],
  entry: P,
): P[] {
  const index = placed.findIndex((p) => p.object.id === entry.object.id);
  if (index < 0) return [...placed, entry];
  const out = [...placed];
  out[index] = entry;
  return out;
}

/** Said when a pin's text would be emptied: the manifest serializer
 *  rejects an empty label, so every save would throw. */
const EMPTY_PIN = "A pin needs some text - it was left as it was.";

/**
 * A pin's new text, trimmed: the edited object, or `unchanged` (the same
 * text; a photo, whose caption visitors never see - owner question
 * Q-E2-1), or `refused` with the sentence to show (an empty pin).
 */
export function pinTextEdit(
  object: TourObject,
  text: string,
):
  | { readonly kind: "edited"; readonly after: TourObject }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string } {
  if (object.kind !== "pin") return { kind: "unchanged" };
  const label = text.trim();
  if (label === "") return { kind: "refused", reason: EMPTY_PIN };
  if (label === object.label) return { kind: "unchanged" };
  return { kind: "edited", after: { ...object, label } };
}

/**
 * Delete `found`: this page's entry for it goes, and a hosted object (one
 * the opened zip carries) gets a tombstone; a local one needs none.
 */
export function deleteObject<P extends EditEntry>(
  lists: EditLists<P>,
  found: AuthoringObject<P>,
): { placed: P[]; deleted: string[]; record: DeletedRecord<P> } {
  const id = found.object.id;
  const index = lists.placed.findIndex((p) => p.object.id === id);
  return {
    placed: lists.placed.filter((p) => p.object.id !== id),
    deleted:
      found.hosted && !lists.deleted.includes(id)
        ? [...lists.deleted, id]
        : [...lists.deleted],
    record: {
      object: found.object,
      placed: found.placed,
      index,
      hosted: found.hosted,
    },
  };
}

/** Undo a delete: the tombstone goes, the entry returns to its place. */
export function undoDelete<P extends EditEntry>(
  lists: EditLists<P>,
  record: DeletedRecord<P>,
): { placed: P[]; deleted: string[] } {
  const id = record.object.id;
  const deleted = record.hosted
    ? lists.deleted.filter((x) => x !== id)
    : [...lists.deleted];
  const placed = [...lists.placed];
  if (record.placed !== null && !placed.some((p) => p.object.id === id)) {
    placed.splice(Math.min(record.index, placed.length), 0, record.placed);
  }
  return { placed, deleted };
}

/**
 * The object moved to `lat`/`lon` on a map (the desktop editor's Move):
 * its height and facing are kept - a pin's `headingDeg`, a photo's
 * world-frame rotation, which a move of a few metres leaves correct. On
 * sloped ground the kept height may be off; the page says so.
 *
 * @throws RangeError for a position nobody can draw.
 */
export function moveObjectTo(
  object: TourObject,
  lat: number,
  lon: number,
): TourObject {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    throw new RangeError(`latitude ${String(lat)} is not on the globe`);
  }
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new RangeError(`longitude ${String(lon)} is not on the globe`);
  }
  // Per kind, so each spread keeps its own geo shape (a pin's heading, a
  // photo's rotation) rather than a union of both.
  return object.kind === "pin"
    ? { ...object, geo: { ...object.geo, lat, lon } }
    : { ...object, geo: { ...object.geo, lat, lon } };
}
