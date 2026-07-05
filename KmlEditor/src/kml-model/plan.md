# KML Model Component Implementation Plan

## Overview

The `kml-model` component is the core data engine of the offline-first browser application. Its precise responsibility is to parse an underlying KML document into a typed, interactive object model, allow in-place mutations of those objects, and serialize the document back to a string. 

**Boundaries & Constraints:**
*   **What it owns:** The in-memory representation of the KML document, the parsing logic, the format-preserving mutation engine, and the typed feature views (`IMarkerFeature`, `ILineFeature`, etc.).
*   **What it never owns:** The KMZ container (zip extraction/compression), the world-space coordinate conversion (handled by `geo-bridge`), rendering, UI interaction, or disk persistence.
*   **Contracts it implements:** `IKmlDocument` and the `IFeatureView` hierarchy (from `src/contracts/kml-document.ts`).
*   **Contracts it consumes:** `FeatureTemplate`, `FeatureSnapshot`, `GeoPosition` (from `src/contracts/type.ts`).

A hard requirement is the **byte-faithful round-trip guarantee**: any byte not explicitly modified by the user must remain identical upon serialization. This strictly precludes using the browser's native `DOMParser` and `XMLSerializer` for the entire document, as they normalize formatting, attribute quotes, and self-closing tags.

## Internal Architecture

The component is composed of three internal modules acting together behind the `KmlDocumentImpl` facade.

### 1. KmlParser (SAX-based Indexer)
*   **Responsibility:** Reads the raw KML string using a SAX parser to identify features and locate the exact string indices (start/end) of editable fields (`<name>`, `<coordinates>`, `<heading>`, etc.) and feature boundaries.
*   **Inputs:** Raw KML `string`.
*   **Outputs:** A populated `FragmentChain` and a set of initialized `FeatureView` instances.

### 2. FragmentChain (Piece Table)
*   **Responsibility:** Manages the KML text as a linked list (or array) of string fragments. Fragments are either `StaticFragment` (untouched XML text) or `ValueFragment` (editable inner text, bound to a feature property).
*   **Inputs:** Index boundaries from `KmlParser`, property updates from `FeatureView`s.
*   **Outputs:** The reconstructed KML string via `serialize()`.
*   **Invariants:** Concatenating all active fragments always yields a valid KML document. 

### 3. FeatureView Implementations
*   **Responsibility:** Concrete classes implementing `IMarkerFeature`, `ILineFeature`, `IGroundOverlayFeature`, and `IModelFeature`. They act as active records.
*   **Inputs:** Property mutations from the application (e.g., `marker.position = newPos`).
*   **Outputs:** Synchronous updates to their bound `ValueFragment`s in the `FragmentChain`.

**Why this minimizes coupling:** The external application only interacts with the high-level `IFeatureView` interfaces. The complex reality of XML text splicing is completely hidden inside the `FragmentChain`, which acts as an internal state machine decoupled from the domain logic of what a "Marker" or "Line" is.

## Runtime Data Flow

### Loading (Parsing)
1.  `KmlDocumentImpl.parse(xmlString)` is invoked.
2.  The SAX parser scans the string, firing events.
3.  When a feature tag (e.g., `<Placemark>`) starts, its character index is recorded.
4.  When an editable inner tag (e.g., `<coordinates>`) is found, the text between its start and end tags is sliced into a `ValueFragment`. All surrounding uneditable XML becomes `StaticFragment`s.
5.  A concrete `FeatureView` is instantiated, holding references to its `ValueFragment`s.
6.  The views are stored in a map keyed by generated `FeatureId`.

### Editing (Mutation)
1.  The command layer modifies a property: `marker.position = { lon: 10, lat: 20, alt: 0 }`.
2.  The `setter` on the `MarkerFeature` instance formats the new coordinate string (`"10,20,0"`).
3.  The setter updates the content of the linked `ValueFragment`.
4.  No XML parsing or DOM manipulation occurs during editing. It is an $O(1)$ string replacement in memory.

### Saving (Serialization)
1.  `KmlDocumentImpl.serialize()` is invoked.
2.  The `FragmentChain` joins the `.content` of all active fragments.
3.  The string is returned. Untouched features and static fragments remain byte-identical.

### Deleting
1.  `KmlDocumentImpl.removeFeature(id)` is called.
2.  The `FragmentChain` marks all fragments from the feature's `FeatureStart` marker to its `FeatureEnd` marker as deleted.
3.  The deleted fragments are cloned into a `FeatureSnapshot` (for undo).

