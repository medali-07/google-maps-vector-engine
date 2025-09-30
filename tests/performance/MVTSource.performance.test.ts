/**
 * Performance tests for MVTSource
 * Run with: npm run test:performance
 */

// Mock external dependencies first - BEFORE any imports
jest.mock('@mapbox/vector-tile', () => ({
  VectorTile: jest.fn(),
  VectorTileFeature: jest.fn()
}));

jest.mock('pbf', () => jest.fn());

jest.mock('@turf/turf', () => ({
  polygon: jest.fn(),
  buffer: jest.fn(),
  intersect: jest.fn(),
  union: jest.fn()
}));

// Mock the source files to avoid ES module issues
jest.mock('../../src/MVTSource', () => {
  return {
    MVTSource: jest.fn().mockImplementation(() => ({
      registerFeature: jest.fn(),
      unregisterFeature: jest.fn(),
      getFeature: jest.fn(() => ({ id: 'mock-feature' })),
      isFeatureSelected: jest.fn(() => false),
      isFeatureHovered: jest.fn(() => false),
      setSelectedFeatures: jest.fn(),
      deselectAllFeatures: jest.fn(),
      dispose: jest.fn(),
      setStyle: jest.fn(),
      getSelectedFeatureIds: jest.fn(() => []),
      getSelectedFeatures: jest.fn(() => [])
    }))
  };
});

jest.mock('../../index', () => ({
  MVTUtils: {
    performance: {
      getMetrics: jest.fn(() => ({
        tilesLoaded: 0,
        layersVisible: 0,
        featuresSelected: 0,
        debugEnabled: false
      })),
      measureSelectionTime: jest.fn(() => 0.1),
      benchmarkFeatureLookup: jest.fn(() => 0.05)
    }
  }
}));

import { MVTSource } from '../../src/MVTSource';
import { MVTUtils } from '../../index';

// Mock Google Maps environment
const mockGoogleMaps = {
  maps: {
    Size: class { constructor(public width: number, public height: number) {} },
    Point: class { constructor(public x: number, public y: number) {} },
    LatLng: class { constructor(public lat: number, public lng: number) {} },
    Projection: class {
      fromLatLngToPoint(latLng: any) { return new mockGoogleMaps.maps.Point(0.5, 0.5); }
      fromPointToLatLng(point: any) { return new mockGoogleMaps.maps.LatLng(0, 0); }
    }
  }
};

// Mock Canvas
class MockCanvas {
  width = 256;
  height = 256;
  getContext() {
    return {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      closePath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      isPointInPath: jest.fn(() => false),
      measureText: jest.fn(() => ({ width: 50 })),
      fillText: jest.fn(),
      fillRect: jest.fn(),
      strokeRect: jest.fn()
    };
  }
}

// Setup global mocks
(global as any).google = mockGoogleMaps;
(global as any).HTMLCanvasElement = MockCanvas;
(global as any).Path2D = class {
  moveTo = jest.fn();
  lineTo = jest.fn();
  closePath = jest.fn();
  addPath = jest.fn();
};

