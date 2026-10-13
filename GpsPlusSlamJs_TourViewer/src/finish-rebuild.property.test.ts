/**
 * Why this property matters: whatever mix of edits, additions and
 * deletions a page hands the shared Finish rules (M6 E0), the zip it writes
 * must carry exactly those objects - each id once, edits in place, deleted
 * photos' files gone, kept ones present - and must open again. The
 * example tests pin single cases; this one sweeps the mixes, on real zips.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredCentralDirectory } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  createEmptyTourManifest,
  serializeTourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { rebuildFinishedTour } from "./finish-rebuild.js";
import { openTourFile } from "./tour-session.js";

const HOSTED = ["a", "b", "c", "d"] as const;

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function pin(id: string, label: string): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

describe("rebuildFinishedTour (property)", () => {
  it("writes exactly the edited set: each id once, deleted photos' files gone, kept ones present, and the zip opens again", async () => {
    const hosted = HOSTED.map((id) => photo(id));
    const zip = await packFilesAsZip([
      {
        path: "tour.json",
        data: serializeTourManifest({
          ...createEmptyTourManifest(),
          objects: hosted,
        }),
      },
      ...HOSTED.map((id) => ({ path: `content/${id}.jpg`, data: id })),
    ]);
    const tour = await openTourFile(
      new File([zip], "t.zip", { type: "application/zip" }),
    );
    const manifest = { ...createEmptyTourManifest(), objects: hosted };
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...HOSTED]),
        fc.subarray([...HOSTED]),
        fc.uniqueArray(fc.constantFrom("n1", "n2", "n3"), { maxLength: 3 }),
        async (deleted, edited, added) => {
          const placed = [
            ...edited.map((id) => ({ object: pin(id, `edited ${id}`) })),
            ...added.map((id) => ({ object: pin(id, `new ${id}`) })),
          ];
          const result = await rebuildFinishedTour({
            tour,
            manifest,
            placed,
            deleted,
            levels: [],
            keepScan: false,
            previous: null,
          });
          const ids = result!.written.objects.map((o) => o.id);
          expect(new Set(ids).size).toBe(ids.length);
          const expected = [
            ...HOSTED.filter((id) => !deleted.includes(id)),
            ...added,
          ];
          expect(ids).toEqual(expected);
          const byId = new Map(result!.written.objects.map((o) => [o.id, o]));
          // A deletion wins over an edit of the same id.
          for (const id of edited.filter((e) => !deleted.includes(e))) {
            expect(byId.get(id)).toMatchObject({ label: `edited ${id}` });
          }
          const names = readStoredCentralDirectory(
            new Uint8Array(await result!.blob.arrayBuffer()),
          ).map((e) => e.name);
          for (const id of HOSTED) {
            // Only a deletion takes a photo's file; an edit keeps it.
            expect(names.includes(`content/${id}.jpg`)).toBe(
              !deleted.includes(id),
            );
          }
          const reopened = await openTourFile(
            new File([result!.blob], "t.zip", { type: "application/zip" }),
          );
          await reopened.close();
        },
      ),
      { numRuns: 20 },
    );
    await tour.close();
  });
});
