# 🗺️ Google Maps Vector Engine

[![CI](https://github.com/medali-07/google-maps-vector-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/medali-07/google-maps-vector-engine/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/google-maps-vector-engine)](https://www.npmjs.com/package/google-maps-vector-engine)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Render Mapbox Vector Tiles (PBF) on Google Maps with full interactivity.**

☕ **Support this project:** [Buy me a coffee](https://buymeacoffee.com/medali.07) • [Ko-fi](https://ko-fi.com/medalihachicha)

Google Maps doesn't natively support vector tiles (PBF format) - only raster tiles (PNG/JPEG). This library enables vector tile rendering with native-like performance and full interactivity impossible with static raster tiles.

## ⚡ Quick Start

```bash
npm install google-maps-vector-engine
```

```typescript
import { MVTSource, DefaultStyles } from 'google-maps-vector-engine';

const map = new google.maps.Map(document.getElementById('map'), {
  center: { lat: 46.52, lng: 6.57 },
  zoom: 9,
});

const mvtSource = new MVTSource(map, {
  url: 'https://your-server.com/{z}/{x}/{y}.pbf',
  style: DefaultStyles.highContrast(),
  setSelectedOnClick: true,
  cache: true,
  onClick: (event) => {
    if (event.feature) {
      console.log('Clicked:', event.feature.properties);
    }
  },
});
```

## ✨ Features

- **🖱️ Fully Interactive** - Click, hover, and selection
- **🎨 Dynamic Styling** - Real-time data-driven visualizations
- **🚀 High Performance** - O(1) lookups and smooth rendering
- **💪 TypeScript** - Complete type safety
- **📱 Production Ready** - Memory management and optimizations

## 🎨 Basic Styling

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

// Dynamic style
const styleFunction = (feature) => {
  return feature.properties.important ? { fillStyle: 'red' } : { fillStyle: 'blue' };
};

mvtSource.setStyle(styleFunction);
```

## 🔧 Key Methods

```typescript
// Feature selection
mvtSource.setSelectedFeatures(['feature1', 'feature2']);
const selectedIds = mvtSource.getSelectedFeatureIds();
const selectedFeatures = mvtSource.getSelectedFeatures();

// Layer management
mvtSource.setVisibleLayers(['boundaries', 'roads']);
const visibleLayers = mvtSource.getVisibleLayers();

// Filtering
mvtSource.setFilter((feature) => feature.properties.active);

// Performance & cleanup
await mvtSource.tileLoaded(); // Wait for tiles to load
mvtSource.clearAllHoveredFeatures();
mvtSource.dispose();
```

## 🔬 Performance Testing

Run comprehensive performance tests to benchmark your implementation:

```bash
# Quick performance test
npm run test:performance

# Generate detailed performance report
npm run test:performance:report

# Full benchmark suite with memory profiling
npm run test:performance:full
```

Performance targets: `<100ms` initialization, `<5ms` feature selection, `<1ms` lookups.  
See [Performance Guide](./docs/PERFORMANCE.md#performance-testing-commands) for detailed testing documentation.

## 📚 Documentation

| Guide                                               | Description                       |
| --------------------------------------------------- | --------------------------------- |
| **[📖 API Reference](./docs/API.md)**               | Complete API documentation        |
| **[💡 Examples](./docs/EXAMPLES.md)**               | Practical examples and use cases  |
| **[⚡ Performance](./docs/PERFORMANCE.md)**         | Optimization strategies           |
| **[🔧 Troubleshooting](./docs/TROUBLESHOOTING.md)** | Common issues and solutions       |
| **[🚀 Advanced](./docs/ADVANCED.md)**               | Complex patterns and integrations |

## 📦 Requirements

- Node.js 18+
- Google Maps API key
- Modern browser with ES6+ support

## 🔧 Technical Notes

- Uses standard **XYZ tile scheme**: `{z}/{x}/{y}.pbf`
- Renders PBF tiles to HTML canvas elements
- While raster tiles display faster, vector tiles provide interactivity and dynamic styling

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

---

**[View on GitHub](https://github.com/medali-07/google-maps-vector-engine)** • **[Report Issues](https://github.com/medali-07/google-maps-vector-engine/issues)** • **[Discussions](https://github.com/medali-07/google-maps-vector-engine/discussions)**
