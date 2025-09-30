/**
 * Integration performance tests - Testing real functionality without heavy mocks
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

import { MVTSource } from '../../src/MVTSource';
import { MVTFeature } from '../../src/MVTFeature';
import { GeometryType } from '../../src/types';

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

describe('MVT Integration Performance Tests', () => {
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

  describe('Real Feature Management Performance', () => {
    beforeEach(() => {
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false
      });
    });

    test('should handle feature registration efficiently', () => {
      const featureCount = 1000;
      const features: MVTFeature[] = [];
      
      // Create mock features
      for (let i = 0; i < featureCount; i++) {
        const mockVectorTileFeature = {
          type: GeometryType.Polygon,
          properties: { id: `feature_${i}` },
          extent: 4096,
          loadGeometry: jest.fn(() => [
            [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
              { x: 0, y: 0 }
            ]
          ])
        };

        const mockTileContext = {
          id: `tile_10_0_${i % 10}`,
          canvas: new MockCanvas(),
          zoom: 10,
          tileSize: 256
        };

        const feature = new MVTFeature({
          mVTSource: mvtSource,
          vectorTileFeature: mockVectorTileFeature as any,
          tileContext: mockTileContext as any,
          style: { fillStyle: 'red' },
          selected: false,
          featureId: `feature_${i}`,
          customDraw: false
        });
        
        features.push(feature);
      }

      // Test batch selection performance
      const featureIds = features.map(f => f.featureId);
      
      const start = performance.now();
      mvtSource.setSelectedFeatures(featureIds);
      const selectionDuration = performance.now() - start;
      
      console.log(`⚡ Batch Selection (${featureCount}): ${selectionDuration.toFixed(2)}ms`);
      expect(selectionDuration).toBeLessThan(500); // Batch selection under 500ms
      
      // Test feature lookup performance
      const lookupStart = performance.now();
      for (let i = 0; i < 100; i++) {
        const randomId = `feature_${Math.floor(Math.random() * featureCount)}`;
        mvtSource.getFeature(randomId);
      }
      const lookupDuration = performance.now() - lookupStart;
      const avgLookupTime = lookupDuration / 100;
      
      console.log(`🔍 Feature Lookup (100x): ${lookupDuration.toFixed(2)}ms (avg: ${avgLookupTime.toFixed(4)}ms)`);
      expect(avgLookupTime).toBeLessThan(0.1); // Average lookup under 0.1ms
      
      // Test deselection performance
      const deselectStart = performance.now();
      mvtSource.deselectAllFeatures();
      const deselectDuration = performance.now() - deselectStart;
      
      console.log(`⚡ Deselect All (${featureCount}): ${deselectDuration.toFixed(2)}ms`);
      expect(deselectDuration).toBeLessThan(100); // Deselection under 100ms

      // Cleanup
      features.forEach(f => f.dispose());
    });

    test('should handle feature index scaling', () => {
      const sizes = [100, 500, 1000, 2000];
      const results: { size: number; lookupTime: number }[] = [];

      sizes.forEach(size => {
        // Create features
        const features: MVTFeature[] = [];
        for (let i = 0; i < size; i++) {
          const mockVectorTileFeature = {
            type: GeometryType.Point,
            properties: { id: `perf_feature_${i}` },
            extent: 4096,
            loadGeometry: jest.fn(() => [[{ x: 50, y: 50 }]])
          };

          const mockTileContext = {
            id: `tile_10_${i % 10}_0`,
            canvas: new MockCanvas(),
            zoom: 10,
            tileSize: 256
          };

          const feature = new MVTFeature({
            mVTSource: mvtSource,
            vectorTileFeature: mockVectorTileFeature as any,
            tileContext: mockTileContext as any,
            style: { fillStyle: 'blue', radius: 4 },
            selected: false,
            featureId: `perf_feature_${i}`,
            customDraw: false
          });
          
          features.push(feature);
        }

        // Measure lookup performance at this size
        const lookupStart = performance.now();
        for (let i = 0; i < 50; i++) {
          const randomId = `perf_feature_${Math.floor(Math.random() * size)}`;
          mvtSource.getFeature(randomId);
        }
        const lookupTime = (performance.now() - lookupStart) / 50;
        results.push({ size, lookupTime });

        console.log(`📊 Index Size ${size}: ${lookupTime.toFixed(4)}ms avg lookup`);

        // Cleanup
        features.forEach(f => f.dispose());
        mvtSource.deselectAllFeatures();
      });

      // Verify lookup time doesn't degrade significantly with scale
      const smallIndexTime = results[0].lookupTime;
      const largeIndexTime = results[results.length - 1].lookupTime;
      const degradationRatio = largeIndexTime / smallIndexTime;

      console.log(`📈 Lookup Degradation Ratio: ${degradationRatio.toFixed(2)}x`);
      expect(degradationRatio).toBeLessThan(3); // Should not degrade more than 3x
    });
  });

  describe('Memory Management Performance', () => {
    test('should dispose features efficiently', () => {
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false
      });

      const featureCount = 500;
      const features: MVTFeature[] = [];

      // Create features
      for (let i = 0; i < featureCount; i++) {
        const mockVectorTileFeature = {
          type: GeometryType.Polygon,
          properties: { id: `dispose_feature_${i}` },
          extent: 4096,
          loadGeometry: jest.fn(() => [
            [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
              { x: 0, y: 0 }
            ]
          ])
        };

        const mockTileContext = {
          id: `dispose_tile_${i % 20}`,
          canvas: new MockCanvas(),
          zoom: 10,
          tileSize: 256
        };

        const feature = new MVTFeature({
          mVTSource: mvtSource,
          vectorTileFeature: mockVectorTileFeature as any,
          tileContext: mockTileContext as any,
          style: { fillStyle: 'green', strokeStyle: 'darkgreen', lineWidth: 1 },
          selected: false,
          featureId: `dispose_feature_${i}`,
          customDraw: false
        });
        
        features.push(feature);
      }

      // Select some features to make disposal more complex
      const selectedIds = features.slice(0, 100).map(f => f.featureId);
      mvtSource.setSelectedFeatures(selectedIds);

      // Test individual feature disposal
      const singleDisposeStart = performance.now();
      features[0].dispose();
      const singleDisposeDuration = performance.now() - singleDisposeStart;
      
      console.log(`🗑️ Single Feature Disposal: ${singleDisposeDuration.toFixed(4)}ms`);
      expect(singleDisposeDuration).toBeLessThan(5); // Single disposal under 5ms

      // Test batch disposal
      const batchDisposeStart = performance.now();
      features.slice(1, 100).forEach(f => f.dispose());
      const batchDisposeDuration = performance.now() - batchDisposeStart;
      const avgDisposalTime = batchDisposeDuration / 99;
      
      console.log(`🗑️ Batch Disposal (99 features): ${batchDisposeDuration.toFixed(2)}ms (avg: ${avgDisposalTime.toFixed(4)}ms)`);
      expect(avgDisposalTime).toBeLessThan(1); // Average disposal under 1ms

      // Test MVTSource disposal with remaining features
      const sourceDisposeStart = performance.now();
      mvtSource.dispose();
      const sourceDisposeDuration = performance.now() - sourceDisposeStart;
      
      console.log(`🗑️ MVTSource Disposal: ${sourceDisposeDuration.toFixed(2)}ms`);
      expect(sourceDisposeDuration).toBeLessThan(50); // Source disposal under 50ms

      // Cleanup remaining
      features.slice(100).forEach(f => f.dispose());
    });
  });

  describe('Style Performance', () => {
    test('should handle dynamic styling efficiently', () => {
      mvtSource = new MVTSource(mockMap, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        cache: true,
        debug: false,
        style: (feature) => ({
          fillStyle: feature.properties.category === 'A' ? 'red' : 'blue',
          strokeStyle: 'black',
          lineWidth: 1
        })
      });

      const featureCount = 200;
      const features: MVTFeature[] = [];

      // Create features with different categories
      for (let i = 0; i < featureCount; i++) {
        const mockVectorTileFeature = {
          type: GeometryType.Polygon,
          properties: { 
            id: `style_feature_${i}`,
            category: i % 2 === 0 ? 'A' : 'B',
            value: Math.random() * 100
          },
          extent: 4096,
          loadGeometry: jest.fn(() => [
            [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
              { x: 0, y: 0 }
            ]
          ])
        };

        const mockTileContext = {
          id: `style_tile_${i % 10}`,
          canvas: new MockCanvas(),
          zoom: 10,
          tileSize: 256
        };

        const feature = new MVTFeature({
          mVTSource: mvtSource,
          vectorTileFeature: mockVectorTileFeature as any,
          tileContext: mockTileContext as any,
          style: { fillStyle: 'gray' }, // Will be overridden by dynamic style
          selected: false,
          featureId: `style_feature_${i}`,
          customDraw: false
        });
        
        features.push(feature);
      }

      // Test style changes
      const styleChangeStart = performance.now();
      mvtSource.setStyle({
        fillStyle: 'yellow',
        strokeStyle: 'red',
        lineWidth: 2
      });
      const styleChangeDuration = performance.now() - styleChangeStart;
      
      console.log(`🎨 Global Style Change: ${styleChangeDuration.toFixed(2)}ms`);
      expect(styleChangeDuration).toBeLessThan(50); // Style change under 50ms

      // Test function-based style
      const functionStyleStart = performance.now();
      mvtSource.setStyle((feature) => ({
        fillStyle: `hsl(${Number(feature.properties.value || 0) * 3.6}, 70%, 50%)`,
        strokeStyle: 'black',
        lineWidth: feature.properties.category === 'A' ? 2 : 1
      }));
      const functionStyleDuration = performance.now() - functionStyleStart;
      
      console.log(`🎨 Function Style Change: ${functionStyleDuration.toFixed(2)}ms`);
      expect(functionStyleDuration).toBeLessThan(100); // Function style under 100ms

      // Cleanup
      features.forEach(f => f.dispose());
    });
  });
});
