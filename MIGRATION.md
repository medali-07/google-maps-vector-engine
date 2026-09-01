# Migration guide

## 0.2.x to 1.0

Version 1.0 tightens the public API: types that were `any` are now real types,
five overlapping selection methods became one, and the constructor rejects
configurations that used to fail silently.

Most applications need only the selection rename. Everything else is either
additive or affects code that was relying on behaviour that did not work.

---

### Selection: five methods became one

`setSelection(ids, { mode })` replaces `setSelectedFeatures`, `addToSelection`
and `removeFromSelection`.

```diff
- mvtSource.setSelectedFeatures(['a', 'b']);
+ mvtSource.setSelection(['a', 'b']);

- mvtSource.addToSelection(['c']);
+ mvtSource.setSelection(['c'], { mode: 'add' });

- mvtSource.removeFromSelection(['a']);
+ mvtSource.setSelection(['a'], { mode: 'remove' });
```

`deselectAllFeatures()` still works and is now shorthand for
`setSelection([])`.

**Behaviour change worth knowing about.** `setSelectedFeatures` with more than
one id, and every call to `addToSelection`, used to set `multipleSelection` to
`true` **permanently** — so a single programmatic multi-select silently changed
what a user's _click_ did for the rest of the session. `multipleSelection` is
now configuration only: it governs click behaviour, and `setSelection` always
does exactly what you ask regardless of it.

If you were relying on that side effect, set the option explicitly:

```ts
new MVTSource(map, { url, multipleSelection: true });
```

---

### The constructor now validates its options

It previously accepted anything, including an empty URL: `docs/API.md` showed a
`try`/`catch` around it as the error-handling story, but there was nothing to
catch. You would find out when the map stayed blank.

It now throws `MVTOptionsError` (a subclass of `MVTError`) when:

- `url` is missing, empty, or does not contain `{z}`, `{x}` and `{y}`
- the first argument is not a `google.maps.Map`
- `tileSize` is not a positive number
- `maxPixelRatio` is below 1
- `minZoom` is greater than `maxZoom`
- `style` is neither an object nor a function

```ts
import { MVTOptionsError } from 'google-maps-vector-engine';

try {
  const source = new MVTSource(map, { url: tileUrl });
} catch (error) {
  if (error instanceof MVTOptionsError) {
    console.error(`Bad option "${error.option}": ${error.message}`);
  }
}
```

If you built a URL at runtime and it was sometimes empty, this will now throw
where it used to render nothing.

---

### Zoom limits

`minZoom` was hardcoded to `6` and was not an option, so nothing rendered below
zoom 6 and nothing said why. It now defaults to `0`.

`maxZoom` was set to `sourceMaxZoom`, which told Google Maps to stop requesting
tiles at exactly the zoom where overzooming was meant to take over — so the
overzoom path could never run. `maxZoom` now defaults to `22` and is a separate
option.

To keep the old behaviour exactly:

```ts
new MVTSource(map, { url, minZoom: 6, maxZoom: sourceMaxZoom });
```

Most callers should simply drop it: `sourceMaxZoom` now does what it says, and
tiles are overzoomed past it instead of disappearing.

---

### `MVTFactory.createAdministrativeConfig` was removed

It hardcoded French administrative divisions (`communes`, `departments`,
`iris`, `postal_code`) behind an identity map, in a library that is not about
France. Build the configuration directly:

```ts
declare const baseUrl: string;

const source = new MVTSource(map, {
  url: `${baseUrl}/communes/{z}/{x}/{y}.pbf`,
  visibleLayers: ['communes'],
  style: DefaultStyles.accessible(),
  setSelectedOnClick: true,
  cache: true,
});
```

---

### `MVTUtils.performance` was replaced by `source.getStats()`

The old helper took an `any`, reached into private fields, and read
`mvtSource.options?.debug` — a property that has never existed, so
`debugEnabled` was always `false`. `tilesLoaded` read a counter that was only
ever assigned zero.

```diff
- const metrics = MVTUtils.performance.getMetrics(mvtSource);
+ const stats = mvtSource.getStats();
```

`getStats()` returns a typed `MVTSourceStats`: visible and cached tile counts,
in-flight requests, layer and feature counts, selection and hover sizes, the
pixel ratio being rendered at, and the debug and disposal flags.

`measureSelectionTime` and `benchmarkFeatureLookup` are gone; time the calls
directly if you need them.

---

### Types

