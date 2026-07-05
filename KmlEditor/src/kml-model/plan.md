# KML Model Component Implementation Plan

## Overview

The `kml-model` component is the core data engine of the offline-first browser application. Its precise responsibility is to parse an underlying KML document into a typed, interactive object model, allow in-place mutations of those objects, and serialize the document back to a string.

**Boundaries & Constraints:**
*   **What it owns:** The in-memory representation of the KML document, the parsing logic, the format-preserving mutation engine, and the typed feature views (`IMarkerFeature`, `ILineFeature`, etc.).
*   **What it never owns:** The KMZ container (zip extraction/compression), the world-space coordinate conversion (handled by `geo-bridge`), rendering, UI interaction, or disk persistence.
*   **Contracts it implements:** `IKmlDocument` and the `IFeatureView` hierarchy (from `src/contracts/kml-document.ts`).
*   **Contracts it consumes:** `FeatureTemplate`, `FeatureSnapshot`, `GeoPosition` (from `src/contracts/type.ts`).

A hard requirement is the **byte-faithful round-trip guarantee**: any byte not explicitly modified by the user must remain identical upon serialization. This strictly precludes using the browser's native `DOMParser` and `XMLSerializer` for the entire document.

## Internal Architecture

The component is composed of three internal modules acting together behind the `KmlDocumentImpl` facade.

### 1. KmlParser (SAX-based XPath Indexer)
*   **Responsibility:** Reads the raw KML string using a SAX parser. To handle deep nesting reliably, it tracks the current tag stack (e.g., `Placemark/Style/IconStyle/scale`). It extracts feature bounds and the `id` attributes (`kmlId`).
*   **Security:** The SAX parser is strictly configured to disable XML External Entity (XXE) resolution and expansion to prevent injection attacks.
*   **Outputs:** A populated `FragmentChain` and initialized `FeatureView` instances.

### 2. FragmentChain (Lazy Piece Table)
*   **Responsibility:** Manages the KML text as a linked list of string fragments. To optimize memory for large files, the document is initially split into large `FeatureFragment`s (one per feature) and `StaticFragment`s (the untouched spaces between features).
*   **Outputs:** The reconstructed KML string via `serialize()`.
*   **Invariants:** Concatenating all active fragments always yields a valid KML document.

### 3. FeatureView Implementations
*   **Responsibility:** Concrete classes implementing `IMarkerFeature`, `ILineFeature`, etc. They cache the typed representation (e.g., `GeoPosition[]`) in memory for fast reads by the renderer.
*   **Inputs:** Property mutations from the application.
*   **Outputs:** When mutated, the View lazily breaks its `FeatureFragment` into smaller `ValueFragment`s (if not already done) and updates them.

## Runtime Data Flow

### Loading (Parsing)
1.  `KmlDocumentImpl.parse(xmlString)` is invoked.
2.  The SAX parser scans the string. It identifies feature boundaries and extracts the `id` attribute to populate `kmlId`.
3.  The text is sliced into high-level chunks: `[Static XML] -> [Feature 1 XML] -> [Static XML] -> [Feature 2 XML]`.
4.  Concrete `FeatureView`s are instantiated. They parse their inner fields (e.g., `<coordinates>`) to populate their in-memory caches but leave the raw XML string intact.

### Editing (Mutation)
1.  The command layer modifies a property: `marker.position = { lon: 10, lat: 20, alt: 0 }`.
2.  The `FeatureView` updates its typed cache.
3.  The View checks if its `FeatureFragment` is intact. If so, it uses a localized SAX parse/regex to split the specific editable tag into a `ValueFragment`.
4.  **Missing Tags:** If the tag (e.g., `<altitudeMode>`) did not exist in the original KML, the View structurally inserts the new tag string into the correct nested location.
5.  The setter formats the new coordinate string without trailing zero bloat (e.g., stripping `12.000000` to `12.0`) to minimize diff noise.

### Saving (Serialization)
1.  `KmlDocumentImpl.serialize()` is invoked.
2.  The `FragmentChain` concatenates the `.content` of all active fragments.
3.  The string is returned. Untouched features and static fragments remain byte-identical.

### Deleting
1.  `KmlDocumentImpl.removeFeature(id)` is called.
2.  The `FragmentChain` marks the feature's fragments as deleted. Crucially, the deletion boundary extends backwards to capture preceding whitespace/indentation up to the previous newline, preventing garbage whitespace accumulation.
3.  The deleted fragments are cloned into a `FeatureSnapshot`.

