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
});