`MVTMouseEvent.feature` was `any`. It is now `MVTFeature`, and `MVTSource` is
generic over your feature properties:

```ts
interface Commune {
  name: string;
  population: number;
}

const source = new MVTSource<Commune>(map, {
  url: tileUrl,
  onClick: (event) => {
    event.feature?.properties.name; // string, not any
  },
});
```

The type argument is optional and defaults to `Record<string, unknown>`. A
plain interface is all that is needed — no index signature — so a typo like
`properties.nmae` is a compile error rather than `any`.

Eight types that were referenced by exported signatures but never exported are
now in the barrel, so a standalone `FilterFunction` or `CustomDrawFunction` can
finally be typed: `TileContext`, `TileFeatureData`, `CanvasAndFeatures`,
`GeoJSONFeature`, `FeatureReplacementFunction`, `FeatureSelectionCallback`,
`ClickEventCallback`, `HoverEventCallback`.

The unused `IMVTSource`, `IMVTFeature` and `IMVTLayer` interfaces were removed.
They existed only to work around a circular import that `import type` solves,
and nothing referenced them.

`featureSelectionCallback`'s second argument is now typed `GeoJSONFeature`,
which is what it always received.

`MVTFeature.type` is now `GeometryType` rather than `number`.

---

### Events

Constructor callbacks still work. There is now also `on` / `off` / `once`, so
you can add a second listener, remove one, or change one after construction:

```ts
const stop = source.on('tileerror', ({ tileId, status }) => {
  console.warn(`Tile ${tileId} failed`, status);
});

source.on('selectionchange', ({ selected, added, removed }) => {
  console.log(selected.length, 'selected', added, removed);
});
source.once('load', () => console.log('first viewport ready'));

stop(); // or source.off('tileerror', listener)
```

Events: `tileload`, `tileerror`, `load`, `idle`, `selectionchange`, `click`,
`hover`.

`on` returns an unsubscribe function, so you do not have to keep the listener
reference around.

---

### GeoJSON overlay hover events

The `mouseover` and `mousemove` handlers for replaced features used to hand
your callback a fabricated object literal — `{ featureId, properties }` — which
is not an `MVTFeature`, so every other documented property of `event.feature`
was missing at runtime while the type claimed otherwise.

They now pass the real feature. If the feature is not currently loaded,
`event.feature` is `undefined`, matching the vector tile path. Guard it:

```diff
- source.on('hover', (event) => doSomething(event.feature.featureId));
+ source.on('hover', (event) => event.feature && doSomething(event.feature.featureId));
```

---

### Internal methods removed from the published types

`registerFeature`, `unregisterFeature`, `drawTile`, `getTileId`,
`getTileObject`, `deleteTileDrawn`, `clearTile`, `getStyleForFeature`,
`getSelectedFeaturesInTile` and `isFeatureReplaced` are tagged `@internal` and
no longer appear in the `.d.ts`. They still exist at runtime, but they are not
supported and may change without a major version.

`getTile` and `releaseTile` remain public because `google.maps.MapType`
requires them. Google Maps calls those; you should not.

---

### Debug logging

`DebugLogger` was a process-global singleton, so constructing a second source
with `debug: false` silently turned debugging off for the first. Sources now
register interest and debug output stays on while any of them wants it.

`setDebug(enabled)` still forces the flag globally; pass `null` to hand control
back to the per-source requests.

Log output no longer emits raw ANSI escape codes, which rendered as literal
`[36m` garbage in browser consoles. Colour now uses `%c` and CSS in browsers,
and ANSI only in a real terminal.

---

## New in 1.0

Additions that need no migration:

| API                                                                | What it does                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| `on` / `off` / `once`                                              | Add, remove and replace event listeners                   |
| `getStats()`                                                       | Typed snapshot of tiles, features, selection and requests |
| `getFeatureBounds(id)`                                             | Geographic bounds of a feature across the tiles it spans  |
| `fitBounds(id, padding?)`                                          | Pan and zoom the map to a feature                         |
| `refreshTile(id)`                                                  | Re-fetch a tile from the network, bypassing the cache     |
| `setOpacity()` / `getOpacity()`                                    | Fade the whole source                                     |
| `show()` / `hide()` / `isVisible()`                                | Toggle rendering without tearing the source down          |
| `getUrl()` / `getFilter()` / `getStyle()` / `getClickableLayers()` | Complete the setter pairs                                 |
| `minZoom` / `maxZoom` options                                      | Control the zoom range that requests tiles                |