### Creating
1.  `KmlDocumentImpl.insertFeature(template)` is called.
2.  A new template KML string is generated for the feature type.
3.  It is parsed into fragments and inserted into the `FragmentChain` just before the `</Document>` or `</kml>` static fragment.

## Public Surface

The module exports a factory function and implements the existing interfaces. **No contracts are modified.**

```typescript
// Exports
export function createKmlDocument(): IKmlDocument;

// Internal implementations (hidden from consumers)
class KmlDocumentImpl implements IKmlDocument {
    parse(kmlString: string): void;
    serialize(): string;
    getFeatures(): IFeatureView[];
    getFeatureById(id: FeatureId): IFeatureView | null;
    insertFeature(template: FeatureTemplate, afterId?: FeatureId): FeatureId;
    removeFeature(id: FeatureId): FeatureSnapshot;
    restoreFeature(snapshot: FeatureSnapshot, afterId?: FeatureId): void;
}

// Active record implementations
class MarkerFeatureImpl implements IMarkerFeature {
    get position(): GeoPosition;
    set position(val: GeoPosition);
    // ... handles updates to the underlying ValueFragment
}
```

## Algorithms

### The Fragment Chain (Piece Table) Strategy
*   **Purpose:** To achieve surgical, format-preserving XML mutations without the risk and normalizations of DOM serialization.
*   **Steps:** 
    1.  Divide the document into an array of objects: `{ type: 'static' | 'value', text: string }`.
    2.  For a `<Placemark><name>Foo</name></Placemark>`, the array is:
        *   `[0]: static ("<Placemark><name>")`
        *   `[1]: value ("Foo")` - Bound to the feature's `name` property.
        *   `[2]: static ("</name></Placemark>")`
    3.  When `name` changes to `"Bar"`, `[1].text = "Bar"`.
*   **Complexity:** Parsing is $O(N)$ where N is file size. Mutation is $O(1)$. Serialization is $O(M)$ where M is the number of fragments.
*   **Failure cases:** Malformed XML (handled during parsing, throws error). Unrecognized extensions inside a feature are safely wrapped in a static fragment and preserved.

### Stable Coordinate Formatting
*   **Purpose:** Prevent unnecessary precision bloat when writing unchanged coordinates, and ensure deterministic diffs.
*   **Steps:** When a `GeoPosition` setter is called, format numbers using a fixed, high precision (e.g., 6 decimal places for lat/lon, 2 for altitude) avoiding floating-point drift: `Number(val.toFixed(6)).toString()`.

## State Management

*   **Mutable State:** The `FragmentChain` (array of fragments) and the `Map<FeatureId, FeatureView>`.
*   **Owner:** The `KmlDocumentImpl` instance.
*   **Lifetime:** Bound to the lifecycle of the document. Created on `parse()`, disposed when the app releases the document reference.
*   **Synchronization:** Updates are fully synchronous. Setters directly mutate fragments. There is no asynchronous state or caching invalidation required.

## Error Strategy

Every expected failure is explicitly handled. Generic `throw new Error()` is strictly avoided in favor of typed errors.

1.  **`ParseError` (Invalid KML):** SAX parser encounters invalid syntax. 
    *   *Recovery:* Abort load, bubble error to UI, do not overwrite any existing state.
2.  **`FeatureNotFoundError`:** Attempt to edit or delete an ID that doesn't exist in the map.
    *   *Recovery:* No-op or throw typed error; caught by the command layer to abort the edit.
3.  **`MalformedCoordinateError`:** The `<coordinates>` text is corrupted (e.g., `"10,foo,0"`).
    *   *Recovery:* Fall back to `{ lon: 0, lat: 0, alt: 0 }` during parsing, flag the feature as invalid in the UI, but preserve the string fragment so it round-trips losslessly if untouched.
4.  **`UnsupportedFeatureTypeError`:** Encountering KML elements like `<Polygon>` or `<NetworkLink>`.
    *   *Recovery:* Treat as a single large `StaticFragment`. It is not mapped to an `IFeatureView` and is ignored by the editor, but preserved perfectly during `serialize()`.

## Performance Strategy

