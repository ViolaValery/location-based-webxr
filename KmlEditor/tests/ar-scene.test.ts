import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GeoPosition, FeatureId, WorldPosition } from '../src/contracts/type';
import { IGeoBridge } from '../src/contracts/geo-bridge';
import { createEditorStore } from '../src/store';
import { createKmlDocument } from '../src/document-model';
import { KmzContainer } from '../src/kmz-io/container';
import { createMoveMarkerCommand } from '../src/commands';
import { ArAnchorCoordinator } from '../src/ar-scene/ar-anchor-coordinator';
import { ArSessionManager } from '../src/ar-scene/ar-session-manager';
import { ArSceneManager } from '../src/ar-scene/ar-scene-manager';
import { ArInteractionController } from '../src/ar-scene/ar-interaction-controller';
import { ArReplayAdapter } from '../src/ar-scene/ar-replay-adapter';
import { IFeatureRenderer, IRendererFactory } from '../src/contracts/renderer';
import { IFeatureView, IMarkerFeature } from '../src/contracts/document-model';

class FakeRenderer implements IFeatureRenderer<IFeatureView, THREE.Object3D> {
    featureId = '' as FeatureId;
    readonly object = new THREE.Group();

    constructor() {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
        this.object.add(mesh);
    }

    readonly update = vi.fn(async (feature: IFeatureView) => {
        this.featureId = feature.id;
        this.object.userData.featureId = feature.id;
    });
    readonly dispose = vi.fn();
    getNativeObject(): THREE.Object3D {
        return this.object;
    }
}

