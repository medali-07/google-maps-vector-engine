# ⚡ Performance Guide

## Essential Configuration

```typescript
// High-performance setup
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',

  // Critical settings
  cache: true, // Always enable for production
  debug: false, // Disable in production
  tileSize: 256, // Standard size
  sourceMaxZoom: 18, // Match your data

  // Optimize content
  visibleLayers: ['boundaries'], // Only show needed layers
  style: DefaultStyles.minimal(), // Simple styles

  // Limit interactions
  multipleSelection: false, // If single selection works
  hoverDelay: 200, // Reduce hover sensitivity
});
```

## Memory Management

### Tile Caching

```typescript
// Custom cache management
class MemoryManagedMVTSource {
  private readonly mvtSource: MVTSource;
  private tileCache = new Map<string, unknown>();

  constructor(map: google.maps.Map, options: MVTSourceOptions) {
    this.mvtSource = new MVTSource(map, { ...options, cache: true });
  }

  dispose(): void {
    this.mvtSource.dispose();
    this.tileCache.clear();
  }
}
```

### Component Cleanup

```typescript
// React
useEffect(() => {
  return () => mvtSource?.dispose();
}, [mvtSource]);

// Vue
onUnmounted(() => mvtSource?.dispose());
```

## Styling Optimization

### Use Static Styles

```typescript
// ✅ Fast - static styles
const staticStyle = {
  fillStyle: 'rgba(70, 130, 180, 0.4)',
  strokeStyle: 'rgba(70, 130, 180, 1)',
  lineWidth: 1,
};

// ✅ Fast - pre-computed mapping
const categoryStyles: Record<string, FeatureStyle> = {
  residential: { fillStyle: 'rgba(255, 255, 0, 0.4)' },
  commercial: { fillStyle: 'rgba(255, 0, 255, 0.4)' },
};

const styleFunction: FeatureStyleFunction = (feature) => {
  return categoryStyles[String(feature.properties.category)] || staticStyle;
};
```

### Avoid Complex Calculations

```typescript
import type { FeatureStyle, FeatureStyleFunction } from 'google-maps-vector-engine';

declare function calculateArea(feature: unknown): number;
declare function generateComplexStyle(density: number): FeatureStyle;

const redStyle: FeatureStyle = { fillStyle: 'rgba(213, 94, 0, 0.5)' };
const blueStyle: FeatureStyle = { fillStyle: 'rgba(0, 114, 178, 0.3)' };

// Slow: real work on every feature, on every redraw.
const expensive: FeatureStyleFunction = (feature) => {
  const area = calculateArea(feature);
  const density = Number(feature.properties.population) / area;
  return generateComplexStyle(density);
};

// Fast: a property lookup and a branch.
const cheap: FeatureStyleFunction = (feature) => {
  return feature.properties.important ? redStyle : blueStyle;
};
```

## Layer Management

### Zoom-Based Visibility

```typescript
import type { MVTSource } from 'google-maps-vector-engine';

class LayerManager {
  constructor(map: google.maps.Map, mvtSource: MVTSource) {
    map.addListener('zoom_changed', () => {
      const zoom = map.getZoom() ?? 0;
      const layers = this.getLayersForZoom(zoom);
      mvtSource.setVisibleLayers(layers);
    });
  }

  getLayersForZoom(zoom: number): string[] {
    if (zoom < 6) return ['countries'];
    if (zoom < 10) return ['countries', 'states'];
    if (zoom < 14) return ['countries', 'states', 'cities'];
    return ['countries', 'states', 'cities', 'buildings'];
  }
}
```

## Network Optimization

### Tile Availability Manifest

```typescript
import { ManifestUtils } from 'google-maps-vector-engine';

// Only request available tiles
const manifest = {
  '10': {
    '512': [[256, 300]], // Y ranges with data
    '513': [[256, 300]],
  },
};

// Validate before use
if (ManifestUtils.validateManifest(manifest)) {
  const mvtSource = new MVTSource(map, {
    url: 'https://tiles.com/{z}/{x}/{y}.pbf',
    tileAvailabilityManifest: manifest,
    xhrHeaders: {
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
}

// Use API-based manifests for large datasets
const manifestFetcher = ManifestUtils.createManifestFetcher('https://api.example.com/manifest', {
  Authorization: 'Bearer token',
});
```

## Performance Monitoring

```typescript
const stats = mvtSource.getStats();
console.log('Performance:', {
  visibleTiles: stats.visibleTiles,
  cachedTiles: stats.cachedTiles,
  pendingRequests: stats.pendingRequests,
  features: stats.features,
  selectedFeatures: stats.selectedFeatures,
  pixelRatio: stats.pixelRatio,
});

// Watch loading progress
mvtSource.on('tileload', ({ tileId }) => console.log(`loaded ${tileId}`));
mvtSource.on('idle', () => console.log(mvtSource.getStats()));
```

`MVTUtils.performance` was removed in 1.0: it read `mvtSource.options?.debug`,
a property that never existed, and a tile counter that was only ever zero.

## Best Practices Checklist

### ✅ Production Settings

- `cache: true`
- `debug: false`
- `tileSize: 256`
- `sourceMaxZoom` matching your data

### ✅ Content Optimization

- Limit `visibleLayers` to essentials
- Use simple styles for large datasets
- Implement zoom-based layer visibility
- Use tile availability manifest

### ✅ Memory Management

- Always call `dispose()` when done
- Limit feature selection count
- Clear selections when not needed
- Monitor memory usage in dev tools

### ❌ Performance Anti-Patterns

- Complex style functions for large datasets
- `debug: true` in production
- Showing all layers at all zoom levels
- Missing `dispose()` calls
- Rapid style changes in loops

## Quick Performance Test

```typescript
async function performanceTest() {
  const start = performance.now();

  const mvtSource = new MVTSource(map, {
    url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',
    debug: true,
  });

  // Test selection
  const selectionStart = performance.now();
  mvtSource.setSelection(['f1', 'f2', 'f3']);
  const selectionTime = performance.now() - selectionStart;

  console.log('Performance:', {
    initTime: (performance.now() - start).toFixed(2) + 'ms',
    selectionTime: selectionTime.toFixed(2) + 'ms',
  });

  mvtSource.dispose();
}
```
