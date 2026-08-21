# 📖 API Reference

## MVTSource

Main controller class for rendering vector tiles.

### Constructor

```typescript
new MVTSource(map: google.maps.Map, options: MVTSourceOptions)
```

### Essential Methods

#### Feature Selection

```typescript
// Set selected features
mvtSource.setSelectedFeatures(['feature1', 'feature2']);

// Get selected features
const selected = mvtSource.getSelectedFeatures();
const selectedIds = mvtSource.getSelectedFeatureIds();
const selectedInTile = mvtSource.getSelectedFeaturesInTile('10:512:512');

// Check feature state
if (mvtSource.isFeatureSelected('feature1')) {
  console.log('Selected');
}
if (mvtSource.isFeatureHovered('feature1')) {
  console.log('Hovered');
}
if (mvtSource.isFeatureReplaced('feature1')) {
  console.log('Replaced with GeoJSON overlay');
}

// Get specific feature
const feature = mvtSource.getFeature('feature1');

// Clear selections
mvtSource.deselectAllFeatures();
mvtSource.clearAllHoveredFeatures();
```

#### Layer Management

```typescript
// Set visible layers
mvtSource.setVisibleLayers(['boundaries', 'roads']);
mvtSource.setVisibleLayers(undefined); // Show all

// Get visible layers
const layers = mvtSource.getVisibleLayers();
```

#### Styling & Filtering

```typescript
// Update style
mvtSource.setStyle({
  fillStyle: 'red',
  selected: { fillStyle: 'orange' },
});

// Set filter
mvtSource.setFilter((feature) => feature.properties.active);
mvtSource.setFilter(false); // Remove filter
```

#### Rendering & Performance

```typescript
// Force redraw
mvtSource.redrawAllTiles();
mvtSource.redrawTile('10:512:512');

// Performance monitoring
await mvtSource.tileLoaded(); // Wait for all visible tiles to load
const metrics = { tilesLoaded: mvtSource.loadedTilesLen };

// Tile management
mvtSource.deleteTileDrawn('10:512:512');
mvtSource.clearTile(canvas);

// Cleanup
mvtSource.dispose(); // Always call when done
```

#### Tile Availability

```typescript
// Set tile availability manifest
await mvtSource.setTileAvailabilityManifest(manifest);
const currentManifest = mvtSource.getTileAvailabilityManifest();

// Refresh dynamic manifests
await mvtSource.refreshManifest();
```

## MVTSourceOptions

### Required

| Option | Type     | Description                                          |
| ------ | -------- | ---------------------------------------------------- |
| `url`  | `string` | Tile URL template: `https://api.com/{z}/{x}/{y}.pbf` |

### Common Options

| Option          | Type                       | Default          | Description                      |
| --------------- | -------------------------- | ---------------- | -------------------------------- |
| `style`         | `FeatureStyle \| Function` | `defaultStyle()` | Feature styling                  |
| `visibleLayers` | `string[]`                 | `undefined`      | Visible layers (undefined = all) |
| `cache`         | `boolean`                  | `false`          | Enable tile caching              |
| `debug`         | `boolean`                  | `false`          | Enable debug logging             |
| `tileSize`      | `number`                   | `256`            | Tile size in pixels              |
| `sourceMaxZoom` | `number \| false`          | `false`          | Max zoom for requests            |

### Selection Options

| Option                     | Type                   | Default | Description                 |
| -------------------------- | ---------------------- | ------- | --------------------------- |
| `selectedFeatures`         | `(string \| number)[]` | `[]`    | Initially selected          |
| `multipleSelection`        | `boolean`              | `false` | Allow multiple selection    |
| `setSelectedOnClick`       | `boolean`              | `true`  | Auto-select on click        |
| `toggleSelection`          | `boolean`              | `true`  | Toggle on repeat clicks     |
| `limitToFirstVisibleLayer` | `boolean`              | `false` | Stop at first clicked layer |
| `hoverDelay`               | `number`               | `0`     | Hover event delay (ms)      |

### Rendering Options

| Option           | Type              | Default     | Description                             |
| ---------------- | ----------------- | ----------- | --------------------------------------- |
| `maxPixelRatio`  | `number`          | `2`         | Ceiling on the tile backing-store scale |
| `hoverCursor`    | `string \| false` | `'pointer'` | Cursor shown over a clickable feature   |
| `fadeInDuration` | `number`          | `150`       | Tile fade-in, in ms (`0` disables)      |

Tiles render at `min(window.devicePixelRatio, maxPixelRatio)`, so they are sharp
on retina displays. Memory per tile grows with the **square** of the ratio - a
256px tile is 256KB at ratio 1 and 1MB at ratio 2 - which is why the default
stops at 2 rather than following 3x and 4x phone screens all the way up. Set
`maxPixelRatio: 1` to restore the pre-1.0 behaviour of rendering at CSS
resolution.

