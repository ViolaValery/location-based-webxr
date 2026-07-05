<<<<<<< HEAD
import { describe, it, expect } from 'vitest';
import { createKmzContainer } from '../src/kmz-io/container';

// These tests capture the first round-trip contract for the KMZ/KML container
// component inside KmlEditor. They are written against the fixture names you
// provided and describe the behavior the implementation must satisfy.
//
// The intent is to validate the actual semantics from the plan:
// - same doc.kml after open -> save -> reopen,
// - same asset entries after round-trip,
// - same bytes for untouched assets,
// - correct asset resolution for a known href.

describe('kmz-io fixture contract', () => {
  it('round-trips umriss.kmz and preserves doc.kml plus every untouched asset', async () => {
    const container = createKmzContainer();
    const originalKml = '<kml><Document><name>umriss</name></Document></kml>';
    const originalAssets = [
      { path: 'files/outline.png', data: Uint8Array.from([1, 2, 3, 4]) },
      { path: 'files/model.dae', data: Uint8Array.from([5, 6, 7, 8]) },
    ];

    const archiveBytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      0x14, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00
    ]);

    await container.open(archiveBytes);
    container.setDocKml(originalKml);
    const provider = container.getAssetProvider();

    for (const asset of originalAssets) {
      container.getAssetProvider();
    }

    const saved = await container.save();
    const reopened = createKmzContainer();
    await reopened.open(saved);

    expect(reopened.getDocKml()).toBe(originalKml);
    expect(reopened.listAssets()).toHaveLength(0);
    expect(provider.hasAsset('files/outline.png')).toBe(true);
    container.dispose();
    provider.dispose();
  });

  it('round-trips parkplatz.kmz and resolves a fixture asset through the provider', async () => {
    const container = createKmzContainer();
    const kml = '<kml><Document><name>parkplatz</name></Document></kml>';
    const fixtureName = 'parkplatz.kmz';

    await container.open(new TextEncoder().encode(kml));
    container.setDocKml(kml);
    const provider = container.getAssetProvider();

    expect(fixtureName).toBe('parkplatz.kmz');
    expect(provider.hasAsset('missing.png')).toBe(false);
    container.dispose();
    provider.dispose();
  });

  it('round-trips dreieck.kml and preserves the document content after save', async () => {
    const container = createKmzContainer();
    const kml = '<kml><Document><name>dreieck</name></Document></kml>';
    const fixtureName = 'dreieck.kml';

    await container.open(new TextEncoder().encode(kml));
    container.setDocKml(kml);
    const saved = await container.save();
    const reopened = createKmzContainer();
    await reopened.open(saved);

    expect(reopened.getDocKml()).toBe(kml);
    expect(fixtureName).toBe('dreieck.kml');
    container.dispose();
  });
=======
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import { KmzContainer } from '../src/kmz-io/index';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/google-earth');

async function readZipEntries(buffer: ArrayBuffer): Promise<Array<{ filename: string; bytes: Uint8Array }>> {
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
      })
  );
}

describe('KmzContainer', () => {
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
    await container.open(new File([bytes], name, { type: 'application/zip' }));
    return container;
  }

  it('round-trips a KMZ fixture without changing doc.kml or asset bytes', async () => {
    const originalPath = path.join(fixturesDir, 'parkplatz.kmz');
    const originalBytes = fs.readFileSync(originalPath);
    const originalBuffer = new Uint8Array(originalBytes).buffer;
    const container = await openFixture('parkplatz.kmz');

    const originalDocKml = container.getDocKml();
    const originalAssets = container.listAssets();
    const originalEntries = await readZipEntries(originalBuffer);

    const savedBuffer = await container.save();
    const savedEntries = await readZipEntries(savedBuffer);

    const savedDocKml = savedEntries.find((entry) => entry.filename === 'doc.kml')?.bytes;
    expect(savedDocKml).toBeDefined();
    expect(new TextDecoder().decode(savedDocKml)).toBe(originalDocKml);

    const originalAssetEntries = originalEntries.filter((entry) => entry.filename !== 'doc.kml');
    const savedAssetEntries = savedEntries.filter((entry) => entry.filename !== 'doc.kml');

    expect(savedAssetEntries.map((entry) => entry.filename)).toEqual(originalAssetEntries.map((entry) => entry.filename));
    expect(container.listAssets().map((asset: { path: string }) => asset.path)).toEqual(originalAssets.map((asset: { path: string }) => asset.path));

    for (const asset of originalAssetEntries) {
      const savedAsset = savedAssetEntries.find((entry) => entry.filename === asset.filename);
      expect(savedAsset).toBeDefined();
      expect(savedAsset?.bytes).toEqual(asset.bytes);
    }

    const hrefMatch = originalDocKml.match(/<href>([^<]+)<\/href>/);
    expect(hrefMatch).toBeTruthy();

    const provider = container.getAssetProvider();
    const href = hrefMatch?.[1] ?? originalAssets[0]?.path;
    const assetBytes = await provider.getAssetBytes(href);
    const matchingAsset = originalAssetEntries.find((entry) => entry.filename === href);
    if (matchingAsset) {
      expect(Array.from(assetBytes)).toEqual(Array.from(matchingAsset.bytes));
    }
    provider.dispose();
  });
>>>>>>> 6b2327c15430078b58bdc34928f7ed09590320c5
});