*   **Memory:** The Fragment Chain strategy avoids creating thousands of heavy DOM nodes. A 10MB KML file will consume roughly 10MB of string fragments plus small wrapper objects.
*   **Large Files (Thousands of Features):** String joining (serialization) is highly optimized in V8. Parsing happens once. 
*   **Incremental Updates:** Updating a feature modifies a single small string fragment. We do *not* use a large regex over the 10MB string on every frame.
*   **Garbage Generation:** Mutating a fragment throws away the old string and allocates a new one. To minimize GC pauses during continuous AR dragging, coordinate formatting is only flushed to the fragment on `pointerup` (debounced at the command layer), not at 60fps. During a drag, the `FeatureView` serves the transient state.

## Testing Strategy

The component relies heavily on pure, deterministic unit testing.

### 1. Identity Tests (The Round-Trip Spine)
*   **Goal:** Prove `parse()` + `serialize()` is lossless.
*   **Action:** Feed hand-authored and real Google Earth fixtures (from Task 1) through the parser. Immediately serialize.
*   **Assertion:** `output === input` (strict string equality).

### 2. Surgical Edit Tests
*   **Goal:** Prove mutations affect only the intended byte ranges.
*   **Action:** Parse fixture, move one marker, serialize.
*   **Assertion:** A string diff reveals exactly one line changed (the `<coordinates>` of that specific marker).

### 3. Structural Survival Tests
*   **Goal:** Prove unrecognized tags survive.
*   **Action:** Parse a document full of `<Style>`, `<Folder>`, `<ExtendedData>`. Delete a marker. Serialize.
*   **Assertion:** All styles and folders remain byte-identical.

### 4. Replay / Undo Tests
*   **Goal:** Prove `removeFeature` and `restoreFeature` are inverse operations.
*   **Action:** Parse, remove feature, serialize (verify removal). Restore feature from snapshot, serialize.
*   **Assertion:** Final output string is strictly equal to the original input string.

## Demo

**Standalone Demo (`demo/index.html`):**
A bare-bones web page independent of AR or WebGL.
1.  **UI:** A `<textarea>` showing raw KML, a list of parsed features (HTML buttons), and an "Edit" panel.
2.  **Interaction:** The user clicks a Marker in the list, changes its Longitude in an `<input>`, and clicks "Apply".
3.  **Proof:** The page runs the mutation, calls `serialize()`, and highlights the exact character diff in the raw `<textarea>`. It demonstrates surgical text splicing live.

## Dependencies

*   **`sax` (npm package):** A very fast, lightweight SAX parser.
    *   *Why it exists:* Required to get accurate character start/end indices for tags without normalizing the document.
    *   *Why alternatives were rejected:* `DOMParser` normalizes. `xml-cst` and others are often heavy or unmaintained. `sax` is universally proven for index-tracking.
    *   *Assumptions:* The XML is well-formed.

## Risks

1.  **Risk: SAX parsing index offsets are misaligned.** (Severity: High)
    *   *Why:* If the parser indices are off by 1 byte, splicing will corrupt tags (e.g., `<name>Foo</nam`).
    *   *Detection:* The Identity Test will fail immediately.
    *   *Mitigation:* Write extensive edge-case tests with strange whitespace, CDATA sections, and entity encoding.
2.  **Risk: Floating-point formatting creates diff noise.** (Severity: Medium)
    *   *Why:* `12.0` parsed and re-serialized as `12.000000001` pollutes version control.
    *   *Detection:* Surgical edit tests diffing against exact expected strings.
    *   *Mitigation:* Implement a strict numeric formatting utility (e.g., strip trailing zeros, clamp to 6 decimal places) and use it consistently.

## Milestones

*   **Milestone 1: The Identity Parser**
    *   Implement SAX indexer and Fragment Chain.
    *   Support `parse()` and `serialize()`. No mutation logic yet.
    *   *Proof:* Identity tests pass on all fixtures.
*   **Milestone 2: Read-Only Feature Views**
    *   Extract Marker, Line, Overlay, and Model properties from the fragments.
    *   Implement `getFeatures()`.
    *   *Proof:* Demo page successfully lists features from a complex KMZ.
*   **Milestone 3: Surgical Mutation**
    *   Implement setters on `FeatureView`s that update `ValueFragment`s.
    *   *Proof:* Surgical edit tests pass. Demo page shows live diffs.
*   **Milestone 4: Structural Editing**
    *   Implement `insertFeature`, `removeFeature`, and `restoreFeature`.
    *   *Proof:* Undo/Redo tests pass. Create/Delete round-trip yields byte-identical result.
