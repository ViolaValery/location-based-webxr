# `map-osm-base.ts`

## Purpose

Shared OSM base-map setup and path style tokens for the two Leaflet views in
the recorder app: [preview-map.ts](preview-map.ts) and
[summary-map.ts](summary-map.ts). Centralises the OSM tile URL/attribution,
zoom limit, polyline thickness/opacity, initial zoom, and `fitBounds` padding
so both screens stay visually consistent.

Scope is intentionally narrow: only values/helpers that are identical in both
views live here. View-specific concerns (fullscreen toggle, multi-path/ref
markers, resize delays) stay in their respective files.

## Public API

- `OSM_TILE_URL`, `OSM_ATTRIBUTION`, `OSM_MAX_ZOOM` — the OSM tile policy
  values used by both maps.
- `addOsmTileLayer(map): L.TileLayer` — creates and attaches the standard OSM
  tile layer; returns it so callers can track the layer for cleanup.
- `PATH_POLYLINE_WEIGHT`, `PATH_POLYLINE_OPACITY` — stroke style applied to
  every GPS path polyline (raw, fused, alignment snapshots).
- `INITIAL_ZOOM` — zoom passed to `setView` before `fitBounds` runs.
- `FIT_BOUNDS_PADDING` — pixel padding for `fitBounds`; prevents markers and
  accuracy circles from being clipped at the edges.

## Invariants & assumptions

- `addOsmTileLayer` calls `.addTo(map)` synchronously; the returned tile
  layer is already on the map.
- All exported values are constants and safe to reuse across map instances.

## Examples

```ts
const map = L.map(container).setView([lat, lng], INITIAL_ZOOM);
const tileLayer = addOsmTileLayer(map);
layers.push(tileLayer); // for cleanup
// …draw paths…
map.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING });
```

## Tests

- Behavior is exercised through the consumers'
  [preview-map.test.ts](preview-map.test.ts) and
  [summary-map.test.ts](summary-map.test.ts), which both assert the OSM tile
  URL and the `fitBounds` padding.
- Direct unit coverage in [map-osm-base.test.ts](map-osm-base.test.ts) pins
  down the tile-layer options and the constant values so a drift in either
  view would be caught even if the consumer-level assertions are loosened.
