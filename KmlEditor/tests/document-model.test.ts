import { describe, it, expect, beforeEach } from 'vitest';
import { IKmlDocument, IMarkerFeature } from '../src/contracts/document-model';
import { createKmlDocument } from '../src/document-model';

describe('KML Document Model', () => {
  let doc: IKmlDocument;

  beforeEach(() => {
    // Assume createKmlDocument is exported from index.ts
    doc = createKmlDocument();
  });

  it('should parse and serialize losslessly (Identity Test)', () => {
    const rawKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test Document</name>
    <Placemark id="pm1">
      <name>Marker 1</name>
      <description>Some description</description>
      <Point>
        <coordinates>10,20,0</coordinates>
      </Point>
    </Placemark>
    <!-- Unhandled feature that must be preserved -->
    <Placemark id="pm2">
      <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0,0 1,0,0 1,1,0 0,0,0</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </Document>
</kml>`;
    doc.parse(rawKml);
    const output = doc.serialize();
    expect(output).toBe(rawKml);
  });

  it('should perform surgical edits without affecting the rest of the document (Surgical Edit Test)', () => {
    const rawKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark id="pm1">
    <name>Marker 1</name>
    <Point>
      <coordinates>10,20,0</coordinates>
    </Point>
  </Placemark>
</kml>`;
    doc.parse(rawKml);
    const marker = doc.getFeatureById('pm1' as any) as IMarkerFeature;
    expect(marker).toBeDefined();

    // Mutate the position
    marker.position = { lon: 15, lat: 25, alt: 5 };

    const output = doc.serialize();
    expect(output).toContain('<coordinates>15,25,5</coordinates>');
    expect(output).not.toContain('<coordinates>10,20,0</coordinates>');
    // Ensure unchanged portions are strictly identical
    expect(output).toContain('<name>Marker 1</name>');
  });

  it('should insert missing tags cleanly inside the parent node', () => {
    const rawKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark id="pm1">
    <Point>
      <coordinates>10,20,0</coordinates>
    </Point>
  </Placemark>
</kml>`;
    doc.parse(rawKml);
    const marker = doc.getFeatureById('pm1' as any) as IMarkerFeature;

    // Name is missing from the original KML. Setting it should insert the tag.
    marker.name = 'New Name Inserted';

    const output = doc.serialize();
    expect(output).toContain('<name>New Name Inserted</name>');
  });

  it('should delete a feature and clean surrounding whitespace', () => {
    const rawKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark id="pm1">
      <name>Marker 1</name>
    </Placemark>
    <Placemark id="pm2">
      <name>Marker 2</name>
    </Placemark>
  </Document>
</kml>`;
    doc.parse(rawKml);
    // Ensure both exist
    expect(doc.getFeatures().length).toBeGreaterThanOrEqual(2);

    doc.removeFeature('pm1' as any);

    const output = doc.serialize();
    expect(output).not.toContain('Marker 1');
    expect(output).toContain('Marker 2');

    // Check for no double empty lines that would indicate orphaned whitespace
    expect(output).not.toContain('\\n\\n\\n');
  });

  it('should restore a deleted feature to its exact original location using tombstones', () => {
    const rawKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark id="pm1">
      <name>Marker 1</name>
    </Placemark>
    <Placemark id="pm2">
      <name>Marker 2</name>
    </Placemark>
  </Document>
</kml>`;
    doc.parse(rawKml);
    const snapshot = doc.removeFeature('pm1' as any);

    // Mutate the second marker to ensure the restore mechanism doesn't rely on absolute string indices
    const marker2 = doc.getFeatureById('pm2' as any) as IMarkerFeature;
    if (marker2) {
      marker2.name = 'Updated Marker 2';
    }

    // Restore the deleted feature
    doc.restoreFeature(snapshot);
    const output = doc.serialize();

    // pm1 should be back before pm2
    const indexOfPm1 = output.indexOf('Marker 1');
    const indexOfPm2 = output.indexOf('Updated Marker 2');

    expect(indexOfPm1).toBeGreaterThan(-1);
    expect(indexOfPm2).toBeGreaterThan(-1);
    expect(indexOfPm1).toBeLessThan(indexOfPm2); // Restored in original order
  });
});