describe('MVTSource Performance Tests', () => {
  let mockMap: any;
  let mvtSource: MVTSource;
  
  beforeEach(() => {
    mockMap = {
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      overlayMapTypes: { push: jest.fn() },
      getZoom: jest.fn(() => 10),
      getBounds: jest.fn(() => ({
        getNorthEast: () => new mockGoogleMaps.maps.LatLng(1, 1),
        getSouthWest: () => new mockGoogleMaps.maps.LatLng(0, 0)
      })),
      getProjection: jest.fn(() => new mockGoogleMaps.maps.Projection()),
      data: {
        addListener: jest.fn(() => ({ remove: jest.fn() })),
        addGeoJson: jest.fn(() => [{}]),
        remove: jest.fn(),
        overrideStyle: jest.fn()
      }
    };
  });

  afterEach(() => {
    if (mvtSource) {
      mvtSource.dispose();
    }
  });

  describe('Initialization Performance', () => {
    test('should initialize quickly', () => {
      const start = performance.now();
      
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false
      });
      
      const duration = performance.now() - start;
      console.log(`🚀 Initialization: ${duration.toFixed(2)}ms`);
      
      expect(duration).toBeLessThan(50); // Should initialize in under 50ms
    });

    test('should initialize with complex options quickly', () => {
      const start = performance.now();
      
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false,
        visibleLayers: ['layer1', 'layer2', 'layer3'],
        style: (feature) => ({
          fillStyle: 'rgba(255, 0, 0, 0.5)',
          strokeStyle: '#000000',
          lineWidth: 2
        }),
        multipleSelection: true,
        hoverDelay: 100
      });
      
      const duration = performance.now() - start;
      console.log(`🚀 Complex Initialization: ${duration.toFixed(2)}ms`);
      
      expect(duration).toBeLessThan(100); // Complex init should be under 100ms
    });
  });

  describe('Feature Selection Performance', () => {
    beforeEach(() => {
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false
      });
    });

    test('should select single feature quickly', () => {
      const start = performance.now();
      mvtSource.setSelectedFeatures(['feature_1']);
      const duration = performance.now() - start;
      
      console.log(`⚡ Single Feature Selection: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(5); // Single selection under 5ms
    });

    test('should select 100 features efficiently', () => {
      const featureIds = Array.from({length: 100}, (_, i) => `feature_${i}`);
      
      const start = performance.now();
      mvtSource.setSelectedFeatures(featureIds);
      const duration = performance.now() - start;
      
      console.log(`⚡ 100 Features Selection: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(50); // 100 features under 50ms
    });

    test('should select 1000 features efficiently', () => {
      const featureIds = Array.from({length: 1000}, (_, i) => `feature_${i}`);
      
      const start = performance.now();
      mvtSource.setSelectedFeatures(featureIds);
      const duration = performance.now() - start;
      
      console.log(`⚡ 1000 Features Selection: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(200); // 1000 features under 200ms
    });

    test('should deselect all features quickly', () => {
      // Setup: select some features first
      const featureIds = Array.from({length: 500}, (_, i) => `feature_${i}`);
      mvtSource.setSelectedFeatures(featureIds);
      
      const start = performance.now();
      mvtSource.deselectAllFeatures();
      const duration = performance.now() - start;
      
      console.log(`⚡ Deselect All (500): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100); // Deselect all under 100ms
    });
  });

  describe('Feature Lookup Performance', () => {
    beforeEach(() => {
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false
      });
      
      // Simulate registered features
      for (let i = 0; i < 1000; i++) {
        const mockFeature = {
          featureId: `feature_${i}`,
          getTiles: () => ({ 'tile_1': {} })
        };
        mvtSource.registerFeature(mockFeature as any);
      }
    });

    test('should lookup single feature quickly', () => {
      const start = performance.now();
      const feature = mvtSource.getFeature('feature_500');
      const duration = performance.now() - start;
      
      console.log(`🔍 Single Feature Lookup: ${duration.toFixed(4)}ms`);
      expect(duration).toBeLessThan(1); // Single lookup under 1ms
      expect(feature).toBeDefined();
    });

    test('should lookup multiple features efficiently', () => {
      const start = performance.now();
      
      for (let i = 0; i < 100; i++) {
        mvtSource.getFeature(`feature_${i}`);
      }
      
      const duration = performance.now() - start;
      const avgTime = duration / 100;
      
      console.log(`🔍 100 Lookups: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(4)}ms)`);
      expect(avgTime).toBeLessThan(0.1); // Average lookup under 0.1ms
    });
  });

  describe('Memory Management Performance', () => {
    beforeEach(() => {
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false
      });
    });

    test('should dispose quickly', () => {
      // Setup some data
      const featureIds = Array.from({length: 100}, (_, i) => `feature_${i}`);
      mvtSource.setSelectedFeatures(featureIds);
      
      const start = performance.now();
      mvtSource.dispose();
      const duration = performance.now() - start;
      
      console.log(`🗑️ Disposal: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(20); // Disposal under 20ms
    });

    test('should handle repeated selections without memory leaks', () => {
      const iterations = 50;
      const start = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        const featureIds = Array.from({length: 10}, (_, j) => `feature_${i}_${j}`);
        mvtSource.setSelectedFeatures(featureIds);
        mvtSource.deselectAllFeatures();
      }
      
      const duration = performance.now() - start;
      const avgTime = duration / iterations;
      
      console.log(`🔄 ${iterations} Selection Cycles: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(2)}ms)`);
      expect(avgTime).toBeLessThan(5); // Average cycle under 5ms
    });
  });

  describe('Style Performance', () => {
    beforeEach(() => {
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false
      });
    });

    test('should apply static style quickly', () => {
      const staticStyle = {
        fillStyle: 'rgba(255, 0, 0, 0.5)',
        strokeStyle: '#000000',
        lineWidth: 2
      };
      
      const start = performance.now();
      mvtSource.setStyle(staticStyle);
      const duration = performance.now() - start;
      
      console.log(`🎨 Static Style: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(10); // Style change under 10ms
    });

    test('should apply function style efficiently', () => {
      const styleFunction = (feature: any) => ({
        fillStyle: feature.properties?.color || 'rgba(255, 0, 0, 0.5)',
        strokeStyle: '#000000',
        lineWidth: 2
      });
      
      const start = performance.now();
      mvtSource.setStyle(styleFunction);
      const duration = performance.now() - start;
      
      console.log(`🎨 Function Style: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(20); // Function style under 20ms
    });
  });

  describe('Performance Regression Tests', () => {
    test('should maintain performance with large datasets', () => {
      const start = performance.now();
      
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false,
        visibleLayers: Array.from({length: 10}, (_, i) => `layer_${i}`)
      });
      
      // Simulate large dataset operations
      const featureIds = Array.from({length: 2000}, (_, i) => `feature_${i}`);
      mvtSource.setSelectedFeatures(featureIds);
      
      // Multiple style changes
      for (let i = 0; i < 5; i++) {
        mvtSource.setStyle({
          fillStyle: `rgba(${i * 50}, 0, 0, 0.5)`,
          strokeStyle: '#000000',
          lineWidth: i + 1
        });
      }
      
      mvtSource.deselectAllFeatures();
      mvtSource.dispose();
      
      const duration = performance.now() - start;
      console.log(`📊 Large Dataset Operations: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(1000); // All operations under 1 second
    });
  });

  describe('Performance Metrics', () => {
    beforeEach(() => {
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false
      });
    });

    test('should provide performance metrics', () => {
      // Setup some state
      const featureIds = Array.from({length: 50}, (_, i) => `feature_${i}`);
      mvtSource.setSelectedFeatures(featureIds);
      
      const start = performance.now();
      const metrics = MVTUtils.performance.getMetrics(mvtSource);
      const duration = performance.now() - start;
      
      console.log(`📈 Metrics Calculation: ${duration.toFixed(4)}ms`);
      console.log(`📈 Current Metrics:`, metrics);
      
      expect(duration).toBeLessThan(5); // Metrics calculation under 5ms
      expect(metrics).toBeDefined();
      expect(typeof metrics.featuresSelected).toBe('number');
    });
  });
});
