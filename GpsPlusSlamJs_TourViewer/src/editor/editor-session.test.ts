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
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
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

describe("createEditorSession, the review's cases (E0c + E2a review #9, #10, #12)", () => {
  it("counts a text edited back to the tour's own as no change", async () => {
    const { session, manifest } = await opened([pin("a", "Old")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "New");
    expect(editor.changeCount()).toBe(1);
    editor.editText("a", "Old");
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("runs two saves one after the other, the second carrying both edits", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("a", "One");
    const first = editor.save({ keepScan: false });
    editor.editText("b", "Two");
    const second = editor.save({ keepScan: false });
    await first;
    const tour = await carried((await second).blob);
    expect(tour.objects.map((o) => (o as { label: string }).label)).toEqual([
      "One",
      "Two",
    ]);
    expect(editor.changeCount()).toBe(0);
    await session.close();
  });

  it("refuses an undo once a save wrote the delete", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const undo = editor.remove("a");
    await editor.save({ keepScan: false });
    expect(undo()).toBe(false);
    expect(editor.model().items.map((i) => i.id)).toEqual(["b"]);
    await session.close();
  });

  // Why (E2b plan review #2, DEC-A3): a save that was already running when
  // the delete was made did not write it, so its end must not end the
  // undo - it silently did, and the creator's Undo tap did nothing.
  it("keeps the undo of a delete made while a save runs, until a save writes it", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.editText("b", "First");
    const running = editor.save({ keepScan: false });
    const undo = editor.remove("a");
    await running;
    expect(undo()).toBe(true);
    expect(editor.model().items.map((i) => i.id)).toEqual(["a", "b"]);
    const again = editor.remove("a");
    const writes = editor.save({ keepScan: false });
    await writes;
    expect(again()).toBe(false);
    expect(
      (await carried((await writes).blob)).objects.map((o) => o.id),
    ).toEqual(["b"]);
    await session.close();
  });

  // Why (third E2p review #6): a save that snapshotted after the delete
  // writes it, so an undo while it runs would bring back a note the file
  // it is writing no longer carries.
  it("refuses the undo as soon as a save that writes the delete starts", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    const undo = editor.remove("a");
    const writing = editor.save({ keepScan: false });
    expect(undo()).toBe(false);
    const tour = await carried((await writing).blob);
    expect(tour.objects.map((o) => o.id)).toEqual(["b"]);
    expect(editor.model().items.map((i) => i.id)).toEqual(["b"]);
    await session.close();
  });

  it("keeps a deleted photo's file gone across two saves", async () => {
    // Why: the second save rebuilds from the first one's bytes; from the
    // opened zip again, the deleted photo's file would come back.
    const { session, manifest } = await opened([photo("p"), pin("a")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.remove("p");
    await editor.save({ keepScan: false });
    editor.editText("a", "later");
    const second = await editor.save({ keepScan: false });
    const names = readStoredCentralDirectory(
      new Uint8Array(await second.blob.arrayBuffer()),
    ).map((e) => e.name);
    expect(names).not.toContain("content/p.jpg");
    await session.close();
  });

  it("names the pending notes, for the page's moved lines", async () => {
    const { session, manifest } = await opened([pin("a"), pin("b")]);
    const editor = createEditorSession({
      session,
      manifest,
      levels: new Map(),
    });
    editor.move("a", 48.53, 9.06);
    expect(editor.pendingIds()).toEqual(["a"]);
    await editor.save({ keepScan: false });
    expect(editor.pendingIds()).toEqual([]);
    await session.close();
  });
});
