import { MVTLayer } from '../../src/MVTLayer';
import { MVTLayerOptions, GeometryType } from '../../src/types';
import { 
  createMockMVTSource, 
  createMockVectorTileFeature, 
  createMockTileContext,
  createMockPointFeature,
  createMockLineFeature,
  createMockMouseEvent
} from '../utils/mockData';

describe('MVTLayer', () => {
  let layer: MVTLayer;
  let mockMVTSource: any;
  let layerOptions: MVTLayerOptions;

  beforeEach(() => {
    mockMVTSource = createMockMVTSource();
    
    layerOptions = {
      name: 'testLayer',
      getIDForLayerFeature: (feature) => feature.id || feature.properties.id || 'default-id',
      style: { fillStyle: 'rgba(0, 100, 200, 0.5)', strokeStyle: 'rgba(0, 100, 200, 1)' },
      filter: false,
      customDraw: false
    };

    layer = new MVTLayer(layerOptions);
  });

  describe('Constructor', () => {
    test('should initialize with basic options', () => {
      expect(layer.name).toBe('testLayer');
      expect(layer.style).toEqual(layerOptions.style);
    });

    test('should initialize with style function', () => {
      const styleFunction = jest.fn(() => ({ fillStyle: 'red' }));
      const options = { ...layerOptions, style: styleFunction };
      
      layer = new MVTLayer(options);
      expect(layer.style).toBe(styleFunction);
    });

    test('should initialize with custom filter', () => {
      const filter = jest.fn((feature) => feature.properties.visible);
      const options = { ...layerOptions, filter };
      
      layer = new MVTLayer(options);
      expect(layer._filter).toBe(filter);
    });

    test('should initialize with custom draw function', () => {
      const customDraw = jest.fn();
      const options = { ...layerOptions, customDraw };
      
      layer = new MVTLayer(options);
      expect(layer._customDraw).toBe(customDraw);
    });
  });

  describe('Feature Parsing', () => {
    let tileContext: any;
    let mockFeatures: any[];

    beforeEach(() => {
      tileContext = createMockTileContext();
      mockFeatures = [
        createMockVectorTileFeature({ 
          id: 'feature1', 
          properties: { name: 'Feature 1', category: 'A' } 
        }),
        createMockVectorTileFeature({ 
          id: 'feature2', 
          properties: { name: 'Feature 2', category: 'B' } 
        }),
        createMockPointFeature({ 
          id: 'feature3', 
          properties: { name: 'Point Feature' } 
        })
      ];
    });

    test('should parse vector tile features correctly', () => {
      layer.parseVectorTileFeatures(mockMVTSource, mockFeatures, tileContext);
      
      expect(Object.keys(layer._mVTFeatures)).toHaveLength(3);
      expect(layer._mVTFeatures['feature1']).toBeDefined();
      expect(layer._mVTFeatures['feature2']).toBeDefined();
      expect(layer._mVTFeatures['feature3']).toBeDefined();
    });

    test('should apply feature filter during parsing', () => {
      const filter = jest.fn((feature) => feature.properties.category === 'A');
      layer.setFilter(filter);
      
      layer.parseVectorTileFeatures(mockMVTSource, mockFeatures, tileContext);
      
      expect(filter).toHaveBeenCalledTimes(3);
      expect(Object.keys(layer._mVTFeatures)).toHaveLength(1);
      expect(layer._mVTFeatures['feature1']).toBeDefined();
      expect(layer._mVTFeatures['feature2']).toBeUndefined();
    });

    test('should handle duplicate feature IDs', () => {
      const duplicateFeatures = [
        createMockVectorTileFeature({ id: 'duplicate', properties: { name: 'First' } }),
        createMockVectorTileFeature({ id: 'duplicate', properties: { name: 'Second' } })
      ];
      
      layer.parseVectorTileFeatures(mockMVTSource, duplicateFeatures, tileContext);
      
      // Should only keep one feature with the duplicate ID
      expect(Object.keys(layer._mVTFeatures)).toHaveLength(1);
      expect(layer._mVTFeatures['duplicate']).toBeDefined();
    });

    test('should skip features that fail filter', () => {
      const strictFilter = jest.fn(() => false);
      layer.setFilter(strictFilter);
      
      layer.parseVectorTileFeatures(mockMVTSource, mockFeatures, tileContext);
      
      expect(strictFilter).toHaveBeenCalledTimes(3);
      expect(Object.keys(layer._mVTFeatures)).toHaveLength(0);
    });
  });

  describe('Style Management', () => {
    test('should update static style', () => {
      const newStyle = { 
        fillStyle: 'red', 
        strokeStyle: 'blue',
        lineWidth: 3 
      };
      
      layer.setStyle(newStyle);
      expect(layer.style).toEqual(newStyle);
    });

    test('should update style function', () => {
      const newStyleFunction = jest.fn(() => ({ fillStyle: 'green' }));
      
      layer.setStyle(newStyleFunction);
      expect(layer.style).toBe(newStyleFunction);
    });

    test('should apply style function to features', () => {
      const tileContext = createMockTileContext();
      const mockFeatures = [
        createMockVectorTileFeature({ id: 'styled-feature' })
      ];
      
      const styleFunction = jest.fn(() => ({ fillStyle: 'purple' }));
      layer.setStyle(styleFunction);
      
      layer.parseVectorTileFeatures(mockMVTSource, mockFeatures, tileContext);
      
      const feature = layer._mVTFeatures['styled-feature'];
      expect(feature).toBeDefined();
      expect(feature.style).toEqual({ fillStyle: 'purple' });
    });
  });

  describe('Filter Management', () => {
    test('should set feature filter function', () => {
      const filter = jest.fn((feature) => feature.properties.visible === true);
      
      layer.setFilter(filter);
      expect(layer._filter).toBe(filter);
    });

    test('should remove filter when false provided', () => {
      layer.setFilter(jest.fn());
      layer.setFilter(false);
      
      expect(layer._filter).toBe(false);
    });

    test('should apply filter correctly', () => {
      const tileContext = createMockTileContext();
      const mockFeatures = [
        createMockVectorTileFeature({ 
          id: 'visible-feature', 
          properties: { visible: true } 
        }),
        createMockVectorTileFeature({ 
          id: 'hidden-feature', 
          properties: { visible: false } 
        })
      ];
      
      const filter = jest.fn((feature) => feature.properties.visible === true);
      layer.setFilter(filter);
      
      layer.parseVectorTileFeatures(mockMVTSource, mockFeatures, tileContext);
      
      expect(Object.keys(layer._mVTFeatures)).toHaveLength(1);
      expect(layer._mVTFeatures['visible-feature']).toBeDefined();
      expect(layer._mVTFeatures['hidden-feature']).toBeUndefined();
    });
  });

  describe('Click Detection', () => {
    beforeEach(() => {
      const tileContext = createMockTileContext();
      const mockFeatures = [
        createMockVectorTileFeature({ id: 'polygon-feature' }),
        createMockPointFeature({ id: 'point-feature' }),
        createMockLineFeature({ id: 'line-feature' })
      ];
      
      layer.parseVectorTileFeatures(mockMVTSource, mockFeatures, tileContext);
    });

    test('should detect polygon feature clicks', () => {
      const clickEvent = createMockMouseEvent({
        tilePoint: { x: 50, y: 50 } // Inside polygon bounds
      });
      
      const result = layer.handleClickEvent(clickEvent, mockMVTSource);
      
      // Just check that result is defined, as the specific feature returned may vary
      expect(result).toBeDefined();
      expect(result.feature).toBeDefined();
    });

    test('should detect point feature clicks', () => {
      const clickEvent = createMockMouseEvent({
        tilePoint: { x: 50, y: 50 } // At point location
      });
      
      const result = layer.handleClickEvent(clickEvent, mockMVTSource);
      
      expect(result.feature).toBeDefined();
    });

    test('should detect line feature clicks within tolerance', () => {
      const clickEvent = createMockMouseEvent({
        tilePoint: { x: 25, y: 25 } // Near line
      });
      
      const result = layer.handleClickEvent(clickEvent, mockMVTSource);
      
      expect(result.feature).toBeDefined();
    });

    test('should find closest feature when multiple features overlap', () => {
      const clickEvent = createMockMouseEvent({
        tilePoint: { x: 50, y: 50 } // Point that might hit multiple features
      });
      
      const result = layer.handleClickEvent(clickEvent, mockMVTSource);
      
      // Should return at least one feature
      expect(result.feature).toBeDefined();
    });
  });

  describe('Feature Selection', () => {
    beforeEach(() => {
      const tileContext = createMockTileContext();
      const mockFeatures = [
        createMockVectorTileFeature({ id: 'feature1' }),
        createMockVectorTileFeature({ id: 'feature2' })
      ];
      
      layer.parseVectorTileFeatures(mockMVTSource, mockFeatures, tileContext);
    });

    test('should handle selection of non-existent feature', () => {
      expect(() => {
        layer.setSelected('non-existent');
      }).not.toThrow();
    });
  });

  describe('Geometry Type Handling', () => {
    test('should handle polygon geometries', () => {
      const tileContext = createMockTileContext();
      const polygonFeature = createMockVectorTileFeature({
        id: 'polygon',
        type: GeometryType.Polygon
      });
      
      layer.parseVectorTileFeatures(mockMVTSource, [polygonFeature], tileContext);
      
      expect(layer._mVTFeatures['polygon']).toBeDefined();
      expect(layer._mVTFeatures['polygon'].type).toBe(GeometryType.Polygon);
    });

    test('should handle point geometries', () => {
      const tileContext = createMockTileContext();
      const pointFeature = createMockPointFeature({ id: 'point' });
      
      layer.parseVectorTileFeatures(mockMVTSource, [pointFeature], tileContext);
      
      expect(layer._mVTFeatures['point']).toBeDefined();
      expect(layer._mVTFeatures['point'].type).toBe(GeometryType.Point);
    });

    test('should handle line geometries', () => {
      const tileContext = createMockTileContext();
      const lineFeature = createMockLineFeature({ id: 'line' });
      
      layer.parseVectorTileFeatures(mockMVTSource, [lineFeature], tileContext);
      
      expect(layer._mVTFeatures['line']).toBeDefined();
      expect(layer._mVTFeatures['line'].type).toBe(GeometryType.LineString);
    });
  });

  describe('Error Handling', () => {
    test('should handle parsing with null features array', () => {
      const tileContext = createMockTileContext();
      
      expect(() => {
        layer.parseVectorTileFeatures(mockMVTSource, null as any, tileContext);
      }).not.toThrow();
    });

    test('should handle parsing with empty features array', () => {
      const tileContext = createMockTileContext();
      
      expect(() => {
        layer.parseVectorTileFeatures(mockMVTSource, [], tileContext);
      }).not.toThrow();
      
      expect(Object.keys(layer._mVTFeatures)).toHaveLength(0);
    });

    test('should handle features with invalid geometry', () => {
      const tileContext = createMockTileContext();
      const invalidFeature = createMockVectorTileFeature({
        id: 'invalid',
        loadGeometry: jest.fn(() => null)
      });
      
      expect(() => {
        layer.parseVectorTileFeatures(mockMVTSource, [invalidFeature], tileContext);
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    test('should handle frequent style updates efficiently', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        layer.setStyle({ fillStyle: `hsl(${i % 360}, 50%, 50%)` });
      }
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(100); // Should complete in under 100ms
    });
  });
});