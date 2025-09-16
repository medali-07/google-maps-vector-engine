# 💡 Examples

## Table of Contents

- [Basic Setup](#basic-setup)
  - [Simple Vector Tiles](#simple-vector-tiles)
  - [Multiple Tile Sources](#multiple-tile-sources)
- [Administrative Boundaries](#administrative-boundaries)
  - [Country Selection](#country-selection)
  - [Multi-Select with Controls](#multi-select-with-controls)
- [Data Visualization](#data-visualization)
  - [Choropleth Map](#choropleth-map)
  - [Real-time Data](#real-time-data)
- [Interactive Features](#interactive-features)
  - [Search and Highlight](#search-and-highlight)
  - [High-Detail GeoJSON Overlays](#high-detail-geojson-overlays)
- [Framework Integration](#framework-integration)
  - [React Hook](#react-hook)
  - [Vue Composable](#vue-composable)
- [Performance Optimization](#performance-optimization)
  - [Memory-Efficient Large Datasets](#memory-efficient-large-datasets)
  - [Tile Availability Manifests](#tile-availability-manifests)
  - [Lazy Loading](#lazy-loading)


## Basic Setup

### Simple Vector Tiles
```typescript
import { MVTSource, DefaultStyles } from 'google-maps-vector-engine';

const map = new google.maps.Map(document.getElementById('map'), {
  center: { lat: 46.52, lng: 6.57 },
  zoom: 9
});

const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',
  style: DefaultStyles.basic(),
  cache: true
});
```

### Multiple Tile Sources
```typescript
// Administrative boundaries
const boundaries = new MVTSource(map, {
  url: 'https://admin.tiles.com/{z}/{x}/{y}.pbf',
  visibleLayers: ['countries', 'states'],
  style: {
    fillStyle: 'rgba(70, 130, 180, 0.3)',
    strokeStyle: 'rgba(70, 130, 180, 1)'
  }
});

// Points of interest
const pois = new MVTSource(map, {
  url: 'https://poi.tiles.com/{z}/{x}/{y}.pbf',
  visibleLayers: ['restaurants', 'hotels'],
  style: { fillStyle: 'rgba(255, 165, 0, 0.8)', radius: 6 }
});

// Cleanup
function cleanup() {
  boundaries.dispose();
  pois.dispose();
}
```

## Administrative Boundaries

### Country Selection
```typescript
import { MVTFactory } from 'google-maps-vector-engine';

const config = MVTFactory.createAdministrativeConfig(
  'https://boundaries.example.com',
  'countries',
  {
    setSelectedOnClick: true,
    multipleSelection: false,
    
    onClick: (event) => {
      if (event.feature) {
        const country = event.feature.properties;
        showCountryInfo(country.name, country.population);
      }
    },
    
    style: {
      fillStyle: 'rgba(70, 130, 180, 0.3)',
      strokeStyle: 'rgba(70, 130, 180, 0.8)',
      selected: {
        fillStyle: 'rgba(255, 140, 0, 0.6)',
        lineWidth: 3
      }
    }
  }
);

const countrySource = new MVTSource(map, config);

function showCountryInfo(name, population) {
  document.getElementById('info').innerHTML = `
    <h3>${name}</h3>
    <p>Population: ${population.toLocaleString()}</p>
  `;
}
```

### Multi-Select with Controls
```typescript
const municipalitySource = new MVTSource(map, {
  url: 'https://municipal.tiles.com/{z}/{x}/{y}.pbf',
  
  style: (feature) => {
    const isUrban = feature.properties.population_density > 1000;
    return {
      fillStyle: isUrban ? 'rgba(255, 100, 100, 0.4)' : 'rgba(100, 255, 100, 0.4)',
      strokeStyle: isUrban ? '#cc0000' : '#00cc00',
      selected: { fillStyle: 'rgba(255, 140, 0, 0.7)', lineWidth: 3 }
    };
  },
  
  setSelectedOnClick: true,
  toggleSelection: true,
  
  featureSelectionCallback: (featureId, featureData, selected) => {
    updateSelectedList();
  }
});

function updateSelectedList() {
  const selected = municipalitySource.getSelectedFeatures();
  document.getElementById('selected-list').innerHTML = selected.map(feature => `
    <li>${feature.properties.name} (Pop: ${feature.properties.population.toLocaleString()})</li>
  `).join('');
}
```

## Data Visualization

### Choropleth Map
```typescript
// Load population data
const populationData = await fetch('/api/population-data').then(r => r.json());

const choroplethSource = new MVTSource(map, {
  url: 'https://boundaries.tiles.com/{z}/{x}/{y}.pbf',
  
  style: (feature) => {
    const population = populationData[feature.properties.id] || 0;
    
    let color;
    if (population > 1000000) color = 'rgba(165, 0, 38, 0.7)';
    else if (population > 500000) color = 'rgba(215, 48, 39, 0.7)';
    else if (population > 100000) color = 'rgba(244, 109, 67, 0.7)';
    else if (population > 50000) color = 'rgba(253, 174, 97, 0.7)';
    else color = 'rgba(255, 255, 191, 0.7)';
    
    return {
      fillStyle: color,
      strokeStyle: 'rgba(100, 100, 100, 0.8)',
      lineWidth: 0.5,
      hover: { strokeStyle: 'rgba(0, 0, 0, 1)', lineWidth: 2 }
    };
  },
  
  onClick: (event) => {
    if (event.feature) {
      const props = event.feature.properties;
      const population = populationData[props.id] || 0;
      showPopup(event.latLng, props.name, population);
    }
  }
});

function showPopup(position, name, population) {
  new google.maps.InfoWindow({
    content: `<h4>${name}</h4><p>Population: ${population.toLocaleString()}</p>`,
    position
  }).open(map);
}
```

### Real-time Data
```typescript
class RealTimeVisualization {
  private mvtSource: MVTSource;
  private dataSocket: WebSocket;
  private currentData: Record<string, number> = {};
  
  constructor(map: google.maps.Map, tileUrl: string, socketUrl: string) {
    this.mvtSource = new MVTSource(map, {
      url: tileUrl,
      style: (feature) => {
        const value = this.currentData[feature.properties.id] || 0;
        const intensity = Math.min(value / 100, 1);
        return {
          fillStyle: `rgba(255, ${255 * (1 - intensity)}, 0, 0.6)`,
          strokeStyle: 'rgba(100, 100, 100, 1)'
        };
      }
    });
    
    this.dataSocket = new WebSocket(socketUrl);
    this.dataSocket.onmessage = (event) => {
      const update = JSON.parse(event.data);
      this.currentData = { ...this.currentData, ...update };
      this.mvtSource.redrawAllTiles();
    };
  }
  
  dispose() {
    this.mvtSource.dispose();
    this.dataSocket.close();
  }
}
```

## Interactive Features

### Search and Highlight
```typescript
class FeatureSearch {
  private mvtSource: MVTSource;
  private searchResults: string[] = [];
  
  constructor(map: google.maps.Map, url: string) {
    this.mvtSource = new MVTSource(map, {
      url,
      style: (feature) => {
        const isResult = this.searchResults.includes(feature.properties.id);
        const isSelected = this.mvtSource.isFeatureSelected(feature.properties.id);
        
        if (isSelected) {
          return { fillStyle: 'rgba(255, 140, 0, 0.8)', lineWidth: 3 };
        } else if (isResult) {
          return { fillStyle: 'rgba(255, 255, 0, 0.6)', lineWidth: 2 };
        } else {
          return { fillStyle: 'rgba(70, 130, 180, 0.3)', lineWidth: 1 };
        }
      }
    });
  }
  
  async search(query: string) {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const results = await response.json();
    
    this.searchResults = results.map(r => r.id);
    this.mvtSource.redrawAllTiles();
    
    this.displayResults(results);
  }
  
  private displayResults(results: any[]) {
    document.getElementById('search-results').innerHTML = `
      <h4>${results.length} Results</h4>
      ${results.map(r => `
        <div onclick="featureSearch.selectResult('${r.id}')">
          <strong>${r.name}</strong>
        </div>
      `).join('')}
    `;
  }
  
  selectResult(featureId: string) {
    this.mvtSource.setSelectedFeatures([featureId]);
  }
}
```

### High-Detail GeoJSON Overlays

Replace simple tile features with detailed geometries for selected items:

```typescript
const mvtSource = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',
  
  getReplacementFeature: async (feature, featureId) => {
    try {
      // Fetch high-detail geometry from API
      const response = await fetch(`/api/features/${featureId}/detail`);
      const geoJSON = await response.json();
      return geoJSON;
    } catch (error) {
      console.warn('Failed to load detailed feature:', error);
      return null; // Fallback to original feature
    }
  },
  
  featureSelectionCallback: (featureId, featureData, selected) => {
    if (selected) {
      console.log('Selected feature with detailed geometry:', featureData);
      // Feature is now displayed as high-detail GeoJSON overlay
    } else {
      console.log('Deselected feature, back to simple tile rendering');
    }
  },
  
  onClick: (event) => {
    if (event.feature) {
      console.log('Clicked feature, loading detailed version...');
    }
  }
});
```

## Framework Integration

### React Hook
```typescript
import { useEffect, useRef, useState } from 'react';
import { MVTSource } from 'google-maps-vector-engine';

export function useVectorTiles(map: google.maps.Map | null, url: string, options = {}) {
  const mvtSourceRef = useRef<MVTSource | null>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  useEffect(() => {
    if (!map) return;

    const mvtSource = new MVTSource(map, {
      url,
      setSelectedOnClick: true,
      featureSelectionCallback: (featureId, featureData, selected) => {
        setSelectedFeatures(prev => 
          selected ? [...prev, featureId] : prev.filter(id => id !== featureId)
        );
      },
      ...options
    });

    mvtSourceRef.current = mvtSource;

    return () => mvtSource.dispose();
  }, [map, url]);

  const updateSelection = (ids: string[]) => {
    mvtSourceRef.current?.setSelectedFeatures(ids);
    setSelectedFeatures(ids);
  };

  return {
    mvtSource: mvtSourceRef.current,
    selectedFeatures,
    setSelectedFeatures: updateSelection
  };
}

// Usage
function MapComponent() {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const { selectedFeatures, setSelectedFeatures } = useVectorTiles(
    map, 
    'https://tiles.example.com/{z}/{x}/{y}.pbf'
  );

  return (
    <div>
      <div ref={mapRef => {
        if (mapRef && !map) {
          setMap(new google.maps.Map(mapRef, {
            center: { lat: 46.52, lng: 6.57 },
            zoom: 9
          }));
        }
      }} style={{ height: '400px' }} />
      
      <div>Selected: {selectedFeatures.length} features</div>
      <button onClick={() => setSelectedFeatures([])}>Clear</button>
    </div>
  );
}
```

### Vue Composable
```typescript
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { MVTSource } from 'google-maps-vector-engine';

export function useVectorTiles(map: Ref<google.maps.Map | null>, url: string, options = {}) {
  const mvtSource = ref<MVTSource | null>(null);
  const selectedFeatures = ref<string[]>([]);

  const initializeSource = () => {
    if (!map.value) return;

    mvtSource.value = new MVTSource(map.value, {
      url,
      setSelectedOnClick: true,
      featureSelectionCallback: (featureId, featureData, selected) => {
        if (selected) {
          selectedFeatures.value.push(featureId);
        } else {
          const index = selectedFeatures.value.indexOf(featureId);
          if (index > -1) selectedFeatures.value.splice(index, 1);
        }
      },
      ...options
    });
  };

  watch(map, initializeSource, { immediate: true });

  onUnmounted(() => {
    mvtSource.value?.dispose();
  });

  return { mvtSource, selectedFeatures };
}
```

## Performance Optimization

### Memory-Efficient Large Datasets
```typescript
class MemoryEfficientViewer {
  private mvtSource: MVTSource;
  private loadedRegions = new Set<string>();
  
  constructor(map: google.maps.Map, baseUrl: string) {
    this.mvtSource = new MVTSource(map, {
      url: `${baseUrl}/{z}/{x}/{y}.pbf`,
      cache: true,
      visibleLayers: this.getLayersForZoom(map.getZoom()),
      style: DefaultStyles.minimal()
    });
    
    // Update layers based on zoom
    map.addListener('zoom_changed', () => {
      const layers = this.getLayersForZoom(map.getZoom());
      this.mvtSource.setVisibleLayers(layers);
    });
  }
  
  private getLayersForZoom(zoom: number): string[] {
    if (zoom < 8) return ['countries'];
    if (zoom < 12) return ['countries', 'states'];
    return ['countries', 'states', 'cities'];
  }
}
```

### Tile Availability Manifests

Optimize network requests by only loading tiles that contain data:

```typescript
import { ManifestUtils } from 'google-maps-vector-engine';

// Static manifest
const staticManifest = {
  "10": {
    "512": [[256, 300], [400, 450]], // Y ranges with data at x=512
    "513": [[256, 300]]               // Y ranges with data at x=513
  },
  "11": {
    "1024": [[512, 600]],
    "1025": [[512, 600]]
  }
};

// Validate manifest structure
if (ManifestUtils.validateManifest(staticManifest)) {
  const mvtSource = new MVTSource(map, {
    url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',
    tileAvailabilityManifest: staticManifest,
    cache: true
  });
}

// Dynamic manifest from API
const manifestFetcher = ManifestUtils.createManifestFetcher(
  'https://api.example.com/tile-manifest',
  { 'Authorization': 'Bearer your-token' }
);

const mvtSourceWithDynamicManifest = new MVTSource(map, {
  url: 'https://tiles.example.com/{z}/{x}/{y}.pbf',
  tileAvailabilityManifest: manifestFetcher,
  cache: true
});

// Update manifest for different regions
map.addListener('bounds_changed', async () => {
  const bounds = map.getBounds();
  const region = calculateRegionFromBounds(bounds);
  
  const regionManifest = await fetch(`/api/manifest/${region}`)
    .then(r => r.json());
  
  await mvtSource.setTileAvailabilityManifest(regionManifest);
  await mvtSource.refreshManifest();
});
```

### Lazy Loading
```typescript
class LazyVectorTiles {
  private observer: IntersectionObserver;
  private mvtSources = new Map<string, MVTSource>();
  
  constructor(private map: google.maps.Map) {
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const config = JSON.parse(entry.target.dataset.tileConfig || '{}');
        if (entry.isIntersecting) {
          this.loadTiles(config.id, config.url, config.options);
        } else {
          this.unloadTiles(config.id);
        }
      });
    });
  }
  
  observeElement(element: HTMLElement, config: any) {
    element.dataset.tileConfig = JSON.stringify(config);
    this.observer.observe(element);
  }
  
  private loadTiles(id: string, url: string, options: any) {
    if (this.mvtSources.has(id)) return;
    
    const mvtSource = new MVTSource(this.map, { url, cache: true, ...options });
    this.mvtSources.set(id, mvtSource);
  }
  
  private unloadTiles(id: string) {
    const mvtSource = this.mvtSources.get(id);
    if (mvtSource) {
      mvtSource.dispose();
      this.mvtSources.delete(id);
    }
  }
}
```