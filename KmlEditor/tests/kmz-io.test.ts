import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import { KmzContainer } from "../src/kmz-io/index";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/google-earth",
);

async function readZipEntries(
  buffer: ArrayBuffer,
): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
  const reader = new ZipReader(new BlobReader(new Blob([buffer])));
  const entries = await reader.getEntries();

  return Promise.all(
    entries
      .filter((entry) => !entry.directory)
      .map(async (entry) => {
        const blob = await entry.getData(new BlobWriter());
        return {
          filename: entry.filename,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      }),
  );
}

describe("KmzContainer", () => {
  const containers: KmzContainer[] = [];

  afterEach(() => {
    for (const container of containers) {
      container.dispose();
    }
    containers.length = 0;
  });

  async function openFixture(name: string): Promise<KmzContainer> {
    const fixturePath = path.join(fixturesDir, name);
    const bytes = fs.readFileSync(fixturePath);
    const container = new KmzContainer();
    containers.push(container);
    await container.open(new File([bytes], name, { type: "application/zip" }));
    return container;
  }

  it("round-trips a KMZ fixture without changing doc.kml or asset bytes", async () => {
    const originalPath = path.join(fixturesDir, "parkplatz.kmz");
    const originalBytes = fs.readFileSync(originalPath);
    const originalBuffer = new Uint8Array(originalBytes).buffer;
    const container = await openFixture("parkplatz.kmz");

    const originalDocKml = container.getDocKml();
    const originalAssets = container.listAssets();
    const originalEntries = await readZipEntries(originalBuffer);

    const savedBuffer = await container.save();
    const savedEntries = await readZipEntries(savedBuffer);

    const savedDocKml = savedEntries.find(
      (entry) => entry.filename === "doc.kml",
    )?.bytes;
    expect(savedDocKml).toBeDefined();
    expect(new TextDecoder().decode(savedDocKml)).toBe(originalDocKml);

    const originalAssetEntries = originalEntries.filter(
      (entry) => entry.filename !== "doc.kml",
    );
    const savedAssetEntries = savedEntries.filter(
      (entry) => entry.filename !== "doc.kml",
    );

    expect(savedAssetEntries.map((entry) => entry.filename)).toEqual(
      originalAssetEntries.map((entry) => entry.filename),
    );
    expect(
      container.listAssets().map((asset: { path: string }) => asset.path),
    ).toEqual(originalAssets.map((asset: { path: string }) => asset.path));

    for (const asset of originalAssetEntries) {
      const savedAsset = savedAssetEntries.find(
        (entry) => entry.filename === asset.filename,
      );
      expect(savedAsset).toBeDefined();
      expect(savedAsset?.bytes).toEqual(asset.bytes);
    }

    const hrefMatch = originalDocKml.match(/<href>([^<]+)<\/href>/);
    expect(hrefMatch).toBeTruthy();

    const provider = container.getAssetProvider();
    const href = hrefMatch?.[1] ?? originalAssets[0]?.path;
    const assetBytes = await provider.getAssetBytes(href);
    const matchingAsset = originalAssetEntries.find(
      (entry) => entry.filename === href,
    );
    if (matchingAsset) {
      expect(Array.from(assetBytes)).toEqual(Array.from(matchingAsset.bytes));
    }
    provider.dispose();
  });
});
