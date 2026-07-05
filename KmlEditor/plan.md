# Interfaces

<img width="810" height="901" alt="Interfaces" src="https://github.com/user-attachments/assets/aa3f289b-b1c3-44d2-9be2-fba883f5ca75" />

# KmlEditor — Ordnerstruktur

## `src/` — Quellcode (8 Komponenten + Contracts)

- **`contracts/`** — Shared Interfaces (§2.2): definiert die Schnittstellen zwischen allen Komponenten (IKmzContainer, IAssetProvider, IKmlDocument, ICommand, etc.). Wird **zuerst** geschrieben, alles andere programmiert gegen diese Interfaces.

- **`kmz-io/`** — KMZ/KML Container Read/Write (Komponente 1): Öffnet `.kmz` (ZIP) und `.kml` (bare), findet `doc.kml`, listet Assets auf, löst `href`→Bytes auf, schreibt modifiziertes Archiv zurück. Nutzt `@zip.js/zip.js` als ZIP-Library. Implementiert `getAssetUrl(href) → BlobUrl` (Asset Provider).

- **`kml-model/`** — Lossless KML Document Model (Komponente 2, das Herzstück): Format-preserving XML-Parser, der `doc.kml` in einen Baum parst und **byte-faithful** zurückschreibt (unberührte Knoten = identische Bytes). Typed Feature View über die 4 Typen (Marker, Line, GroundOverlay, 3D Model) + Mutation API (movePoint, replaceCoords, setLatLonBox, etc.).

- **`geo-bridge/`** — Geo↔World Coordinate Bridge (Komponente 3, pure Funktionen): Wandelt Lat/Lon/Alt → Three.js World-Koordinaten und zurück, unter Berücksichtigung von altitudeMode (clampToGround, relativeToGround, absolute). Sorgt dafür, dass Edits in Metern korrekt als Geo-Koordinaten persistiert werden, ohne Präzisionsverlust.

- **`renderers/`** — Feature Renderers (Komponente 4, je einer pro KML-Typ):
  - Marker → Billboard-Sprite (KML IconStyle)
  - Line → Polyline mit optionalen Vertex-Handles
  - Ground Overlay → texturiertes Quad am Boden (LatLonBox)
  - 3D Model → COLLADA via ColladaLoader, Texturen über Asset Provider
  - Jeder Renderer funktioniert standalone in einer plain Three.js Scene.

- **`commands/`** — Edit/Command Layer (Komponente 5): Undo/Redo-Engine + alle It.1-Edits als Commands: Move, Drag Vertex, Scale/Rotate, Name/Description ändern, Create/Delete Feature. Jeder Command mapped auf eine KML-Mutation über den geo-bridge + kml-model.

- **`persistence/`** — File System Access Persistence (Komponente 6): Debounced Autosave über File System Access API Handle. Schreibt atomar (temp→swap). Fallback auf OPFS + Download wenn API nicht verfügbar (z.B. Android Chrome).

- **`editor/`** — Desktop Editor (Komponente 7, Goal-2 Composition): Composited 3D Three.js Editor (kein AR, kein 2D-Map in It.1). Verbindet alle Komponenten 1–6: KMZ laden → Features rendern → Selektieren/Editieren → Persistieren. Hier leben auch die Replay-E2E-Tests mit Task-1-Recordings.

- **`ar-scene/`** — AR Scene (Komponente 8, ZULETZT): WebXR-Integration via `gps-plus-slam-app-framework`. Gleicher Store, gleiche Renderer, gleiche Commands — aber Features an GPS-Positionen verankert und in AR auf dem Handy editierbar.

## `demos/` — Standalone-Demos (eine pro Komponente)

- **`kmz-io-demo/`** — Pick a .kmz → Listing von doc.kml + Assets → Re-saved Copy downloaden
- **`kml-model-demo/`** — KML laden → Feature-Liste (IDs, Typen, Koordinaten) → Edit → Diff anzeigen
- **`geo-bridge-demo/`** — Lat/Lon eingeben → World-Position sehen (und umgekehrt) + Punkte als Dots in einer Scene
- **`renderer-demo/`** — Alle 4 Renderer in einer Scene: Marker, Line, Ground Overlay, 3D Model
- **`commands-demo/`** — Marker draggen, Line-Vertex bewegen, Model rotieren, Undo/Redo mit Command-Log
- **`editor-demo/`** — Voller Desktop Editor mit echtem .kmz

## `fixtures/` — Test-Fixtures

- **Root** — Echte Google-Earth `.kmz`/`.kml` Dateien aus Task 1 (Marker, Lines, Overlays, Models, komplexe Styles/Folders/ExtendedData)
- **`recordings/`** — Task-1 GPS/AR Walk-Recordings (JSON) für deterministische Replay-E2E-Tests ohne Handy

## Implementierungs-Reihenfolge

1. `contracts/` → 2. `kmz-io/` → 3. `kml-model/` → 4. `geo-bridge/` → 5. `renderers/` → 6. `commands/` → 7. `persistence/` → 8. `editor/` → 9. `ar-scene/`

> **Harte Constraints:** Engine (1–4) vor Renderern (5), AR Scene (9) zuletzt.