`hoverCursor: false` also skips the `mousemove` listener entirely when no
`onMouseHover` callback is supplied, if you want no hover work at all.

### Event Handlers

| Option                     | Type                             | Description        |
| -------------------------- | -------------------------------- | ------------------ |
| `onClick`                  | `(event: MVTMouseEvent) => void` | Click handler      |
| `onMouseHover`             | `(event: MVTMouseEvent) => void` | Hover handler      |
| `featureSelectionCallback` | `(id, data, selected) => void`   | Selection callback |

### Advanced Options

| Option                     | Type                            | Description                   |
| -------------------------- | ------------------------------- | ----------------------------- |
| `filter`                   | `(feature, context) => boolean` | Feature filter                |
| `getIDForLayerFeature`     | `(feature) => string \| number` | ID extraction                 |
| `defaultFeatureId`         | `string`                        | Default property name for IDs |
| `tileAvailabilityManifest` | `object \| function`            | Tile availability data        |
| `xhrHeaders`               | `Record<string, string>`        | Custom request headers        |
| `clickableLayers`          | `string[] \| false`             | Layers that respond to clicks |
| `customDraw`               | `function`                      | Custom drawing function       |
| `getReplacementFeature`    | `function`                      | High-detail GeoJSON provider  |

## FeatureStyle

```typescript
interface FeatureStyle {
  fillStyle?: string; // Fill color
  strokeStyle?: string; // Border color
  lineWidth?: number; // Border width
  fillOpacity?: number; // Fill opacity (0-1), multiplied into fillStyle's alpha
  radius?: number; // Point radius

  // State styles
  selected?: Partial<FeatureStyle>;
  hover?: Partial<FeatureStyle>;
}
```

`fillOpacity` **multiplies** the alpha already present in `fillStyle`, the same
way `fill-opacity` composes in Mapbox styles. So
`{ fillStyle: 'rgba(0, 100, 200, 0.5)', fillOpacity: 0.5 }` renders at alpha
0.25, and a `fillStyle` with no alpha of its own is treated as fully opaque.

When a feature is hovered and the style declares no `hover` block, a fallback
treatment lifts the fill's alpha and thickens the outline by 1px. The width
change is deliberate: emphasis carried by colour alone disappears in greyscale
and under most colour-vision deficiencies.

### Examples

```typescript
// Static style
const style = {
  fillStyle: 'rgba(70, 130, 180, 0.5)',
  strokeStyle: 'rgba(70, 130, 180, 1)',
  lineWidth: 2,
  selected: {
    fillStyle: 'rgba(255, 140, 0, 0.8)',
    lineWidth: 3,
  },
};

// Style function
const styleFunction = (feature) => {
  return feature.properties.important ? { fillStyle: 'red' } : { fillStyle: 'blue' };
};

// Style functions also receive the zoom and tile being drawn, so styling can
// vary by zoom without calling setFilter on every zoom_changed (which forces a
// full re-parse of every tile). The second argument is optional, so existing
// one-argument functions keep working unchanged.
const byZoom = (feature, context) => ({
  lineWidth: context.zoom >= 14 ? 3 : 1,
  fillStyle: 'rgba(0, 114, 178, 0.3)',
});
```

```typescript
interface StyleContext {
  zoom: number; // Integer zoom the tile is rendered at
  tileContext: TileContext; // Tile being drawn
}
```

## MVTMouseEvent

Event object for click/hover handlers.

```typescript
interface MVTMouseEvent {
  latLng: google.maps.LatLng; // Geographic coordinates
  pixel: google.maps.Point; // Screen coordinates
  feature?: MVTFeature; // Clicked feature (undefined if none)
  tileContext?: TileContext; // Tile information
  tilePoint?: Point; // Coordinates relative to tile
}
```

### Usage

```typescript
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.com/{z}/{x}/{y}.pbf',
  onClick: (event) => {
    console.log('Coordinates:', event.latLng.toString());

    if (event.feature) {
      console.log('Feature ID:', event.feature.featureId);
      console.log('Properties:', event.feature.properties);
      console.log('Selected:', event.feature.selected);
    }

    if (event.tileContext) {
      console.log('Tile:', event.tileContext.id);
    }
  },
});
```

## Utilities

### ColorUtils

