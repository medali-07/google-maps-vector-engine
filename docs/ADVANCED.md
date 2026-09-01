# 🚀 Advanced Features

## High-Detail GeoJSON Overlays

Replace simple tile features with detailed GeoJSON for selected items:

```typescript
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',

  getReplacementFeature: async (feature, featureId) => {
    try {
      const response = await fetch(`/api/features/${featureId}/detail`);
      return await response.json();
    } catch (error) {
      console.warn('Failed to load detailed feature:', error);
      return null;
    }
  },

  onClick: (event) => {
    // Feature automatically replaced with high-detail version
    console.log('Loading detailed feature...');
  },
});
```

## Tile Availability Optimization

Avoid unnecessary requests using tile availability manifests:

```typescript
import { ManifestUtils } from 'google-maps-vector-engine';

// Create manifest fetcher with auth
const manifestFetcher = ManifestUtils.createManifestFetcher('https://api.example.com/manifest', {
  Authorization: 'Bearer your-token',
});

const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',
  tileAvailabilityManifest: manifestFetcher,
});

// Or use static manifest
const staticManifest = {
  '10': {
    '512': [
      [256, 300],
      [400, 450],
    ], // Y ranges with data
    '513': [[256, 300]],
  },
};
```

## Custom Feature ID Extraction

Handle various ID field formats:

```typescript
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',

  getIDForLayerFeature: (feature) => {
    // Try several id fields, then fall back. Note the String()/Number()
    // coercion: a property can be a boolean, and a boolean is never a usable
    // id - the library's own default rejects them for the same reason.
    const candidate = feature.properties.objectid ?? feature.properties.fid ?? feature.id;
    if (typeof candidate === 'string' || typeof candidate === 'number') return candidate;
    return `fallback_${String(feature.properties.name ?? 'unknown')}`;
  },

  // Or specify default property
  defaultFeatureId: 'objectid',
});
```

## Custom Drawing Functions

Add special effects for specific features:

```typescript
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',

  customDraw: (tileContext, tileFeatureData, style, feature) => {
    const ctx = tileFeatureData.context2d;
    if (!ctx) return;

    // Glow effect for important features
    if (Number(feature.properties.importance ?? 0) > 8) {
      ctx.shadowColor = 'yellow';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // Special highlighting
    if (feature.properties.type === 'highlight') {
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  },
});
```

## Advanced Styling Patterns

### Complex Data-Driven Styling

```typescript
const styleFunction: FeatureStyleFunction = (feature) => {
  const { population_density, land_use, importance } = feature.properties;

  // Base style by land use
  const baseColors: Record<string, string> = {
    residential: 'rgba(255, 255, 0, 0.4)',
    commercial: 'rgba(255, 0, 255, 0.4)',
    industrial: 'rgba(0, 255, 255, 0.4)',
  };

  // Modify opacity based on density
  const opacity = Math.min(0.8, 0.3 + (Number(population_density ?? 0) / 1000) * 0.5);
  const baseColor = baseColors[String(land_use)] || 'rgba(200, 200, 200, 0.3)';
  const color = baseColor.replace(/[\d\.]+\)$/, `${opacity})`);

  return {
    fillStyle: color,
    strokeStyle: 'rgba(100, 100, 100, 0.8)',
    lineWidth: Number(importance ?? 0) > 5 ? 2 : 1,
    selected: {
      fillStyle: 'rgba(255, 140, 0, 0.8)',
      strokeStyle: 'rgba(255, 100, 0, 1)',
      lineWidth: 3,
    },
  };
};
```

### Animated Styling

```typescript
let animationFrame = 0;

const animatedStyle: FeatureStyleFunction = (feature) => {
  const baseHue = Number(feature.properties.category_id ?? 0) * 60;
  const animatedHue = (baseHue + animationFrame) % 360;

  return {
    fillStyle: `hsla(${animatedHue}, 70%, 50%, 0.5)`,
    strokeStyle: `hsla(${animatedHue}, 70%, 30%, 1)`,
    lineWidth: 2,
  };
};

function startAnimation() {
  setInterval(() => {
    animationFrame = (animationFrame + 1) % 360;
    mvtSource.setStyle(animatedStyle);
  }, 100);
}
```

## Complex Filtering

### Multi-Criteria Filtering

```typescript
const complexFilter: FilterFunction = (feature, tileContext) => {
  const { status, visible, date_created, population, area, category, type } = feature.properties;

  // Basic requirements
  const isActive = status === 'active';
  const isVisible = visible !== false;
  const hasData = population !== null && Number(area ?? 0) > 0;

  // Special rules by type
  if (category === 'priority') return isActive;
  if (type === 'temporary') return isActive && date_created > '2020-01-01';

  return isActive && isVisible && hasData;
};

mvtSource.setFilter(complexFilter);
```

### Dynamic Zoom-Based Filtering

```typescript
const zoomBasedFilter: FilterFunction = (feature, tileContext) => {
  const currentZoom = map.getZoom() ?? 0;
  const importance = Number(feature.properties.importance ?? 0);

  // Show more features at higher zoom
  if (currentZoom >= 15) return importance >= 1;
  if (currentZoom >= 12) return importance >= 3;
  return importance >= 7;
};

map.addListener('zoom_changed', () => {
  mvtSource.setFilter(zoomBasedFilter);
});
```

## State Synchronization

Sync multiple MVT sources:

