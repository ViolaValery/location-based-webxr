# editor/popover-place.ts

## Purpose

Where the desktop editor's card sits next to the selected marker (M6 E1),
as numbers: the chosen prototype's (`public/prototypes/editor-1-left-rail/`)
`positionCard`, made pure so it can be tested without a DOM. Pure.

## Public API

- `placePopover({ anchor, lift, gap, size, free }): PopoverPlacement`
  - `anchor` - the marker's ground point in window pixels; `lift` - up from
    it to the marker's visual centre (a note's bubble sits above its tip);
    `gap` - between the marker and the card; `size` - the card's; `free` -
    the free part of the window (`Box`: right of the rail, under the top
    bar).
  - `{ visible: false }` when the marker is more than 6 px outside `free`
    (the page then shows the "off the map view" chip), else
    `{ visible: true, x, y, side, arrow }`: to the right of the marker,
    else to its left, else below it; `arrow` is the arrow's offset along
    the card's edge, pointing at the marker.
- `revealPadding(viewport, free)` - the padding a marker is panned inside
  (Leaflet `panInside`): 40 px clear of the rail and the top bar, 380 px
  on the right and 60 px at the bottom where the window has room, shrunk
  so the box stays at least 60 px wide and tall (a fixed 380 px turned it
  inside out below about 490 px, E1 review #2).
- `Box`, `PopoverPlacement`.

## Invariants & assumptions

- A shown card lies inside `free` whenever the card fits in it (the
  property test sweeps anchors and card sizes).
- Integer pixels.

## Examples

```ts
const p = placePopover({
  anchor: map.latLngToContainerPoint(marker.getLatLng()),
  lift: 24,
  gap: 30,
  size: { width: card.offsetWidth, height: card.offsetHeight },
  free: {
    left: railRight + 12,
    top: 80,
    right: innerWidth - 12,
    bottom: innerHeight - 12,
  },
});
```

## Tests

`popover-place.test.ts`: right, left, below, hidden in each direction, and
the inside-the-free-area property; `revealPadding` on a desktop and a
phone, and the never-inside-out property.