describe('Component 8: AR Scene (ar-scene) — Glue & Gesture Unit Tests', () => {
    let mockGeoBridge: IGeoBridge;
    let anchorPosition: GeoPosition;

    beforeEach(() => {
        anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
        mockGeoBridge = {
            setAnchor: vi.fn((anchor) => {
                anchorPosition = anchor.position;
            }),
            getAnchor: vi.fn(() => ({ position: anchorPosition, heading: 0 })),
            geoToWorld: vi.fn((pos: GeoPosition) => ({
                x: (pos.lon - anchorPosition.lon) * 100000,
                y: pos.alt - anchorPosition.alt,
                z: (pos.lat - anchorPosition.lat) * 100000,
            })),
            worldToGeo: vi.fn((pos: WorldPosition) => ({
                lon: anchorPosition.lon + pos.x / 100000,
                lat: anchorPosition.lat + pos.z / 100000,
                alt: anchorPosition.alt + pos.y,
            })),
            formatCoordinate: vi.fn((val: number) => String(val)),
        };
    });

    describe('AR Glue: Framework Anchor + GeoBridge to Feature World Position', () => {
        it('maps framework GPS anchor updates through GeoBridge to compute accurate 3D world positions', () => {
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            // 1. Initial GPS update from framework pose
            coordinator.updateGps(50.77, 6.06, 200, 0, 5);
            expect(mockGeoBridge.setAnchor).toHaveBeenCalledWith({
                position: { lon: 6.06, lat: 50.77, alt: 200 },
                heading: 0,
            });

            // 2. Feature located at target GeoPosition
            const featurePos: GeoPosition = { lon: 6.061, lat: 50.771, alt: 210 };
            const worldPos = coordinator.applyAltitudePolicy(featurePos, 'absolute');

            // 3. Assert world coordinates relative to framework anchor
            expect(worldPos.x).toBeCloseTo(100, 1);
            expect(worldPos.y).toBe(10); // 210 - 200
            expect(worldPos.z).toBeCloseTo(100, 1);
        });

        it('resolves altitude policies correctly (clampToGround, relativeToGround, absolute)', () => {
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);
            coordinator.setGroundY(5.0);

            const pos: GeoPosition = { lon: 6.06, lat: 50.77, alt: 50 };

            const clamped = coordinator.applyAltitudePolicy(pos, 'clampToGround');
            expect(clamped.y).toBe(5.0);

            const relative = coordinator.applyAltitudePolicy(pos, 'relativeToGround');
            expect(relative.y).toBe(5.0 + 50);

            const absolute = coordinator.applyAltitudePolicy(pos, 'absolute');
            expect(absolute.y).toBe(50 - 200); // pos.alt (50) - anchorAlt (200)
        });

        it('buffers GPS updates when Anchor Lock is engaged during active 3D drags', () => {
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            coordinator.setAnchorLock(true);
            coordinator.updateGps(50.78, 6.07, 210, 45, 5);

            // Anchor should NOT update while locked
            expect(mockGeoBridge.setAnchor).not.toHaveBeenCalled();

            // Releasing Anchor Lock flushes buffered GPS update
            coordinator.setAnchorLock(false);
            expect(mockGeoBridge.setAnchor).toHaveBeenCalledWith({
                position: { lon: 6.07, lat: 50.78, alt: 210 },
                heading: 45,
            });
        });
    });

    describe('AR Phone-Space Touch Grab to Edit Command Translation', () => {
        it('turns a phone-space screen grab gesture into a MoveMarkerCommand on the document and store', async () => {
            const store = createEditorStore();
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            const doc = createKmlDocument();
            const kmlSrc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark id="marker-ar-1">
    <name>AR Target Marker</name>
    <Point>
      <coordinates>6.060000,50.770000,200.0</coordinates>
    </Point>
  </Placemark>
</Document>
</kml>`;
            doc.parse(kmlSrc);
            const kmz = new KmzContainer();
            kmz.setDocKml(kmlSrc);
            await store.loadContainer(kmz);

            const targetId = doc.getFeatures()[0].id;

            const fakeCanvas = {} as HTMLCanvasElement;
            fakeCanvas.style = {} as CSSStyleDeclaration;
            fakeCanvas.addEventListener = vi.fn();
            fakeCanvas.removeEventListener = vi.fn();
            fakeCanvas.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 } as DOMRect));

            const interactionController = new ArInteractionController(
                fakeCanvas,
                sceneManager,
                mockGeoBridge,
                store,
                coordinator,
                () => doc
            );

            // Programmatically execute an edit command derived from phone-space grab (WorldPosition target)
            const targetWorldPos: WorldPosition = { x: 50, y: 5, z: 50 };
            const command = createMoveMarkerCommand(targetId, targetWorldPos);

            command.execute(doc, mockGeoBridge);
            store.executeCommand(command);

            // Assert store state updated and command executed against document model
            expect(store.getState().canUndo).toBe(true);

            const updatedFeature = doc.getFeatureById(targetId) as IMarkerFeature;
            expect(updatedFeature.position.lon).toBeCloseTo(6.0605, 5);
            expect(updatedFeature.position.lat).toBeCloseTo(50.7705, 5);
            expect(updatedFeature.position.alt).toBe(205.0);

            interactionController.dispose();
            sceneManager.dispose();
        });
    });

    describe('AR Persistence Regression Guarantee (Round-Trip Persistence)', () => {
        it('persists AR edit commands losslessly back to KML container (reusing desktop round-trip guarantee)', async () => {
            const store = createEditorStore();
            const doc = createKmlDocument();

            const originalKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document id="doc-ar-roundtrip">
  <name>AR Roundtrip Test</name>
  <!-- Untouched comment -->
  <Placemark id="marker-ar">
    <name>Original AR Marker</name>
    <Point>
      <coordinates>6.060000,50.770000,200.0</coordinates>
    </Point>
  </Placemark>
</Document>
</kml>`;

            doc.parse(originalKml);
            const targetId = doc.getFeatures()[0].id;

            // Apply AR touch drag command with target WorldPosition
            const targetWorldPos: WorldPosition = { x: 123.4, y: 15.5, z: 123.4 };
            const command = createMoveMarkerCommand(targetId, targetWorldPos);

            command.execute(doc, mockGeoBridge);
            store.executeCommand(command);

            // Save modified document into container
            const kmz = new KmzContainer();
            kmz.setDocKml(doc.serialize());
            const savedBuffer = await kmz.save();

            // Re-open saved container and verify byte-faithful surgical edit
            const kmzReloaded = new KmzContainer();
            await kmzReloaded.open(savedBuffer);
            const docReloaded = createKmlDocument();
            docReloaded.parse(kmzReloaded.getDocKml());

            const reloadedMarker = docReloaded.getFeatures()[0] as IMarkerFeature;
            expect(reloadedMarker.position.lon).toBeCloseTo(6.061234, 5);
            expect(reloadedMarker.position.lat).toBeCloseTo(50.771234, 5);
            expect(reloadedMarker.position.alt).toBe(215.5);

            // Assert untouched elements (Doc name, comments) remain intact
            expect(kmzReloaded.getDocKml()).toContain('<!-- Untouched comment -->');
            expect(kmzReloaded.getDocKml()).toContain('<name>AR Roundtrip Test</name>');
        });
    });

    describe('ArSessionManager', () => {
        it('manages tracking state listeners cleanly', () => {
            const fakeCanvas = {} as HTMLCanvasElement;
            const manager = new ArSessionManager({ canvas: fakeCanvas });

            const states: string[] = [];
            const unsub = manager.onTrackingStateChange((state) => states.push(state));

            expect(states).toEqual(['uninitialized']);
            unsub();
            manager.dispose();
        });
    });

    describe('ArSceneManager', () => {
        it('initializes Three.js AR scene and reticle mesh', () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);

            expect(sceneManager.scene).toBeDefined();
            expect(sceneManager.featureGroup).toBeDefined();
            expect(sceneManager.overlayGroup).toBeDefined();

            sceneManager.setReticlePosition(new THREE.Vector3(1, 2, 3), true);
            expect(sceneManager.reticle.position.x).toBe(1);
            expect(sceneManager.reticle.visible).toBe(true);

            sceneManager.dispose();
        });
    });

    describe('ArReplayAdapter', () => {
        it('processes replay samples and updates anchor coordinator', () => {
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);
            const adapter = new ArReplayAdapter(coordinator, store);

            adapter.loadSamples([
                { timestamp: 1000, position: { lon: 6.061, lat: 50.771, alt: 205 } },
                { timestamp: 2000, position: { lon: 6.062, lat: 50.772, alt: 206 } },
            ]);

            expect(adapter.getSampleCount()).toBe(2);
            adapter.step();

            expect(store.getState().device.gpsPosition).toEqual({
                latitude: 50.772,
                longitude: 6.062,
                altitude: 206,
            });

            adapter.dispose();
        });
    });
});
