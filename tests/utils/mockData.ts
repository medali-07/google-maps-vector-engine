import { VectorTileFeature } from '@mapbox/vector-tile';
import { TileContext, GeometryType } from '../../src/types';

/**
 * Mock utilities for testing google-maps-vector-engine
 */

export function createMockVectorTileFeature(overrides: Partial<VectorTileFeature> = {}): VectorTileFeature {
  const defaultFeature = {
    id: Math.floor(Math.random() * 1000),
    properties: {
      name: 'Mock Feature',
      category: 'test',
      ...overrides.properties,
    },
    type: GeometryType.Polygon,
    extent: 4096,

    loadGeometry: jest.fn(() => [
      [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ],
      ],
    ]),

    bbox: jest.fn(() => [0, 0, 100, 100]),
    toGeoJSON: jest.fn(() => ({
      type: 'Feature',
      properties: overrides.properties || { name: 'Mock Feature' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    })),

    ...overrides,
  };

  return defaultFeature as unknown as VectorTileFeature;
}

export function createMockPointFeature(overrides: Partial<VectorTileFeature> = {}): VectorTileFeature {
  return createMockVectorTileFeature({
    type: GeometryType.Point,
    loadGeometry: jest.fn(() => [[{ x: 50, y: 50 }]]),
    ...overrides,
  });
}

export function createMockLineFeature(overrides: Partial<VectorTileFeature> = {}): VectorTileFeature {
  return createMockVectorTileFeature({
    type: GeometryType.LineString,
    loadGeometry: jest.fn(() => [
      [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 100 },
      ],
    ]),
    ...overrides,
  });
}

export function createMockTileContext(overrides: Partial<TileContext> = {}): TileContext {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;

  return {
    id: `test-tile-${Math.random().toString(36).substr(2, 9)}`,
    canvas,
    zoom: 10,
    tileSize: 256,
    vectorTile: undefined,
    ...overrides,
  };
}

export function createMockMVTSource(): any {
  const map = new google.maps.Map(document.createElement('div'));

  return {
    map,
    options: {
      url: 'https://example.com/{z}/{x}/{y}.pbf',
      debug: false,
      cache: true,
      tileSize: 256,
      multipleSelection: true,
      setSelectedOnClick: false,
    },
    mVTLayers: {},
    loadedTilesLen: 0,

    // Mock methods
    isFeatureSelected: jest.fn(() => false),
    getSelectedFeaturesInTile: jest.fn(() => []),
    getSelectedFeatureIds: jest.fn(() => []),
    setSelectedFeatures: jest.fn(),
    redrawTile: jest.fn(),
    redrawAllTiles: jest.fn(),
    getTileObject: jest.fn(() => ({ x: 0, y: 0, z: 10 })),
    deleteTileDrawn: jest.fn(),
    dispose: jest.fn(),
    setStyle: jest.fn(),
    setFilter: jest.fn(),
    setVisibleLayers: jest.fn(),
    getFeature: jest.fn(),
  };
}

export function createMockGoogleMap(): google.maps.Map {
  return new google.maps.Map(document.createElement('div'), {
    center: { lat: 0, lng: 0 },
    zoom: 10,
  });
}

export function createMockMouseEvent(overrides: any = {}): any {
  return {
    latLng: new google.maps.LatLng(0, 0),
    pixel: new google.maps.Point(100, 100),
    tilePoint: { x: 50, y: 50 },
    feature: null,
    tileContext: createMockTileContext(),
    ...overrides,
  };
}

export function generateSamplePBFData(): ArrayBuffer {
  // Create a minimal PBF-like ArrayBuffer for testing
  const buffer = new ArrayBuffer(64);
  const view = new Uint8Array(buffer);

  // Add some mock PBF header bytes
  view[0] = 0x1a; // MVT magic number
  view[1] = 0x02; // Version

  return buffer;
}

export function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    fillRect: jest.fn(),
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
    scale: jest.fn(),
    translate: jest.fn(),
    isPointInPath: jest.fn().mockReturnValue(true),
    canvas: {
      width: 256,
      height: 256,
    },
  } as any;
}

export const mockFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'feature1',
      properties: { name: 'Feature 1', category: 'A' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      id: 'feature2',
      properties: { name: 'Feature 2', category: 'B' },
      geometry: {
        type: 'Point',
        coordinates: [0.5, 0.5],
      },
    },
  ],
};

export const sampleTileManifest = {
  '10': {
    '512': [
      [256, 300],
      [400, 450],
    ],
    '513': [[256, 300]],
  },
  '11': {
    '1024': [[512, 600]],
    '1025': [[512, 600]],
  },
};