### Undo / Restoration
1.  `KmlDocumentImpl.restoreFeature(snapshot)` is called.
2.  Because numerical array indices shift when multiple edits occur, the snapshot uses stable references (e.g., inserting after a specific `FeatureId`'s boundary node) to restore the fragments precisely where they belong.

## Public Surface

The module exports a factory function and implements the existing interfaces. **No contracts are modified.**

```typescript
export function createKmlDocument(): IKmlDocument;

class KmlDocumentImpl implements IKmlDocument {
    parse(kmlString: string): void;
    serialize(): string;
    getFeatures(): IFeatureView[];
    getFeatureById(id: FeatureId): IFeatureView | null;
    insertFeature(template: FeatureTemplate, afterId?: FeatureId): FeatureId;
    removeFeature(id: FeatureId): FeatureSnapshot;
    restoreFeature(snapshot: FeatureSnapshot, afterId?: FeatureId): void;
}
```

## Algorithms

### Lazy Fragment Chain
*   **Purpose:** Achieve format-preserving mutations while supporting missing tag insertions and scaling to 10MB+ files.
*   **Steps:** 
    1.  Parse document into coarse `FeatureFragment`s.
    2.  On first edit, slice the `FeatureFragment` into `StaticFragment`s and `ValueFragment`s.
    3.  If a tag is missing, splice a new `StaticFragment` (the tags) and `ValueFragment` (the content) into the chain.
*   **Complexity:** Parsing is $O(N)$. Simple mutation is $O(1)$ string replacement. Serializing a massive `LineString` with 10,000 points is $O(V)$ and must be debounced by the UI, not run at 60fps.

### Strict Coordinate Formatting
*   **Purpose:** Ensure deterministic diffs.
*   **Steps:** Format numbers using `parseFloat(val.toFixed(6)).toString()` which removes trailing zeros.

## State Management

*   **Mutable State:** The `FragmentChain`, the `Map<FeatureId, FeatureView>`, and the typed property caches inside the Views.
*   **Synchronization:** The typed cache in the `FeatureView` is the source of truth during runtime. It lazily flushes to the underlying string fragments on modification.

## Error & Security Strategy

1.  **ParseError (Invalid KML):** SAX parser encounters invalid syntax. Abort load, do not overwrite existing state.
2.  **XXE Injection:** Blocked via strict SAX parser configuration.
3.  **XSS Vector (`<description>`):** The model guarantees lossless preservation of the `<description>` field, which frequently contains raw CDATA/HTML. The model does *not* sanitize this. It is explicitly documented that the UI/Renderer layer must sanitize this field before display.
4.  **Malformed Coordinates:** Corrupted `<coordinates>` strings fall back to `{ lon: 0, lat: 0, alt: 0 }`. The raw string fragment is preserved losslessly.
5.  **Unsupported Features:** Tags like `<Polygon>` or `<NetworkLink>` are wrapped in static fragments and preserved perfectly during round-trips.

## Performance Strategy

*   **Memory:** Lazy fragment splitting prevents instantiating 50,000 tiny objects for a 10MB file. The document is kept as large strings until surgically targeted.
*   **Incremental Updates:** Updating a feature modifies only its specific fragments. We avoid running large regular expressions over the entire document string.
*   **Garbage Generation:** Mutating a massive `LineString` allocates a large string. To minimize GC pauses, the UI must debounce coordinate flushing on `pointerup`.

## Testing Strategy

### 1. Identity Tests (The Round-Trip Spine)
*   **Goal:** Prove `parse()` + `serialize()` is lossless.
*   **Assertion:** `output === input` on real Google Earth fixtures.

### 2. Surgical Edit Tests
*   **Goal:** Prove mutations affect only the intended byte ranges and respect precision rules.
*   **Assertion:** A string diff reveals exactly one line changed without trailing zero bloat.

### 3. Missing Tag Insertion Tests
*   **Goal:** Prove the system handles incomplete KML.
*   **Action:** Parse a Marker missing `<altitudeMode>`, set it via the View.
*   **Assertion:** The resulting XML contains a properly nested `<altitudeMode>` tag.

### 4. Whitespace Deletion Tests
*   **Goal:** Prove `removeFeature` cleans up indentation.
*   **Assertion:** Deleting a feature leaves no orphaned blank lines or tabs.

### 5. Replay / Undo Tests
*   **Goal:** Prove `removeFeature` and `restoreFeature` use stable references.
*   **Assertion:** Final output string is strictly equal to the original input string, even after interweaved additions and deletions.

## Demo

**Standalone Demo (`demo/index.html`):**
1.  **UI:** A `<textarea>` showing raw KML, a list of parsed features, and an "Edit" panel.
2.  **Interaction:** The user clicks a Marker, changes its Longitude, and adds an Altitude Mode that wasn't previously there.
3.  **Proof:** The page runs the mutation, calls `serialize()`, and highlights the exact character diff in the raw `<textarea>`, showing surgical text splicing and structural insertion live.

## Dependencies

*   **`sax` (npm package):** A fast, lightweight SAX parser configured without external entity resolution.
    *   *Why it exists:* Required to extract accurate character bounds and XPath-like stacks without normalizing the document.

## Milestones

*   **Milestone 1: Coarse Identity Parser**
    *   Implement SAX indexer and coarse `FeatureFragment` splitting.
    *   *Proof:* Identity tests pass on all fixtures.
*   **Milestone 2: Read-Only Feature Views**
    *   Implement tag extraction and typed caching.
    *   *Proof:* Demo page successfully lists features from a complex KMZ, including `kmlId`.
*   **Milestone 3: Lazy Surgical Mutation & Insertion**
    *   Implement on-demand sub-fragment slicing and missing tag insertion.
    *   *Proof:* Surgical edit and missing-tag tests pass.
*   **Milestone 4: Structural Editing & Stable Undo**
    *   Implement `insertFeature`, `removeFeature` (with whitespace cleanup), and `restoreFeature`.
    *   *Proof:* Undo/Redo tests pass. Create/Delete round-trip yields byte-identical result without garbage accumulation.
