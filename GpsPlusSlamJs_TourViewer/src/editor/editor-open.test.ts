/**
 * Why these tests matter: the editor opens files anyone can make. A tour
 * must open with its manifest and codes; a Recorder or scan zip, a broken
 * tour.json and a file that is not a zip must each be refused with a
 * sentence the creator can act on, never shown as an empty map (M6 E1
 * plan review #8). Real zips, the viewer's real opener.
 */
import { describe, expect, it } from "vitest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { NOT_A_TOUR, NOT_A_ZIP, openTourForEditing } from "./editor-open.js";

async function zipFile(
  entries: { path: string; data: string }[],
  name = "tour.zip",
): Promise<File> {
  return new File([await packFilesAsZip(entries)], name, {
    type: "application/zip",
  });
}

describe("openTourForEditing", () => {
  it("opens a tour with its manifest and codes", async () => {
    const file = await zipFile([
      {
        path: "tour.json",
        data: serializeTourManifest({
          ...createEmptyTourManifest(),
          title: "Altstadt walk",
        }),
      },
    ]);
    const out = await openTourForEditing(file);
    expect(out.kind).toBe("opened");
    if (out.kind !== "opened") return;
    expect(out.manifest.title).toBe("Altstadt walk");
    expect(out.fileName).toBe("tour.zip");
    await out.session.close();
  });

  it("refuses a zip that carries no tour.json and no code", async () => {
    const file = await zipFile([{ path: "session.json", data: "{}" }]);
    await expect(openTourForEditing(file)).resolves.toEqual({
      kind: "refused",
      reason: NOT_A_TOUR,
    });
  });

  it("refuses a broken tour.json and says it cannot be read", async () => {
    const file = await zipFile([{ path: "tour.json", data: "{ not json" }]);
    const out = await openTourForEditing(file);
    expect(out).toMatchObject({ kind: "refused" });
    if (out.kind !== "refused") return;
    expect(out.reason).toMatch(/^This tour cannot be read: /);
  });

  it("refuses a file that is not a zip before reading it", async () => {
    const open = () => Promise.reject(new Error("must not be called"));
    await expect(
      openTourForEditing(new File(["hello"], "notes.txt"), {
        open,
      }),
    ).resolves.toEqual({ kind: "refused", reason: NOT_A_ZIP });
  });

  it("words an opener's refusal as the viewer does", async () => {
    const out = await openTourForEditing(
      new File(["not a zip at all"], "broken.zip", { type: "application/zip" }),
    );
    expect(out.kind).toBe("refused");
  });
});