```typescript
class MVTSourceManager {
  private sources: MVTSource[] = [];
  private globalSelection: string[] = [];

  addSource(mvtSource: MVTSource) {
    this.sources.push(mvtSource);
    mvtSource.setSelection(this.globalSelection);
  }

  setGlobalSelection(featureIds: string[]) {
    this.globalSelection = featureIds;
    this.sources.forEach((source) => source.setSelection(featureIds));
  }

  dispose() {
    this.sources.forEach((source) => source.dispose());
    this.sources = [];
  }
}

// Usage
declare const boundariesSource: MVTSource;
declare const roadsSource: MVTSource;

const manager = new MVTSourceManager();
manager.addSource(boundariesSource);
manager.addSource(roadsSource);
manager.setGlobalSelection(['feature1', 'feature2']);
```

## Advanced Event Handling

### Complex Click Handling

`MVTMouseEvent` does not carry the originating DOM event, so modifier keys are
not reachable from `onClick`. Record them from a map listener, which fires for
the same click:

```typescript
let lastModifiers = { ctrlKey: false, shiftKey: false };

map.addListener('click', (event: google.maps.MapMouseEvent) => {
  const dom = event.domEvent as MouseEvent | undefined;
  lastModifiers = { ctrlKey: Boolean(dom?.ctrlKey), shiftKey: Boolean(dom?.shiftKey) };
});

const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',

  onClick: async (event) => {
    if (!event.feature) return;

    const { type, id } = event.feature.properties;

    // MVTMouseEvent carries no reference to the originating DOM event, so
    // modifier keys have to come from a separate map listener. Record them
    // there and read them here.
    const { ctrlKey: isCtrlClick, shiftKey: isShiftClick } = lastModifiers;

    // Different actions by feature type
    switch (type) {
      case 'building':
        await loadBuildingDetails(id);
        break;
      case 'poi':
        showPointOfInterestInfo(event.feature.properties);
        break;
      case 'boundary':
        if (isCtrlClick) {
          toggleBoundarySelection(id);
        } else if (isShiftClick) {
          addToBoundarySelection(id);
        } else {
          selectBoundary(id);
        }
        break;
    }

    // Analytics
    trackFeatureInteraction('click', type, id);
  },
});
```

## Batch Operations

### Select by Criteria

There is no public iterator over every loaded feature — a source only holds
what is currently in view, so such a list would be a moving target. Build the
index yourself as tiles are parsed: the style function sees every feature.

```typescript
const byCategory = new Map<string, Set<string | number>>();

const indexingStyle: FeatureStyleFunction = (feature) => {
  const category = String(feature.properties.category ?? 'none');
  const id = feature.id ?? feature.properties.fid;

  if (id !== undefined) {
    const bucket = byCategory.get(category) ?? new Set();
    bucket.add(id as string | number);
    byCategory.set(category, bucket);
  }

  return DefaultStyles.accessible();
};

function selectByCategory(category: string): void {
  mvtSource.setSelection([...(byCategory.get(category) ?? [])]);
}

function updateStyleByProperty(propertyName: string, styles: Record<any, any>) {
  const dynamicStyle = (feature: any) => {
    const value = feature.properties[propertyName];
    return styles[value] || DefaultStyles.basic();
  };

  mvtSource.setStyle(dynamicStyle);
}
```

## Custom Manifest Management

### Dynamic Manifest with Caching

```typescript
const manifestCache = new Map();

async function getDynamicManifest(region: string) {
  if (manifestCache.has(region)) {
    return manifestCache.get(region);
  }

  try {
    const fetcher = ManifestUtils.createManifestFetcher(`https://api.example.com/manifest/${region}`, {
      Authorization: 'Bearer token',
    });

    const manifest = await fetcher();
    manifestCache.set(region, manifest);
    return manifest;
  } catch (error) {
    console.error('Manifest load failed:', error);
    return null;
  }
}

// Use with dynamic regions
map.addListener('bounds_changed', async () => {
  const bounds = map.getBounds();
  const region = calculateRegion(bounds);
  const manifest = await getDynamicManifest(region);

  if (manifest) {
    // `mvtSource.options` has never existed. The manifest is replaced through
    // the setter, which also re-resolves it if it is a function.
    await mvtSource.setTileAvailabilityManifest(manifest);
  }
});
```

## Performance Monitoring

### Advanced Performance Tracking

```typescript
class PerformanceMonitor {
  private metrics = {
    tileLoadTimes: [] as number[],
    renderTimes: [] as number[],
    selectionTimes: [] as number[],
  };

  constructor(private mvtSource: MVTSource) {
    this.setupMonitoring();
  }

  private setupMonitoring() {
    // Monitor tile loading
    const originalGetTile = this.mvtSource.getTile.bind(this.mvtSource);
    this.mvtSource.getTile = (coord, zoom, doc) => {
      const start = performance.now();
      const result = originalGetTile(coord, zoom, doc);
      this.metrics.tileLoadTimes.push(performance.now() - start);
      return result;
    };

    // Monitor selection performance
    const originalSetSelected = this.mvtSource.setSelection.bind(this.mvtSource);
    this.mvtSource.setSelection = (ids) => {
      const start = performance.now();
      originalSetSelected(ids);
      this.metrics.selectionTimes.push(performance.now() - start);
    };
  }

  getMetrics() {
    return {
      avgTileTime: this.average(this.metrics.tileLoadTimes),
      avgSelectionTime: this.average(this.metrics.selectionTimes),
      totalTiles: this.metrics.tileLoadTimes.length,
    };
  }

  private average(arr: number[]) {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }
}

const monitor = new PerformanceMonitor(mvtSource);
setInterval(() => console.table(monitor.getMetrics()), 30000);
```
