/**
 * Why these tests matter (M6 E2a): the desktop editor's edits are what a
 * Save writes. Each must reach the saved zip exactly as the phone's Finish
 * would write it - by the shared rules (`object-edits.ts`,
 * `finish-rebuild.ts`) - and an edit made while a save runs must wait for
 * the next one rather than vanish. A second save starts from the first's
 * bytes (a deleted photo's file stays gone, a placed one's stays). Real
 * zips, read back with the viewer's opener.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import { readStoredEntryBytes } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { openTourFile, type TourSession } from "../tour-session.js";
import { createTourViewerStore } from "../tour-viewer-session.js";
import { createEditorSession } from "./editor-session.js";

beforeAll(() => {
  createTourViewerStore();
});

function pin(id: string, label = `pin ${id}`): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-13T00:00:00.000Z",
    geo: { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

async function opened(objects: readonly TourObject[]): Promise<{
  session: TourSession;
  manifest: TourManifest;
}> {
  const manifest = { ...createEmptyTourManifest(), objects: [...objects] };
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
    ...objects
      .filter((o) => o.kind === "photo")
      .map((o) => ({ path: `content/${o.id}.jpg`, data: o.id })),
  ]);
  const session = await openTourFile(
    new File([zip], "tour.zip", { type: "application/zip" }),
  );
  return { session, manifest };
}

async function carried(blob: Blob): Promise<TourManifest> {
  const bytes = readStoredEntryBytes(
    new Uint8Array(await blob.arrayBuffer()),
    "tour.json",
  );
  return parseTourManifest(JSON.parse(new TextDecoder().decode(bytes)));
}

describe("createEditorSession", () => {
  it("edits a pin's text, moves a note and deletes one, and the save carries all three", async () => {
    const { session, manifest } = await opened([
      pin("a", "Old"),
      pin("b"),
      photo("c"),
    ]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.editText("a", "New")).toEqual({ kind: "edited" });
    editor.move("b", 48.53, 9.06);
    editor.remove("c");
    expect(editor.changeCount()).toBe(3);
    const saved = await editor.save({ keepScan: false });
    const tour = await carried(saved.blob);
    expect(tour.objects.map((o) => o.id)).toEqual(["a", "b"]);
    expect(tour.objects[0]).toMatchObject({ label: "New" });
    expect(tour.objects[1]?.geo).toMatchObject({ lat: 48.53, lon: 9.06 });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("refuses an empty pin with the phone's sentence and changes nothing", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    expect(editor.editText("a", "  ")).toEqual({
      kind: "refused",
      reason: "A pin needs some text - it was left as it was.",
    });
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("undoes a delete, back in its place", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const undo = editor.remove("a");
    expect(editor.model().items.map((i) => i.id)).toEqual(["b"]);
    undo();
    expect(editor.model().items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("keeps an edit made while a save runs for the next save", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "First");
    const running = editor.save({ keepScan: false });
    editor.editText("b", "During the save");
    const first = await running;
    expect((await carried(first.blob)).objects[1]).toMatchObject({
      label: "pin b",
    });
    expect(editor.changeCount()).toBe(1);
    const second = await editor.save({ keepScan: false });
    const tour = await carried(second.blob);
    expect(tour.objects.map((o) => (o as { label: string }).label)).toEqual([
      "First",
      "During the save",
    ]);
    await session.close();
  });

  it("names the saved file after the opened one", async () => {
    const { session, manifest } = await opened([pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "x");
    expect((await editor.save({ keepScan: false })).filename).toBe("tour.zip");
    await session.close();
  });
});