```typescript
import { ColorUtils } from 'google-maps-vector-engine';

// Color conversion with opacity
const withOpacity = ColorUtils.convertColorWithOpacity('#ff0000', 0.5);
// Result: 'rgba(255, 0, 0, 0.5)'

// Check if color has alpha
const hasAlpha = ColorUtils.hasAlpha('rgba(255, 0, 0, 0.5)'); // true

// Parse RGB values
const rgb = ColorUtils.parseRgb('#ff0000');
// Result: { r: 255, g: 0, b: 0 }
const rgba = ColorUtils.parseRgb('rgba(255, 0, 0, 0.5)');
// Result: { r: 255, g: 0, b: 0, a: 0.5 }
```

### MVTUtils

```typescript
import { MVTUtils } from 'google-maps-vector-engine';

// Feature ID extraction
const id = MVTUtils.extractFeatureId(feature, 'custom_id');

// Filter creation
const filter = MVTUtils.createPropertyFilter('category', ['A', 'B']);
const styleFunc = MVTUtils.createPropertyBasedStyle('type', {
  residential: { fillStyle: 'yellow' },
  commercial: { fillStyle: 'blue' },
});

// Performance monitoring
const metrics = MVTUtils.performance.getMetrics(mvtSource);
const time = MVTUtils.performance.measureSelectionTime(mvtSource, ['f1']);
```

### Mercator

```typescript
import { Mercator } from 'google-maps-vector-engine';

// Coordinate transformations
const point = Mercator.fromLatLngToPoint(latLng);
const latLng = Mercator.fromPointToLatLng(point);
const tile = Mercator.getTileAtLatLng(latLng, zoom);
const bounds = Mercator.getTileBounds(tile);

// Geometric utilities
const inPolygon = Mercator.isPointInPolygon(point, polygon);
const inCircle = Mercator.inCircle(centerX, centerY, radius, x, y);
const distance = Mercator.getDistanceFromLine(point, linePoints);
```

## Factory Functions

### MVTFactory

```typescript
import { MVTFactory } from 'google-maps-vector-engine';

// Administrative boundaries
const config = MVTFactory.createAdministrativeConfig('https://api.example.com', 'communes', {
  setSelectedOnClick: true,
});

// High performance
const perfConfig = MVTFactory.createHighPerformanceConfig('https://tiles.com/{z}/{x}/{y}.pbf');
```

### createMVTSource

```typescript
import { createMVTSource } from 'google-maps-vector-engine';

const mvtSource = createMVTSource(map, 'https://tiles.com/{z}/{x}/{y}.pbf', { style: DefaultStyles.highContrast() });
```

## DefaultStyles

```typescript
import { DefaultStyles } from 'google-maps-vector-engine';

// Pre-built styles
DefaultStyles.basic(); // Neutral gray
DefaultStyles.minimal(); // Subtle appearance
DefaultStyles.highContrast(); // High visibility
DefaultStyles.accessible(); // Colour-vision-safe, light basemaps
DefaultStyles.dark(); // Colour-vision-safe, dark basemaps

// Selection styles
DefaultStyles.selected.polygon();
DefaultStyles.selected.point();
DefaultStyles.selected.line();
```

### Accessible presets

`accessible` and `dark` are built from the Okabe-Ito eight-colour set, in which
every pair stays distinguishable under protanopia, deuteranopia and tritanopia.

| Preset       | Basemap           | Outline            | Contrast | Selected             | Contrast |
| ------------ | ----------------- | ------------------ | -------- | -------------------- | -------- |
| `accessible` | light (`#F2F0EC`) | Blue `#0072B2`     | 4.56:1   | Vermillion `#D55E00` | 3.40:1   |
| `dark`       | dark (`#242F3E`)  | Sky blue `#56B4E9` | 5.87:1   | Orange `#E69F00`     | 6.01:1   |

Both clear the 3:1 WCAG 2.2 threshold for non-text contrast.

Selection is **not** signalled by hue alone. Blue and vermillion differ by only
1.34:1 in luminance, and sky blue and orange by 1.02:1 - which is to say they
are near-identical in greyscale and to a monochromat. The 1.5px to 4px outline
step is what actually carries the state.

The raw palette is exported if you want to build your own:

```typescript
import { AccessiblePalette } from 'google-maps-vector-engine';
// ORANGE, SKY_BLUE, BLUISH_GREEN, YELLOW, BLUE, VERMILLION, REDDISH_PURPLE, BLACK
```

## Error Handling

```typescript
try {
  const mvtSource = new MVTSource(map, {
    url: 'https://tiles.com/{z}/{x}/{y}.pbf',
    debug: true, // Shows detailed errors
  });
} catch (error) {
  console.error('MVTSource failed:', error);
}
```

The library handles gracefully:

- Network errors (failed tile requests)
- Invalid PBF data
- Missing features
- Invalid coordinates
