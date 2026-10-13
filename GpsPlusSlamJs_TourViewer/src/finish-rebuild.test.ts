/**
 * Why these tests matter: the Finish's rules - which entries a finished
 * tour writes and removes, a listed tour's series continued, the newest
 * bytes as the input - are what the phone's Finish and the desktop editor
 * (M6 E0, B10's "shared business logic") must agree on. A desktop save that
 * called the raw rebuild would leave deleted photos, a dead signature or a
 * broken series list (M6 design §5, cold review #2). These pin the shared
 * module's contract directly, on real zips; `creator-finish.test.ts` still
 * pins the phone's wiring around it.
 */
import { describe, expect, it, vi } from "vitest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredCentralDirectory } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  createEmptyTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { rebuildFinishedTour } from "./finish-rebuild.js";
import { openTourFile, type TourSession } from "./tour-session.js";
import { buildListedTourFixture } from "./test-support/tour-signing-fixture.js";

const WRAP = "mytour/";
const LEVEL_ID = "abc123";

function pin(id: string, label = `pin ${id}`): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  };
}

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

function manifestOf(objects: readonly TourObject[]): TourManifest {
  return { ...createEmptyTourManifest(), objects: [...objects] };
}

async function open(blob: Blob): Promise<TourSession> {
  return openTourFile(
    new File([blob], "mytour.zip", { type: "application/zip" }),
  );
}

/** A plain (unlisted) wrapped tour with these objects and content files. */
async function plainTour(
  objects: readonly TourObject[],
  content: Record<string, string> = {},
): Promise<TourSession> {
  return open(
    await packFilesAsZip([
      {
        path: `${WRAP}tour.json`,
        data: serializeTourManifest(manifestOf(objects)),
      },
      { path: `${WRAP}qr/${LEVEL_ID}.json`, data: '{"old":true}' },
      ...Object.entries(content).map(([path, data]) => ({
        path: `${WRAP}${path}`,
        data,
      })),
    ]),
  );
}

async function namesOf(blob: Blob): Promise<string[]> {
  return readStoredCentralDirectory(
    new Uint8Array(await blob.arrayBuffer()),
  ).map((e) => e.name);
}

/** The edits a test does not care about. */
const NO_EDITS = {
  placed: [],
  deleted: [],
  levels: [],
  keepScan: false,
  previous: null,
} as const;

describe("rebuildFinishedTour (M6 E0: the Finish's rules, shared)", () => {
  it("writes the edits: an edit in place, a new object appended, a deleted photo's file removed, the level replaced inside the wrap", async () => {
    const tour = await plainTour([pin("a"), photo("gone"), photo("kept")], {
      "content/gone.jpg": "gone",
      "content/kept.jpg": "kept",
    });
    const manifest = manifestOf([pin("a"), photo("gone"), photo("kept")]);
    const result = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest,
      placed: [{ object: pin("a", "new text") }, { object: pin("b") }],
      deleted: ["gone"],
      levels: [{ id: LEVEL_ID, json: '{"new":true}' }],
    });
    expect(result).not.toBeNull();
    expect(result!.written.objects.map((o) => o.id)).toEqual([
      "a",
      "kept",
      "b",
    ]);
    expect(result!.written.objects[0]).toMatchObject({ label: "new text" });
    const names = await namesOf(result!.blob);
    expect(names).not.toContain(`${WRAP}content/gone.jpg`);
    expect(names).toContain(`${WRAP}content/kept.jpg`);
    expect(names.filter((n) => n.endsWith(`${LEVEL_ID}.json`))).toEqual([
      `${WRAP}qr/${LEVEL_ID}.json`,
    ]);
    // What it reports writing is what the zip carries.
    const reopened = await open(result!.blob);
    expect(reopened.manifestWrap).toBe(WRAP);
    await reopened.close();
    await tour.close();
  });

  it("titles the tour with a typed name that says something, else keeps its own", async () => {
    const tour = await plainTour([]);
    const own = { ...manifestOf([]), title: "Old name" };
    const typed = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: own,
      title: "  New name ",
    });
    expect(typed!.written.title).toBe("New name");
    const blank = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: own,
      title: "   ",
    });
    expect(blank!.written.title).toBe("Old name");
    await tour.close();
  });

  it("continues a listed tour's series: the same series, the next version, every file listed", async () => {
    const fixture = await buildListedTourFixture(
      {
        "tour.json": serializeTourManifest(manifestOf([pin("a")])),
        "content/kept.jpg": "0123456789",
      },
      { wrap: WRAP, version: 3 },
    );
    const tour = await open(new Blob([fixture.zip]));
    expect(tour.integrity.kind).toBe("listed");
    const result = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: manifestOf([pin("a")]),
      placed: [{ object: pin("b") }],
      now: () => new Date("2026-10-13T18:00:00.000Z"),
    });
    expect(result!.signedManifest).toMatchObject({
      seriesId: fixture.manifest.seriesId,
      version: 4,
      createdAt: "2026-10-13T18:00:00.000Z",
    });
    const next = await open(result!.blob);
    expect(next.integrity).toMatchObject({
      kind: "listed",
      signature: null,
      manifest: { seriesId: fixture.manifest.seriesId, version: 4 },
    });
    await expect(next.wholeArchiveCheck).resolves.toBe("checked");
    await next.close();
    await tour.close();
  });

  it("rebuilds from the previous result's bytes, not the tour's, when there is one", async () => {
    // The second-finish bug (PR #435 review): rebuilding from the hosted
    // zip again drops the first batch's content entries.
    const tour = await plainTour([]);
    const first = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: manifestOf([]),
      placed: [{ object: photo("p1"), blob: new Blob(["jpg"]) }],
    });
    const read = vi.spyOn(tour, "readWholeArchive");
    const second = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: first!.written,
      placed: [{ object: pin("b") }],
      previous: { blob: first!.blob },
    });
    expect(read).not.toHaveBeenCalled();
    expect(await namesOf(second!.blob)).toContain(`${WRAP}content/p1.jpg`);
    expect(second!.written.objects.map((o) => o.id)).toEqual(["p1", "b"]);
    await tour.close();
  });

  it("stops without rebuilding when the caller no longer wants the result", async () => {
    const tour = await plainTour([]);
    const progress = vi.fn();
    const result = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: manifestOf([]),
      placed: [{ object: pin("b") }],
      shouldContinue: () => false,
      onProgress: progress,
    });
    expect(result).toBeNull();
    expect(progress).not.toHaveBeenCalled();
    await tour.close();
  });
});
