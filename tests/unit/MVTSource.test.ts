// Mock the mapbox-vector-tile module to avoid ESM issues
jest.mock('@mapbox/vector-tile', () => ({
  VectorTile: jest.fn(),
  VectorTileFeature: jest.fn(),
}));

jest.mock('pbf', () => jest.fn());

import { MVTSource } from '../../src/MVTSource';
import { MVTFeature } from '../../src/MVTFeature';

// Mock Google Maps types
const mockMap = {
  overlayMapTypes: {
    getArray: jest.fn(() => []),
    removeAt: jest.fn(),
    push: jest.fn(),
    insertAt: jest.fn(),
  },
  data: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    remove: jest.fn(),
  },
  addListener: jest.fn(() => ({ remove: jest.fn() })),
} as any;

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('MVTSource Race Condition Fix', () => {
  let mvtSource: MVTSource;
  let mockGetReplacementFeature: jest.Mock;
  let mockFeatureSelectionCallback: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetReplacementFeature = jest.fn();
    mockFeatureSelectionCallback = jest.fn();

    mvtSource = new MVTSource(mockMap, {
      url: 'https://example.com/{z}/{x}/{y}.pbf',
      getReplacementFeature: mockGetReplacementFeature,
      featureSelectionCallback: mockFeatureSelectionCallback,
    });
  });

  afterEach(() => {
    if (mvtSource) {
      mvtSource.dispose();
    }
  });

  test('should cancel pending replacement request when feature is deselected', async () => {
    // Mock a slow async replacement function
    const slowReplacementPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          type: 'Feature',
          id: 'test-feature',
          properties: { name: 'Test Feature' },
          geometry: { type: 'Point', coordinates: [0, 0] },
        });
      }, 100);
    });

    mockGetReplacementFeature.mockReturnValue(slowReplacementPromise);

    // Create a mock feature
    const mockVectorFeature = {
      type: 1,
      properties: { id: 'test-feature' },
      loadGeometry: jest.fn(),
      bbox: jest.fn(),
      toGeoJSON: jest.fn(),
    };

    const mockTileContext = {
      id: 'tile-1',
      canvas: document.createElement('canvas'),
      context: document.createElement('canvas').getContext('2d'),
      zoom: 10,
      x: 1,
      y: 1,
      tileSize: 256,
      geoTransform: jest.fn(),
    };

    // Simulate feature being registered and selected
    const feature = new MVTFeature({
      mVTSource: mvtSource,
      vectorTileFeature: mockVectorFeature,
      tileContext: mockTileContext,
      style: { fillColor: '#000000' },
      selected: false,
      featureId: 'test-feature',
    });

    // Access private methods for testing
    const selectFeature = (mvtSource as any)._selectFeature.bind(mvtSource);
    const deselectFeature = (mvtSource as any)._deselectFeature.bind(mvtSource);

    // Register the feature in the index
    (mvtSource as any)._featureIndex.set('test-feature', feature);

    // Select the feature (this should start the replacement request)
    selectFeature('test-feature');

    // Verify that the replacement function was called
    expect(mockGetReplacementFeature).toHaveBeenCalledTimes(1);

    // Immediately deselect the feature before the async call completes
    deselectFeature('test-feature');

    // Wait for the async operation to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The callback should only be called for the deselection, not for the completed replacement
    expect(mockFeatureSelectionCallback).toHaveBeenCalledTimes(1);
    expect(mockFeatureSelectionCallback).toHaveBeenCalledWith('test-feature', expect.any(Object), false);

    // Verify no pending requests remain
    const pendingRequests = (mvtSource as any)._pendingReplacementRequests;
    expect(pendingRequests.size).toBe(0);
  });

  test('should handle rapid selection/deselection gracefully', async () => {
    let callCount = 0;
    mockGetReplacementFeature.mockImplementation(() => {
      callCount++;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            type: 'Feature',
            id: 'test-feature',
            properties: { name: 'Test Feature' },
            geometry: { type: 'Point', coordinates: [0, 0] },
          });
        }, 50);
      });
    });

    // Create mock feature setup
    const mockVectorFeature = {
      type: 1,
      properties: { id: 'test-feature' },
      loadGeometry: jest.fn(),
      bbox: jest.fn(),
      toGeoJSON: jest.fn(),
    };

    const mockTileContext = {
      id: 'tile-1',
      canvas: document.createElement('canvas'),
      context: document.createElement('canvas').getContext('2d'),
      zoom: 10,
      x: 1,
      y: 1,
      tileSize: 256,
      geoTransform: jest.fn(),
    };

    const feature = new MVTFeature({
      mVTSource: mvtSource,
      vectorTileFeature: mockVectorFeature,
      tileContext: mockTileContext,
      style: { fillColor: '#000000' },
      selected: false,
      featureId: 'test-feature',
    });

    const selectFeature = (mvtSource as any)._selectFeature.bind(mvtSource);
    const deselectFeature = (mvtSource as any)._deselectFeature.bind(mvtSource);
    (mvtSource as any)._featureIndex.set('test-feature', feature);

    // Select the feature
    selectFeature('test-feature');

    // Quickly deselect and select again
    deselectFeature('test-feature');
    selectFeature('test-feature');

    // Wait for any async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should handle this gracefully without errors
    expect(callCount).toBeGreaterThan(0);
    expect(mockFeatureSelectionCallback).toHaveBeenCalled();
  });

  test('should clean up all pending requests on dispose', async () => {
    const neverResolvingPromise = new Promise(() => {}); // Never resolves
    mockGetReplacementFeature.mockReturnValue(neverResolvingPromise);

    // Create mock feature
    const mockVectorFeature = {
      type: 1,
      properties: { id: 'test-feature' },
      loadGeometry: jest.fn(),
      bbox: jest.fn(),
      toGeoJSON: jest.fn(),
    };

    const mockTileContext = {
      id: 'tile-1',
      canvas: document.createElement('canvas'),
      context: document.createElement('canvas').getContext('2d'),
      zoom: 10,
      x: 1,
      y: 1,
      tileSize: 256,
      geoTransform: jest.fn(),
    };

    const feature = new MVTFeature({
      mVTSource: mvtSource,
      vectorTileFeature: mockVectorFeature,
      tileContext: mockTileContext,
      style: { fillColor: '#000000' },
      selected: false,
      featureId: 'test-feature',
    });

    const selectFeature = (mvtSource as any)._selectFeature.bind(mvtSource);
    (mvtSource as any)._featureIndex.set('test-feature', feature);

    // Select feature to create a pending request
    selectFeature('test-feature');

    // Verify there's a pending request
    const pendingRequests = (mvtSource as any)._pendingReplacementRequests;
    expect(pendingRequests.size).toBe(1);

    // Dispose the source
    mvtSource.dispose();

    // Verify all pending requests are cleaned up
    expect(pendingRequests.size).toBe(0);
  });
});
