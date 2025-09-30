/**
 * Performance tests for MVTFeature
 * Run with: npm run test:performance
 */

import { MVTFeature } from '../../src/MVTFeature';
import { GeometryType } from '../../src/types';

// Mock Google Maps environment
const mockGoogleMaps = {
  maps: {
    Size: class { constructor(public width: number, public height: number) {} },
    Point: class { constructor(public x: number, public y: number) {} },
    LatLng: class { constructor(public lat: number, public lng: number) {} }
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
      isPointInPath: jest.fn(() => false)
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

describe('MVTFeature Performance Tests', () => {
  let mockMVTSource: any;
  let mockTileContext: any;
  let mockVectorTileFeature: any;

  beforeEach(() => {
    mockMVTSource = {
      registerFeature: jest.fn(),
      unregisterFeature: jest.fn(),
      getTileObject: jest.fn(() => ({ x: 0, y: 0, z: 10 })),
      getStyleForFeature: jest.fn(() => ({
        fillStyle: 'rgba(255, 0, 0, 0.5)',
        strokeStyle: '#000000',
        lineWidth: 2
      })),
      isFeatureReplaced: jest.fn(() => false)
    };

    mockTileContext = {
      id: 'tile_10_0_0',
      canvas: new MockCanvas(),
      zoom: 10,
      tileSize: 256
    };

    mockVectorTileFeature = {
      type: GeometryType.Polygon,
      properties: { id: 'test_feature' },
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
  });

  describe('Feature Creation Performance', () => {
    test('should create feature quickly', () => {
      const start = performance.now();
      
      const feature = new MVTFeature({
        mVTSource: mockMVTSource,
        vectorTileFeature: mockVectorTileFeature,
        tileContext: mockTileContext,
        style: { fillStyle: 'red' },
        selected: false,
        featureId: 'test_feature',
        customDraw: false
      });
      
      const duration = performance.now() - start;
      console.log(`🏗️ Feature Creation: ${duration.toFixed(2)}ms`);
      
      expect(duration).toBeLessThan(5); // Feature creation under 5ms
      feature.dispose();
    });

    test('should create multiple features efficiently', () => {
      const featureCount = 100;
      const features: MVTFeature[] = [];
      
      const start = performance.now();
      
      for (let i = 0; i < featureCount; i++) {
        const feature = new MVTFeature({
          mVTSource: mockMVTSource,
          vectorTileFeature: {
            ...mockVectorTileFeature,
            properties: { id: `feature_${i}` }
          },
          tileContext: mockTileContext,
          style: { fillStyle: 'red' },
          selected: false,
          featureId: `feature_${i}`,
          customDraw: false
        });
        features.push(feature);
      }
      
      const duration = performance.now() - start;
      const avgTime = duration / featureCount;
      
      console.log(`🏗️ ${featureCount} Features Creation: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(4)}ms)`);
      expect(avgTime).toBeLessThan(0.5); // Average creation under 0.5ms
      
      // Cleanup
      features.forEach(f => f.dispose());
    });
  });

  describe('Drawing Performance', () => {
    let feature: MVTFeature;

    beforeEach(() => {
      feature = new MVTFeature({
        mVTSource: mockMVTSource,
        vectorTileFeature: mockVectorTileFeature,
        tileContext: mockTileContext,
        style: { fillStyle: 'red', strokeStyle: 'black', lineWidth: 2 },
        selected: false,
        featureId: 'test_feature',
        customDraw: false
      });
    });

    afterEach(() => {
      feature.dispose();
    });

    test('should draw polygon quickly', () => {
      const start = performance.now();
      feature.draw(mockTileContext);
      const duration = performance.now() - start;
      
      console.log(`🎨 Polygon Draw: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(10); // Polygon drawing under 10ms
    });

    test('should draw point quickly', () => {
      // Create point feature
      const pointFeature = new MVTFeature({
        mVTSource: mockMVTSource,
        vectorTileFeature: {
          ...mockVectorTileFeature,
          type: GeometryType.Point,
          loadGeometry: jest.fn(() => [[{ x: 50, y: 50 }]])
        },
        tileContext: mockTileContext,
        style: { fillStyle: 'red', radius: 5 },
        selected: false,
        featureId: 'point_feature',
        customDraw: false
      });
      
      const start = performance.now();
      pointFeature.draw(mockTileContext);
      const duration = performance.now() - start;
      
      console.log(`🎨 Point Draw: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(5); // Point drawing under 5ms
      
      pointFeature.dispose();
    });

    test('should draw linestring quickly', () => {
      // Create linestring feature
      const lineFeature = new MVTFeature({
        mVTSource: mockMVTSource,
        vectorTileFeature: {
          ...mockVectorTileFeature,
          type: GeometryType.LineString,
          loadGeometry: jest.fn(() => [
            [
              { x: 0, y: 0 },
              { x: 50, y: 50 },
              { x: 100, y: 100 }
            ]
          ])
        },
        tileContext: mockTileContext,
        style: { strokeStyle: 'blue', lineWidth: 3 },
        selected: false,
        featureId: 'line_feature',
        customDraw: false
      });
      
      const start = performance.now();
      lineFeature.draw(mockTileContext);
      const duration = performance.now() - start;
      
      console.log(`🎨 LineString Draw: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(8); // LineString drawing under 8ms
      
      lineFeature.dispose();
    });
  });

  describe('Multi-tile Feature Performance', () => {
    let feature: MVTFeature;
    let additionalTileContext: any;

    beforeEach(() => {
      feature = new MVTFeature({
        mVTSource: mockMVTSource,
        vectorTileFeature: mockVectorTileFeature,
        tileContext: mockTileContext,
        style: { fillStyle: 'red', strokeStyle: 'black', lineWidth: 2 },
        selected: false,
        featureId: 'multi_tile_feature',
        customDraw: false
      });

      additionalTileContext = {
        id: 'tile_10_1_0',
        canvas: new MockCanvas(),
        zoom: 10,
        tileSize: 256
      };
    });

    afterEach(() => {
      feature.dispose();
    });

    test('should handle multi-tile features efficiently', () => {
      // Add feature to multiple tiles
      const start = performance.now();
      
      for (let i = 0; i < 5; i++) {
        const tileContext = {
          id: `tile_10_${i}_0`,
          canvas: new MockCanvas(),
          zoom: 10,
          tileSize: 256
        };
        
        feature.addTileFeature(mockVectorTileFeature, tileContext);
      }
      
      const duration = performance.now() - start;
      console.log(`🔗 Multi-tile Setup (5 tiles): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(20); // Multi-tile setup under 20ms
    });

    test('should draw unified multi-tile feature efficiently', () => {
      // Setup multi-tile feature
      for (let i = 0; i < 3; i++) {
        const tileContext = {
          id: `tile_10_${i}_0`,
          canvas: new MockCanvas(),
          zoom: 10,
          tileSize: 256
        };
        feature.addTileFeature(mockVectorTileFeature, tileContext);
      }
      
      const start = performance.now();
      feature.draw(mockTileContext);
      const duration = performance.now() - start;
      
      console.log(`🎨 Unified Multi-tile Draw: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(25); // Unified drawing under 25ms
    });
  });

  describe('Caching Performance', () => {
    let feature: MVTFeature;

    beforeEach(() => {
      feature = new MVTFeature({
        mVTSource: mockMVTSource,
        vectorTileFeature: mockVectorTileFeature,
        tileContext: mockTileContext,
        style: { fillStyle: 'red', strokeStyle: 'black', lineWidth: 2 },
        selected: false,
        featureId: 'cached_feature',
        customDraw: false
      });
    });

    afterEach(() => {
      feature.dispose();
    });

    test('should benefit from coordinate caching', () => {
      // First draw (cold cache)
      const start1 = performance.now();
      feature.draw(mockTileContext);
      const duration1 = performance.now() - start1;
      
      // Second draw (warm cache)
      const start2 = performance.now();
      feature.draw(mockTileContext);
      const duration2 = performance.now() - start2;
      
      console.log(`🗄️ First Draw (cold): ${duration1.toFixed(2)}ms`);
      console.log(`🗄️ Second Draw (warm): ${duration2.toFixed(2)}ms`);
      console.log(`🗄️ Cache Speedup: ${(duration1 / duration2).toFixed(1)}x`);
      
      expect(duration2).toBeLessThanOrEqual(duration1); // Cache should help or be same
    });

    test('should handle path caching efficiently', () => {
      // Get paths multiple times
      const iterations = 10;
      const start = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        feature.getPaths(mockTileContext);
      }
      
      const duration = performance.now() - start;
      const avgTime = duration / iterations;
      
      console.log(`🗄️ ${iterations} Path Requests: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(4)}ms)`);
      expect(avgTime).toBeLessThan(1); // Average path request under 1ms
    });
  });

  describe('Style Performance', () => {
    let feature: MVTFeature;

    beforeEach(() => {
      feature = new MVTFeature({
        mVTSource: mockMVTSource,
        vectorTileFeature: mockVectorTileFeature,
        tileContext: mockTileContext,
        style: { fillStyle: 'red' },
        selected: false,
        featureId: 'styled_feature',
        customDraw: false
      });
    });

    afterEach(() => {
      feature.dispose();
    });

    test('should apply style changes quickly', () => {
      const newStyle = {
        fillStyle: 'blue',
        strokeStyle: 'green',
        lineWidth: 3
      };
      
      const start = performance.now();
      feature.setStyle(newStyle);
      const duration = performance.now() - start;
      
      console.log(`🎨 Style Change: ${duration.toFixed(4)}ms`);
      expect(duration).toBeLessThan(1); // Style change under 1ms
    });

    test('should handle rapid style changes efficiently', () => {
      const styles = [
        { fillStyle: 'red' },
        { fillStyle: 'blue' },
        { fillStyle: 'green' },
        { fillStyle: 'yellow' },
        { fillStyle: 'purple' }
      ];
      
      const start = performance.now();
      
      styles.forEach(style => {
        feature.setStyle(style);
      });
      
      const duration = performance.now() - start;
      const avgTime = duration / styles.length;
      
      console.log(`🎨 ${styles.length} Style Changes: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(4)}ms)`);
      expect(avgTime).toBeLessThan(0.5); // Average style change under 0.5ms
    });
  });

  describe('Selection Performance', () => {
    let feature: MVTFeature;

    beforeEach(() => {
      feature = new MVTFeature({
        mVTSource: mockMVTSource,
        vectorTileFeature: mockVectorTileFeature,
        tileContext: mockTileContext,
        style: { fillStyle: 'red' },
        selected: false,
        featureId: 'selectable_feature',
        customDraw: false
      });
    });

    afterEach(() => {
      feature.dispose();
    });

    test('should toggle selection quickly', () => {
      const start = performance.now();
      
      // Toggle selection multiple times
      for (let i = 0; i < 10; i++) {
        feature.setSelected(!feature.selected);
      }
      
      const duration = performance.now() - start;
      const avgTime = duration / 10;
      
      console.log(`⚡ 10 Selection Toggles: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(4)}ms)`);
      expect(avgTime).toBeLessThan(0.1); // Average toggle under 0.1ms
    });
  });

  describe('Memory Management Performance', () => {
    test('should dispose features quickly', () => {
      const features: MVTFeature[] = [];
      
      // Create multiple features
      for (let i = 0; i < 50; i++) {
        const feature = new MVTFeature({
          mVTSource: mockMVTSource,
          vectorTileFeature: mockVectorTileFeature,
          tileContext: mockTileContext,
          style: { fillStyle: 'red' },
          selected: false,
          featureId: `disposable_feature_${i}`,
          customDraw: false
        });
        features.push(feature);
      }
      
      const start = performance.now();
      
      features.forEach(feature => {
        feature.dispose();
      });
      
      const duration = performance.now() - start;
      const avgTime = duration / features.length;
      
      console.log(`🗑️ ${features.length} Feature Disposals: ${duration.toFixed(2)}ms (avg: ${avgTime.toFixed(4)}ms)`);
      expect(avgTime).toBeLessThan(0.5); // Average disposal under 0.5ms
    });
  });
});
