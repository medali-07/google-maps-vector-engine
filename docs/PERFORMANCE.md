# ⚡ Performance Guide

## Essential Configuration

```typescript
// High-performance setup
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',
  
  // Critical settings
  cache: true,           // Always enable for production
  debug: false,          // Disable in production
  tileSize: 256,         // Standard size
  sourceMaxZoom: 18,     // Match your data
  
  // Optimize content
  visibleLayers: ['boundaries'], // Only show needed layers
  style: DefaultStyles.minimal(), // Simple styles
  
  // Limit interactions
  multipleSelection: false,  // If single selection works
  hoverDelay: 200           // Reduce hover sensitivity
});
```

## Memory Management

### Tile Caching
```typescript
// Custom cache management
class MemoryManagedMVTSource {
  private tileCache = new Map();
  private maxCacheSize = 100;
  
  constructor(map, options) {
    this.mvtSource = new MVTSource(map, {
      ...options,
      cache: true
    });
  }
  
  dispose() {
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
  lineWidth: 1
};

// ✅ Fast - pre-computed mapping
const categoryStyles = {
  'residential': { fillStyle: 'rgba(255, 255, 0, 0.4)' },
  'commercial': { fillStyle: 'rgba(255, 0, 255, 0.4)' }
};

const styleFunction = (feature) => {
  return categoryStyles[feature.properties.category] || staticStyle;
};
```

### Avoid Complex Calculations
```typescript
// ❌ Slow - complex calculations in style function
style: (feature) => {
  const area = calculateArea(feature.geometry); // Expensive!
  const density = feature.properties.population / area;
  return generateComplexStyle(density);
}

// ✅ Fast - simple property lookup
style: (feature) => {
  return feature.properties.important ? redStyle : blueStyle;
}
```

## Layer Management

### Zoom-Based Visibility
```typescript
class LayerManager {
  constructor(map, mvtSource) {
    map.addListener('zoom_changed', () => {
      const zoom = map.getZoom();
      const layers = this.getLayersForZoom(zoom);
      mvtSource.setVisibleLayers(layers);
    });
  }
  
  getLayersForZoom(zoom) {
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
  "10": {
    "512": [[256, 300]], // Y ranges with data
    "513": [[256, 300]]
  }
};

// Validate before use
if (ManifestUtils.validateManifest(manifest)) {
  const mvtSource = new MVTSource(map, {
    url: 'https://tiles.com/{z}/{x}/{y}.pbf',
    tileAvailabilityManifest: manifest,
    xhrHeaders: {
      'Accept-Encoding': 'gzip, deflate, br'
    }
  });
}

// Use API-based manifests for large datasets
const manifestFetcher = ManifestUtils.createManifestFetcher(
  'https://api.example.com/manifest',
  { 'Authorization': 'Bearer token' }
);
```

## Performance Monitoring

```typescript
import { MVTUtils } from 'google-maps-vector-engine';

// Get metrics
const metrics = MVTUtils.performance.getMetrics(mvtSource);
console.log('Performance:', {
  tilesLoaded: metrics.tilesLoaded,
  featuresSelected: metrics.featuresSelected,
  averageRenderTime: metrics.averageRenderTime
});

// Benchmark selection
const time = MVTUtils.performance.measureSelectionTime(mvtSource, ['f1', 'f2']);
console.log(`Selection: ${time}ms`);
```

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
    debug: true
  });
  
  // Test selection
  const selectionStart = performance.now();
  mvtSource.setSelectedFeatures(['f1', 'f2', 'f3']);
  const selectionTime = performance.now() - selectionStart;
  
  console.log('Performance:', {
    initTime: (performance.now() - start).toFixed(2) + 'ms',
    selectionTime: selectionTime.toFixed(2) + 'ms'
  });
  
  mvtSource.dispose();
}
```