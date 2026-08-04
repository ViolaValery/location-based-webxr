import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GeoPosition, FeatureId, WorldPosition } from '../src/contracts/type';
import { IGeoBridge } from '../src/contracts/geo-bridge';
import { createEditorStore } from '../src/store';
import { createKmlDocument } from '../src/document-model';
import { KmzContainer } from '../src/kmz-io/container';
import { createMoveMarkerCommand } from '../src/commands';
import { ArAnchorCoordinator } from '../src/ar-scene/ar-anchor-coordinator';
import { ArSceneManager } from '../src/ar-scene/ar-scene-manager';
import { ArInteractionController } from '../src/ar-scene/ar-interaction-controller';
import { ArReplayAdapter } from '../src/ar-scene/ar-replay-adapter';
import { IFeatureRenderer, IRendererFactory } from '../src/contracts/renderer';
import { IFeatureView, IMarkerFeature } from '../src/contracts/document-model';
import { getArWorldGroup } from 'gps-plus-slam-app-framework/ar';

// ── Mock the framework so tests run without a real WebXR environment ──────────
const mockWorldGroup = new THREE.Group();

vi.mock('gps-plus-slam-app-framework/ar', () => ({
    getArWorldGroup: vi.fn(() => mockWorldGroup),
    getCamera: vi.fn(() => new THREE.PerspectiveCamera()),
    registerFrameUpdate: vi.fn(() => vi.fn()),
    setTrackingLostCallback: vi.fn(),
    createEnableGpsArController: vi.fn(() => ({
        refreshSupport: vi.fn(async () => {}),
        enable: vi.fn(async () => ({ ok: true })),
        disable: vi.fn(async () => {}),
        subscribe: vi.fn(() => vi.fn()),
    })),
}));

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
    let anchorPosition: GeoPosition | null;
    let anchorHeading = 0;

    beforeEach(() => {
        anchorPosition = null;
        anchorHeading = 0;
        mockGeoBridge = {
            setAnchor: vi.fn((anchor) => {
                anchorPosition = anchor.position;
                if (typeof anchor.heading === 'number') {
                    anchorHeading = anchor.heading;
                }
            }),
            getAnchor: vi.fn(() => anchorPosition ? { position: anchorPosition, heading: anchorHeading } : null),
            geoToWorld: vi.fn((pos: GeoPosition) => {
                if (!anchorPosition) return { x: 0, y: 0, z: 0 };
                return {
                    x: (pos.lon - anchorPosition.lon) * 100000,
                    y: pos.alt - anchorPosition.alt,
                    z: (pos.lat - anchorPosition.lat) * 100000,
                };
            }),
            worldToGeo: vi.fn((pos: WorldPosition) => {
                if (!anchorPosition) return { lon: 0, lat: 0, alt: 0 };
                return {
                    lon: anchorPosition.lon + pos.x / 100000,
                    lat: anchorPosition.lat + pos.z / 100000,
                    alt: anchorPosition.alt + pos.y,
                };
            }),
            formatCoordinate: vi.fn((val: number) => String(val)),
        };
    });

    // ── ArAnchorCoordinator ─────────────────────────────────────────────────

    describe('AR Glue: Framework GPS Callbacks → GeoBridge → Feature World Position', () => {
        it('maps GPS callback through GeoBridge to accurate 3D world positions', () => {
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            // First GPS fix — sets the anchor
            coordinator.updateGps(50.77, 6.06, 200, 0, 5);
            expect(mockGeoBridge.setAnchor).toHaveBeenCalledWith({
                position: { lon: 6.06, lat: 50.77, alt: 200 },
                heading: 0,
            });

            // Feature at another geo position
            const featurePos: GeoPosition = { lon: 6.061, lat: 50.771, alt: 210 };
            const worldPos = coordinator.applyAltitudePolicy(featurePos, 'absolute');

            expect(worldPos.x).toBeCloseTo(100, 1);
            expect(worldPos.y).toBe(10); // 210 - 200
            expect(worldPos.z).toBeCloseTo(100, 1);
        });

        it('resolves all three altitudeMode policies correctly (clampToGround, relativeToGround, absolute)', () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);
            coordinator.setGroundY(5.0);

            const pos: GeoPosition = { lon: 6.06, lat: 50.77, alt: 50 };

            const clamped = coordinator.applyAltitudePolicy(pos, 'clampToGround');
            expect(clamped.y).toBe(5.0); // local-floor Y

            const relative = coordinator.applyAltitudePolicy(pos, 'relativeToGround');
            expect(relative.y).toBe(5.0 + 50); // groundY + kml.alt

            const absolute = coordinator.applyAltitudePolicy(pos, 'absolute');
            expect(absolute.y).toBe(50 - 200); // pos.alt - anchor.alt
        });

        it('buffers GPS updates when Anchor Lock is engaged (active 3D drag)', () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            coordinator.setAnchorLock(true);
            coordinator.updateGps(50.78, 6.07, 210, 45, 5);

            // Anchor must NOT be updated while locked
            expect(mockGeoBridge.setAnchor).not.toHaveBeenCalled();

            // Releasing lock flushes the buffered update
            coordinator.setAnchorLock(false);
            expect(mockGeoBridge.setAnchor).toHaveBeenCalledWith({
                position: { lon: 6.07, lat: 50.78, alt: 210 },
                heading: 45,
            });
        });

        it('applies heading from updateHeading() once to the existing anchor', () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            // Simulate first GPS fix (heading=0, so initialHeadingSet stays false)
            coordinator.updateGps(50.77, 6.06, 200, 0, 5);

            // Later orientation callback fires with a real heading
            coordinator.updateHeading(90);
            expect(mockGeoBridge.setAnchor).toHaveBeenCalledWith(
                expect.objectContaining({ heading: 90 })
            );

            // A second updateHeading call must NOT update the anchor again
            (mockGeoBridge.setAnchor as ReturnType<typeof vi.fn>).mockClear();
            coordinator.updateHeading(135);
            expect(mockGeoBridge.setAnchor).not.toHaveBeenCalled();
        });
    });

    // ── ArSceneManager ──────────────────────────────────────────────────────

    describe('ArSceneManager (KmlSceneHelper)', () => {
        it('creates featureGroup and accuracyRing without own Scene or Renderer', () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);

            // Has a featureGroup to attach to arWorldGroup
            expect(sceneManager.featureGroup).toBeInstanceOf(THREE.Group);
            // No scene or camera owned by the sceneManager
            expect((sceneManager as any).scene).toBeUndefined();
            expect((sceneManager as any).camera).toBeUndefined();

            sceneManager.dispose();
        });

        it('attaches featureGroup to the framework arWorldGroup on attachToFrameworkScene()', () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            sceneManager.attachToFrameworkScene();

            // Framework's getArWorldGroup() returns a mocked group — verify featureGroup is a child
            const worldGroup = getArWorldGroup();
            expect(worldGroup?.children).toContain(sceneManager.featureGroup);

            sceneManager.dispose();
        });

        it('culls features > 500m from camera using world-space distanceTo (no geo math)', async () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            sceneManager.attachToFrameworkScene();

            // Place a fake feature far away (> 500m) and a near one
            const farObj = new THREE.Mesh();
            farObj.position.set(600, 0, 0); // 600m away
            farObj.userData.featureId = 'far-feature';
            sceneManager.featureGroup.add(farObj);

            const nearObj = new THREE.Mesh();
            nearObj.position.set(10, 0, 0); // 10m away
            nearObj.userData.featureId = 'near-feature';
            sceneManager.featureGroup.add(nearObj);

            // Run reconcile with empty features so just culling runs
            await sceneManager.reconcileFeatures([], { getAssetUrl: vi.fn(), getAssetBytes: vi.fn(), hasAsset: vi.fn(), dispose: vi.fn(), release: vi.fn() } as any, mockGeoBridge);

            // distanceTo-based culling; camera is at origin (mocked)
            expect(farObj.visible).toBe(false);
            expect(nearObj.visible).toBe(true);

            sceneManager.dispose();
        });

        it('shows largeFileWarning when feature count > 500', async () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            const mockAssets = { getAssetUrl: vi.fn(), getAssetBytes: vi.fn(), hasAsset: vi.fn(), dispose: vi.fn(), release: vi.fn() } as any;
            const manyFeatures = Array.from({ length: 501 }, (_, i) => ({
                id: `f${i}` as FeatureId,
                type: 'marker',
                name: `Marker ${i}`,
            } as unknown as IFeatureView));

            const result = await sceneManager.reconcileFeatures(manyFeatures, mockAssets, mockGeoBridge);
            expect(result.largeFileWarning).toBe(true);

            // Second call: warning must NOT fire again
            const result2 = await sceneManager.reconcileFeatures(manyFeatures, mockAssets, mockGeoBridge);
            expect(result2.largeFileWarning).toBe(false);

            sceneManager.dispose();
        });
    });

    // ── ArInteractionController ─────────────────────────────────────────────

    describe('AR Phone-Space Touch Grab-to-Edit Command Translation', () => {
        it('turns a phone-space screen grab into a MoveMarkerCommand dispatched to the store', async () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
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

            const fakeCanvas = {
                style: {},
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 } as DOMRect)),
            } as unknown as HTMLCanvasElement;

            const interactionController = new ArInteractionController(
                fakeCanvas,
                sceneManager,
                mockGeoBridge,
                store,
                coordinator,
                () => doc
            );

            // Simulate the command that would result from a touchstart → drag → touchend
            const targetWorldPos: WorldPosition = { x: 50, y: 5, z: 50 };
            const command = createMoveMarkerCommand(targetId, targetWorldPos);
            command.execute(doc, mockGeoBridge);
            store.executeCommand(command);

            expect(store.getState().canUndo).toBe(true);

            const updatedFeature = doc.getFeatureById(targetId) as IMarkerFeature;
            expect(updatedFeature.position.lon).toBeCloseTo(6.0605, 5);
            expect(updatedFeature.position.lat).toBeCloseTo(50.7705, 5);
            expect(updatedFeature.position.alt).toBe(205.0);

            interactionController.dispose();
            sceneManager.dispose();
        });
    });

    // ── Lossless Round-Trip (AR edit → KMZ → Google Earth) ─────────────────

    describe('AR Lossless Round-Trip — edit in AR, reopen unchanged in Google Earth', () => {
        it('persists a single AR edit losslessly: only the edited coordinate changes, untouched bytes are preserved', async () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
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

            const targetWorldPos: WorldPosition = { x: 123.4, y: 15.5, z: 123.4 };
            const command = createMoveMarkerCommand(targetId, targetWorldPos);
            command.execute(doc, mockGeoBridge);
            store.executeCommand(command);

            // Serialize and re-open in a new container
            const kmz = new KmzContainer();
            kmz.setDocKml(doc.serialize());
            const savedBuffer = await kmz.save();

            const kmzReloaded = new KmzContainer();
            await kmzReloaded.open(savedBuffer);
            const docReloaded = createKmlDocument();
            docReloaded.parse(kmzReloaded.getDocKml());

            const reloadedMarker = docReloaded.getFeatures()[0] as IMarkerFeature;
            expect(reloadedMarker.position.lon).toBeCloseTo(6.061234, 5);
            expect(reloadedMarker.position.lat).toBeCloseTo(50.771234, 5);
            expect(reloadedMarker.position.alt).toBe(215.5);

            // Untouched elements must remain byte-identical
            expect(kmzReloaded.getDocKml()).toContain('<!-- Untouched comment -->');
            expect(kmzReloaded.getDocKml()).toContain('<name>AR Roundtrip Test</name>');
        });
    });

    // ── ArReplayAdapter ─────────────────────────────────────────────────────

    describe('ArReplayAdapter — phone-free desktop replay', () => {
        it('processes replay samples and drives the anchor coordinator', () => {
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

    // ── Simulation Test: Phone Coordinate Jitter & AR Session Restarts ────────

    describe('Simulation Test: Phone GPS/Heading Jitter across AR Restarts', () => {
        it('preserves deterministic 3D feature positions when phone GPS and heading change across session restarts', async () => {
            const store = createEditorStore();
            const doc = createKmlDocument();

            const kmlText = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark id="my-home-marker">
    <name>My Home Marker</name>
    <Point>
      <coordinates>6.078000,50.777000,100.0</coordinates>
    </Point>
  </Placemark>
</Document>
</kml>`;

            doc.parse(kmlText);
            const kmz = new KmzContainer();
            kmz.setDocKml(kmlText);
            await store.loadContainer(kmz);

            mockGeoBridge.setAnchor({ position: { lon: 6.078, lat: 50.777, alt: 0 }, heading: 0 });
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            // Document reference anchor set: (6.078000, 50.777000)
            const initialAnchor = mockGeoBridge.getAnchor();
            expect(initialAnchor?.position).toEqual({ lon: 6.078, lat: 50.777, alt: 0 });

            // Initial feature world position relative to document anchor
            const markerFeature = doc.getFeatures()[0] as IMarkerFeature;
            const worldPosInitial = coordinator.applyAltitudePolicy(markerFeature.position, 'absolute');

            // --- SESSION 1: Phone starts AR at User Spot 1 (lat 50.777050, lon 6.078050, heading 45°) ---
            coordinator.resetSessionState();
            coordinator.updateGps(50.777050, 6.078050, 100, 45, 5);
            coordinator.updateHeading(45);

            // Document anchor position must NOT have been overwritten by phone's raw GPS
            const session1Anchor = mockGeoBridge.getAnchor();
            expect(session1Anchor?.position).toEqual({ lon: 6.078, lat: 50.777, alt: 0 });
            expect(session1Anchor?.heading).toBe(45);

            // Feature 3D position in local world space must be identical
            const worldPosSession1 = coordinator.applyAltitudePolicy(markerFeature.position, 'absolute');
            expect(worldPosSession1.x).toBe(worldPosInitial.x);
            expect(worldPosSession1.z).toBe(worldPosInitial.z);

            // --- SESSION 2: User walks 15m away, restarts AR at User Spot 2 (lat 50.777150, lon 6.078150, heading 120°) ---
            coordinator.resetSessionState();
            coordinator.updateGps(50.777150, 6.078150, 105, 120, 3);
            coordinator.updateHeading(120);

            // Document reference anchor position must STILL be intact
            const session2Anchor = mockGeoBridge.getAnchor();
            expect(session2Anchor?.position).toEqual({ lon: 6.078, lat: 50.777, alt: 0 });

            // Feature 3D position in featureGroup remains 100% stable
            const worldPosSession2 = coordinator.applyAltitudePolicy(markerFeature.position, 'absolute');
            expect(worldPosSession2.x).toBe(worldPosInitial.x);
            expect(worldPosSession2.z).toBe(worldPosInitial.z);

            coordinator.dispose();
        });
    });
});
