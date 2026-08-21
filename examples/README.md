# Examples

All three render the same thing: world country polygons from
[MapLibre's demo tile server](https://demotiles.maplibre.org/), which is public
and needs no key. The Google Maps basemap underneath does need one — a browser
key from the [Google Cloud console](https://console.cloud.google.com/google/maps-apis/credentials)
with the Maps JavaScript API enabled.

The tileset stops at zoom 6, so panning past it exercises the overzoom path
rather than going blank.

## Vanilla — `index.html`

No build tooling, no framework. Build the library once, then open the file:

```bash
npm install
npm run build
open examples/index.html          # or: python3 -m http.server, then browse to it
```

Paste a key into the prompt, or load `examples/index.html?key=YOUR_KEY`.

To run it with no build step at all, swap the local script tag for the CDN
copy, which is what a `<script>`-tag integration looks like in production:

```html
<script src="https://unpkg.com/google-maps-vector-engine"></script>
<script>
  const { MVTSource, DefaultStyles } = GoogleMapsVectorEngine;
</script>
```

It demonstrates layer toggles, four styling modes (including a style function
that varies by zoom), click selection, `fitBounds`, opacity and visibility,
the debug tile grid, live `getStats()` output, and an event log fed by
`tileload` / `tileerror` / `selectionchange`.

## React — `react/`

`useVectorTiles.tsx` is the hook; `CountryMap.tsx` is a component using it.

Two things this exists to get right, because they are the two most commonly got
wrong:

- **`dispose()` on unmount.** The source registers map listeners, keeps tile
  requests in flight and holds decoded geometry. Without it every remount leaks
  all of that.
- **The source does not belong in React state.** It is a mutable object that
  owns canvas elements; re-rendering on every tile would be pointless and slow.
  Keep it in a ref and subscribe for the parts the UI actually renders.

Note the effect dependencies: `options` is a fresh object literal on every
render, so making it a dependency would tear the source down and rebuild it
every time. Only the url identifies the source; everything else goes through a
setter.

## Vue — `vue/CountryMap.vue`

Vue 3 with `<script setup>`. Same two rules, plus one Vue-specific point:
`shallowRef`, not `ref`. A deep `ref` would proxy an object holding canvas
elements and decoded tile geometry, which is wasteful and breaks identity
comparisons inside the library.

## Copying these

They import from `google-maps-vector-engine` as a normal dependency, so they
drop into an existing app unchanged. Inside this repo, point the import at the
build output or use `npm link`.
