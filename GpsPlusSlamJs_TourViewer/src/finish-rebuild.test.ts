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
import {
  DecompressionBudget,
  packFilesAsZip,
} from "gps-plus-slam-app-framework/storage";
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
  type TourCaptureSpots,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { rebuildFinishedTour } from "./finish-rebuild.js";
import { openTourFile, type TourSession } from "./tour-session.js";
import {
  buildListedTourFixture,
  buildSignedTourFixture,
  generateFixtureKey,
} from "./test-support/tour-signing-fixture.js";

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

/** An entry's text as the zip stores it - the bytes, not a report of
 *  them (E0 review #1: the in-memory manifest is no proof). */
async function textOf(blob: Blob, name: string): Promise<string | undefined> {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    name,
  );
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

/** The manifest the zip carries, parsed from its bytes. */
async function zipManifest(blob: Blob): Promise<TourManifest> {
  const text = await textOf(blob, `${WRAP}tour.json`);
  expect(text, "the zip must carry tour.json").toBeDefined();
  return parseTourManifest(JSON.parse(text!));
}

/** Spots that let the walk go (any valid ones). */
const SPOTS: TourCaptureSpots = {
  fixes: 3,
  gpsAccuracyMedianM: 4,
  captures: [
    {
      image: "images/frame-000002.jpg",
      geo: { lat: 48, lon: 11, alt: 500, rotation: [0, 0, 0, 1] },
    },
  ],
};

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
    const carried = await zipManifest(result!.blob);
    expect(carried.objects.map((o) => o.id)).toEqual(["a", "kept", "b"]);
    expect(carried.objects[0]).toMatchObject({ label: "new text" });
    // What it reports writing is what the zip carries.
    expect(result!.written).toEqual(carried);
    const names = await namesOf(result!.blob);
    expect(names).not.toContain(`${WRAP}content/gone.jpg`);
    expect(names).toContain(`${WRAP}content/kept.jpg`);
    // The level is REPLACED inside the wrap: one copy, with the new bytes.
    expect(names.filter((n) => n.endsWith(`${LEVEL_ID}.json`))).toEqual([
      `${WRAP}qr/${LEVEL_ID}.json`,
    ]);
    await expect(
      textOf(result!.blob, `${WRAP}qr/${LEVEL_ID}.json`),
    ).resolves.toBe('{"new":true}');
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
    expect((await zipManifest(typed!.blob)).title).toBe("New name");
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
    expect((await zipManifest(second!.blob)).objects.map((o) => o.id)).toEqual([
      "p1",
      "b",
    ]);
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

  it("leaves the walk out of a tour with photo spots, keeps it when asked, and never without spots", async () => {
    // S-D10: visitors download the published copy; the walk is the
    // creator's, and without baked spots it is the only way to place the
    // photos (S1 milestone review #2).
    const walk = [`${WRAP}session.json`, `${WRAP}actions/000001.json`];
    const tour = await plainTour([], {
      "session.json": "{}",
      "actions/000001.json": "[]",
    });
    const run = async (keepScan: boolean, spots: boolean) => {
      const r = await rebuildFinishedTour({
        ...NO_EDITS,
        tour,
        manifest: manifestOf([]),
        keepScan,
        ...(spots ? { captureSpots: SPOTS } : {}),
      });
      return { left: r!.scanLeftOut, names: await namesOf(r!.blob) };
    };
    const out = await run(false, true);
    expect([...out.left].sort()).toEqual([...walk].sort());
    for (const name of walk) expect(out.names).not.toContain(name);
    for (const [keepScan, spots] of [
      [true, true],
      [false, false],
    ] as const) {
      const kept = await run(keepScan, spots);
      expect(kept.left).toEqual([]);
      for (const name of walk) expect(kept.names).toContain(name);
    }
    await tour.close();
  });

  it("drops a signed tour's signature and continues its list unsigned", async () => {
    const fixture = await buildSignedTourFixture(
      { "tour.json": serializeTourManifest(manifestOf([])) },
      await generateFixtureKey(),
      { wrap: WRAP, version: 2 },
    );
    const tour = await open(new Blob([fixture.zip]));
    const result = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: manifestOf([]),
      placed: [{ object: pin("b") }],
    });
    expect(await namesOf(result!.blob)).not.toContain(
      `${WRAP}manifest.sig.json`,
    );
    const next = await open(result!.blob);
    expect(next.integrity).toMatchObject({
      kind: "listed",
      signature: null,
      manifest: { version: 3 },
    });
    await next.close();
    await tour.close();
  });

  it("rebuilds the hosted zip under the tour's budget, a previous rebuild without it", async () => {
    // K0 milestone review R1: the hosted archive is untrusted; a previous
    // rebuild is the page's own output. A budget too small for the
    // archive stands in for a deflate bomb.
    const real = await plainTour([], { "content/big.jpg": "0123456789" });
    const first = await rebuildFinishedTour({
      ...NO_EDITS,
      tour: real,
      manifest: manifestOf([]),
    });
    const tiny: Parameters<typeof rebuildFinishedTour>[0]["tour"] = {
      entries: real.entries,
      manifestWrap: real.manifestWrap,
      integrity: real.integrity,
      readWholeArchive: () => real.readWholeArchive(),
      budget: new DecompressionBudget({ maxEntryBytes: 4, maxTotalBytes: 4 }),
    };
    await expect(
      rebuildFinishedTour({
        ...NO_EDITS,
        tour: tiny,
        manifest: manifestOf([]),
      }),
    ).rejects.toThrow(/too large once unpacked/);
    // Omitted counts as "no previous" too, under the budget (review #8).
    const { previous: _omitted, ...noPrevious } = NO_EDITS;
    await expect(
      rebuildFinishedTour({
        ...noPrevious,
        tour: tiny,
        manifest: manifestOf([]),
      }),
    ).rejects.toThrow(/too large once unpacked/);
    await expect(
      rebuildFinishedTour({
        ...NO_EDITS,
        tour: tiny,
        manifest: first!.written,
        previous: { blob: first!.blob },
      }),
    ).resolves.not.toBeNull();
    await real.close();
  });

  it("a rebuild chained on a previous one stays at the open-time version + 1, listing both batches", async () => {
    // E0 review #3: every rebuild of one open tour continues the list the
    // tour was OPENED with - one version for the page load, however often
    // it saves. E2's "one version per editing session" builds on this.
    const fixture = await buildListedTourFixture(
      { "tour.json": serializeTourManifest(manifestOf([])) },
      { wrap: WRAP, version: 3 },
    );
    const tour = await open(new Blob([fixture.zip]));
    const first = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: manifestOf([]),
      placed: [{ object: photo("p1"), blob: new Blob(["jpg"]) }],
    });
    const second = await rebuildFinishedTour({
      ...NO_EDITS,
      tour,
      manifest: first!.written,
      placed: [{ object: pin("b") }],
      previous: {
        blob: first!.blob,
        ...(first!.signedManifest === undefined
          ? {}
          : { signedManifest: first!.signedManifest }),
      },
    });
    expect(second!.signedManifest?.version).toBe(4);
    const next = await open(second!.blob);
    expect(next.integrity).toMatchObject({ manifest: { version: 4 } });
    // The first batch's photo is in the zip AND in the list.
    await expect(next.wholeArchiveCheck).resolves.toBe("checked");
    expect(await namesOf(second!.blob)).toContain(`${WRAP}content/p1.jpg`);
    await next.close();
    await tour.close();
  });
});
