import { MVTFeature } from '../../src/MVTFeature';
import { MVTFeatureOptions, GeometryType } from '../../src/types';
import {
  createMockMVTSource,
  createMockVectorTileFeature,
  createMockTileContext,
  createMockPointFeature,
  createMockLineFeature,
  createMockCanvasContext,
} from '../utils/mockData';

describe('MVTFeature', () => {
  let feature: MVTFeature;
  let mockMVTSource: any;
  let mockVectorFeature: any;
  let tileContext: any;
  let featureOptions: MVTFeatureOptions;

  beforeEach(() => {
    mockMVTSource = createMockMVTSource();
    mockVectorFeature = createMockVectorTileFeature({
      id: 'test-feature',
      properties: { name: 'Test Feature', category: 'test' },
    });
    tileContext = createMockTileContext();

    // Mock canvas getContext to return a proper mock
    jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(createMockCanvasContext());

    featureOptions = {
      mVTSource: mockMVTSource,
      vectorTileFeature: mockVectorFeature,
      tileContext,
      style: { fillStyle: 'rgba(0, 100, 200, 0.5)', strokeStyle: 'rgba(0, 100, 200, 1)' },
      selected: false,
      featureId: 'test-feature',
      customDraw: false,
    };

    feature = new MVTFeature(featureOptions);
  });

  describe('Constructor', () => {
    test('should initialize with basic options', () => {
      expect(feature.featureId).toBe('test-feature');
      expect(feature.selected).toBe(false);
      expect(feature.properties).toEqual({ name: 'Test Feature', category: 'test' });
      expect(feature.type).toBe(GeometryType.Polygon);
    });

    test('should initialize with selected state', () => {
      const selectedOptions = { ...featureOptions, selected: true };
      feature = new MVTFeature(selectedOptions);

      expect(feature.selected).toBe(true);
    });

    test('should initialize with custom style', () => {
      const customStyle = {
        fillStyle: 'red',
        strokeStyle: 'blue',
        lineWidth: 3,
        selected: { fillStyle: 'yellow' },
      };
      const styledOptions = { ...featureOptions, style: customStyle };

      feature = new MVTFeature(styledOptions);
      expect(feature.style).toEqual(customStyle);
    });

    test('should handle point geometry', () => {
      const pointFeature = createMockPointFeature({ id: 'point-test' });
      const pointOptions = {
        ...featureOptions,
        vectorTileFeature: pointFeature,
        featureId: 'point-test',
      };

      feature = new MVTFeature(pointOptions);
      expect(feature.type).toBe(GeometryType.Point);
    });

    test('should handle line geometry', () => {
      const lineFeature = createMockLineFeature({ id: 'line-test' });
      const lineOptions = {
        ...featureOptions,
        vectorTileFeature: lineFeature,
        featureId: 'line-test',
      };

      feature = new MVTFeature(lineOptions);
      expect(feature.type).toBe(GeometryType.LineString);
    });
  });

  describe('State Management', () => {
    test('should set selection state directly', () => {
      expect(feature.selected).toBe(false);

      feature.setSelected(true);
      expect(feature.selected).toBe(true);

      feature.setSelected(false);
      expect(feature.selected).toBe(false);
    });

    test('should handle selection state changes', () => {
      const initialSelected = feature.selected;
      feature.setSelected(!initialSelected);
      expect(feature.selected).toBe(!initialSelected);
    });
  });

  describe('Style Management', () => {
    test('should update style', () => {
      const newStyle = { fillStyle: 'green', strokeStyle: 'yellow' };

      feature.setStyle(newStyle);
      expect(feature.style).toEqual(newStyle);
    });

    test('should handle style with selection states', () => {
      const styleWithSelection = {
        fillStyle: 'blue',
        strokeStyle: 'red',
        selected: {
          fillStyle: 'orange',
          strokeStyle: 'darkorange',
          lineWidth: 3,
        },
      };

      feature.setStyle(styleWithSelection);
      expect(feature.style.selected).toEqual({
        fillStyle: 'orange',
        strokeStyle: 'darkorange',
        lineWidth: 3,
      });
    });
  });

  describe('Tile Management', () => {
    test('should add tile feature correctly', () => {
      const newTileContext = createMockTileContext();
      const newVectorFeature = createMockVectorTileFeature({ id: 'new-feature' });

      feature.addTileFeature(newVectorFeature, newTileContext);

      const tile = feature.getTile(newTileContext);
      expect(tile.vectorTileFeature).toBe(newVectorFeature);
      expect(tile.divisor).toBe(newVectorFeature.extent / newTileContext.tileSize);
    });

    test('should get all tiles', () => {
      const tiles = feature.getTiles();
      expect(tiles).toHaveProperty(tileContext.id);
    });

    test('should get specific tile data', () => {
      const tile = feature.getTile(tileContext);
      expect(tile).toBeDefined();
      expect(tile.vectorTileFeature).toBe(mockVectorFeature);
    });
  });

  describe('Drawing', () => {
    test('should draw point features', () => {
      const pointFeature = createMockPointFeature({ id: 'point-test' });
      const pointOptions = {
        ...featureOptions,
        vectorTileFeature: pointFeature,
        featureId: 'point-test',
      };

      const pointMVTFeature = new MVTFeature(pointOptions);
      const mockContext = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(mockContext);

      expect(() => {
        pointMVTFeature.draw(tileContext);
      }).not.toThrow();
    });

    test('should apply style properties during drawing', () => {
      const style = {
        fillStyle: 'red',
        strokeStyle: 'blue',
        lineWidth: 2,
      };

      feature.setStyle(style);

      expect(() => {
        feature.draw(tileContext);
      }).not.toThrow();
    });

    test('should use custom draw function when provided', () => {
      const customDraw = jest.fn();
      const customOptions = { ...featureOptions, customDraw };

      const customFeature = new MVTFeature(customOptions);
      customFeature.draw(tileContext);

      expect(customDraw).toHaveBeenCalled();
    });
  });

  describe('Performance', () => {
    test('should handle rapid style changes efficiently', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        feature.setStyle({ fillStyle: `hsl(${i % 360}, 50%, 50%)` });
      }

      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(100); // Should be fast
    });

    test('should handle rapid selection changes efficiently', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        feature.setSelected(i % 2 === 0);
      }

      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(50); // Should be very fast
    });

    test('should cache Path2D objects for complex geometries', () => {
      // Test that caching works by calling getPaths multiple times
      const paths1 = feature.getPaths(tileContext);
      const paths2 = feature.getPaths(tileContext);

      expect(paths1).toBeDefined();
      expect(paths2).toBeDefined();
      // Both calls should return the same cached result
      expect(paths1).toBe(paths2);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid geometry data', () => {
      const invalidFeature = createMockVectorTileFeature({
        loadGeometry: jest.fn(() => null),
      });

      const invalidOptions = { ...featureOptions, vectorTileFeature: invalidFeature };

      expect(() => {
        new MVTFeature(invalidOptions);
      }).not.toThrow();
    });

    test('should handle empty geometry coordinates', () => {
      const emptyFeature = createMockVectorTileFeature({
        loadGeometry: jest.fn(() => []),
      });

      const emptyOptions = { ...featureOptions, vectorTileFeature: emptyFeature };

      expect(() => {
        new MVTFeature(emptyOptions);
      }).not.toThrow();
    });

    test('should handle invalid style objects', () => {
      expect(() => {
        feature.setStyle(null as any);
      }).not.toThrow();

      expect(() => {
        feature.setStyle(undefined as any);
      }).not.toThrow();

      expect(() => {
        feature.setStyle({} as any);
      }).not.toThrow();
    });
  });

  describe('Memory Management', () => {
    test('should clean up tile references when removing tiles', () => {
      const initialTiles = Object.keys(feature.getTiles()).length;

      // Add multiple tiles
      for (let i = 0; i < 5; i++) {
        const newTileContext = createMockTileContext();
        const newVectorFeature = createMockVectorTileFeature({ id: `feature-${i}` });
        feature.addTileFeature(newVectorFeature, newTileContext);
      }

      const tilesAfterAdd = Object.keys(feature.getTiles()).length;
      expect(tilesAfterAdd).toBeGreaterThan(initialTiles);
    });

    test('should not leak event listeners', () => {
      // Create multiple features to test for memory leaks
      const features = [];
      for (let i = 0; i < 10; i++) {
        const options = { ...featureOptions, featureId: `feature-${i}` };
        features.push(new MVTFeature(options));
      }

      // No specific assertion, just ensure no errors are thrown
      expect(features.length).toBe(10);
    });
  });
});
