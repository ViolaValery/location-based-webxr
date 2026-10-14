/**
 * Why these tests matter: the editor's rail and map are drawn from this
 * model (M6 E1). A code must carry the same name as on the phone (the
 * plan review's #1: zip order, `codeLabel`), a note the same title as in
 * the phone's list (#3, `object-describe.ts`), and every photo a visitor
 * sees - placed ones and the walk's recorded ones (#9) - must be listed.
 * A position nobody can draw must not reach the map.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  createEmptyTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { buildEditorModel, filterItems, photoSource } from "./editor-model.js";
import { createTourViewerStore } from "../tour-viewer-session.js";

// The distance lines use the licensed library's geo maths.
beforeAll(() => {
  createTourViewerStore();
});

const AT = { lat: 48.52, lon: 9.053, alt: 340 };

function level(northM: number | null): QrLevel {
  return {
    version: 1,
    qr:
      northM === null
        ? {}
        : {
            geo: {
              lat: AT.lat + northM / 111_320,
              lon: AT.lon,
              alt: AT.alt,
              headingDeg: 0,
            },
          },
  };
}

function pin(id: string, label: string, lat = AT.lat): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { ...AT, lat, headingDeg: 0 },
  };
}

function photo(id: string, label?: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { ...AT, rotation: [0, 0, 0, 1] },
    ...(label === undefined ? {} : { label }),
  };
}

function manifest(over: Partial<TourManifest> = {}): TourManifest {
  return { ...createEmptyTourManifest(), ...over };
}

describe("buildEditorModel", () => {
  it("numbers the codes in the zip's order, as the phone does, and lists one without a position", () => {
    const m = buildEditorModel({
      manifest: manifest(),
      levels: new Map([
        ["b-id", level(5)],
        ["a-id", level(null)],
      ]),
      fileName: "tour.zip",
    });
    const codes = m.items.filter((i) => i.kind === "code");
    expect(codes.map((c) => [c.id, c.title, c.number])).toEqual([
      ["b-id", "Code 1", 1],
      ["a-id", "Code 2", 2],
    ]);
    expect(codes[0]?.meta).toBe("Printed code, measured on site");
    expect(codes[1]?.at).toBeNull();
    expect(codes[1]?.meta).toBe("Printed code, no position stored yet");
    // Only what has a position frames the map.
    expect(m.fitPoints).toHaveLength(1);
  });

  it("calls a single code 'The code', as the phone's summary does", () => {
    const m = buildEditorModel({
      manifest: manifest(),
      levels: new Map([["only", level(0)]]),
      fileName: "tour.zip",
    });
    expect(m.items[0]?.title).toBe("The code");
  });

  it("names notes as the phone's list does and says how far each is from a code", () => {
    const m = buildEditorModel({
      manifest: manifest({
        objects: [pin("p", "The town hall"), photo("f", "  ")],
      }),
      levels: new Map([["c", level(4)]]),
      fileName: "tour.zip",
    });
    const [p, f] = m.items.filter((i) => i.kind !== "code");
    expect(p).toMatchObject({
      title: "The town hall",
      meta: "Text note · 4 m from the code",
    });
    expect(f).toMatchObject({
      title: "Photo",
      meta: "Photo note · 4 m from the code",
      image: "content/f.jpg",
    });
    expect(m.counts).toEqual({ code: 1, pin: 1, photo: 1, station: 0 });
  });

  it("lists the walk's recorded photos with the placed ones, marked as recorded", () => {
    const m = buildEditorModel({
      manifest: manifest({
        captureSpots: {
          fixes: 3,
          gpsAccuracyMedianM: 4,
          captures: [
            {
              image: "images/frame-000002.jpg",
              geo: { ...AT, rotation: [0, 0, 0, 1] },
            },
          ],
        },
      }),
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(m.items).toEqual([
      expect.objectContaining({
        kind: "photo",
        title: "Recorded photo",
        image: "images/frame-000002.jpg",
        recorded: true,
      }),
    ]);
    expect(m.counts.photo).toBe(1);
  });

  // Why (PR #609 review): a recorded photo whose fix cannot be drawn was
  // dropped from the list and the counts; like a note's, its row stays so
  // the creator can see the walk produced a photo the map cannot place.
  it("keeps a recorded photo whose fix cannot be drawn, without a position", () => {
    const m = buildEditorModel({
      manifest: manifest({
        captureSpots: {
          fixes: 3,
          gpsAccuracyMedianM: 4,
          captures: [
            {
              image: "images/frame-000003.jpg",
              geo: { ...AT, lat: 123, rotation: [0, 0, 0, 1] },
            },
          ],
        },
      }),
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(m.items).toEqual([
      expect.objectContaining({
        kind: "photo",
        at: null,
        recorded: true,
        meta: expect.stringMatching(/no position/),
      }),
    ]);
    expect(m.counts.photo).toBe(1);
  });

  it("lists the story's stations at their own position or their code's", () => {
    // Why: a story tour (the committed sample) may carry no pins or photos
    // at all - only stations; an editor that ignored them opened it as an
    // empty map.
    const m = buildEditorModel({
      manifest: manifest({
        stations: [
          {
            id: "column",
            title: "The column",
            anchor: { geo: { ...AT, headingDeg: 0 } },
            activateRadiusM: 30,
            foundRadiusM: 5,
            hint: "arrow",
            steps: [],
          },
          {
            id: "gate",
            anchor: { code: "c" },
            activateRadiusM: 30,
            foundRadiusM: 5,
            hint: "arrow",
            steps: [],
          },
        ],
      }),
      levels: new Map([["c", level(4)]]),
      fileName: "tour.zip",
    });
    const stations = m.items.filter((i) => i.kind === "station");
    expect(stations.map((x) => [x.id, x.title, x.meta])).toEqual([
      ["station:column", "The column", "Station 1"],
      ["station:gate", "Station 2", "Station 2 · at The code"],
    ]);
    expect(stations[1]?.at).toEqual(m.items[0]?.at);
    // Drawn at its code's point, so the map draws it beside the code
    // (PR #609 review): the same point and size would hide one under the
    // other.
    expect(stations[1]?.onCode).toBe(true);
    expect(stations[0]?.onCode).toBeUndefined();
    expect(m.counts.station).toBe(2);
  });

  it("keeps a note whose position cannot be drawn in the list, off the map (E1 review #9)", () => {
    // Why: dropped from the list too, it could never be found - nor, from
    // E2 on, deleted.
    const m = buildEditorModel({
      manifest: manifest({ objects: [pin("bad", "Nowhere", 123)] }),
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(m.items).toEqual([
      expect.objectContaining({
        id: "bad",
        at: null,
        meta: "Text note · no position",
      }),
    ]);
    expect(m.fitPoints).toEqual([]);
  });

  it("titles the tour with its own name, else the file's", () => {
    const named = buildEditorModel({
      manifest: manifest({ title: "Altstadt walk" }),
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(named.title).toBe("Altstadt walk");
    const unnamed = buildEditorModel({
      manifest: manifest({ title: "   " }),
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(unnamed.title).toBe("tour.zip");
  });
});

describe("filterItems", () => {
  // Built inside each test: the store the geo maths needs exists only
  // once beforeAll has run.
  const model = () =>
    buildEditorModel({
      manifest: manifest({
        objects: [pin("p", "The Town Hall"), pin("q", "Fountain")],
      }),
      levels: new Map(),
      fileName: "tour.zip",
    });

  it("finds by title or second line, ignoring case and blanks", () => {
    expect(filterItems(model().items, "  town ").map((i) => i.id)).toEqual([
      "p",
    ]);
    expect(filterItems(model().items, "text note")).toHaveLength(2);
  });

  it("shows everything for an empty search", () => {
    expect(filterItems(model().items, "")).toHaveLength(2);
  });
});

describe("photoSource (E1 review #1)", () => {
  // Why: a placed photo's image is a content path inside the tour's
  // folder; a recorded photo's is already the archive's entry name. Joining
  // the folder to both read every recorded photo from the wrong path in a
  // zip made by compressing a folder.
  it("reads a placed photo as content and a recorded one by its entry name", () => {
    const m = buildEditorModel({
      manifest: manifest({
        objects: [photo("f")],
        captureSpots: {
          fixes: 3,
          gpsAccuracyMedianM: 4,
          captures: [
            {
              image: "mytour/images/frame-000002.jpg",
              geo: { ...AT, rotation: [0, 0, 0, 1] },
            },
          ],
        },
      }),
      levels: new Map(),
      fileName: "tour.zip",
    });
    const [placed, recorded] = m.items;
    expect(photoSource(placed!)).toEqual({
      kind: "content",
      path: "content/f.jpg",
    });
    expect(photoSource(recorded!)).toEqual({
      kind: "entry",
      path: "mytour/images/frame-000002.jpg",
    });
  });

  it("is null for an item without a photo", () => {
    const m = buildEditorModel({
      manifest: manifest({ objects: [pin("p", "x")] }),
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(photoSource(m.items[0]!)).toBeNull();
  });
});
