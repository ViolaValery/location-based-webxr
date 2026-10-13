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
import { buildEditorModel, filterItems } from "./editor-model.js";
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
    expect(m.counts).toEqual({ code: 1, pin: 1, photo: 1 });
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

  it("keeps a note whose position cannot be drawn off the map", () => {
    const m = buildEditorModel({
      manifest: manifest({ objects: [pin("bad", "Nowhere", 123)] }),
      levels: new Map(),
      fileName: "tour.zip",
    });
    expect(m.items).toEqual([]);
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
