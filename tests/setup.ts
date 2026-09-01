import 'jest-canvas-mock';
import '@testing-library/jest-dom';
import { GeometryPath2D, IDENTITY, Matrix, pathContainsPoint } from './utils/canvasGeometry';

// This file is shared by every suite, including the few that deliberately run
// under the `node` environment to reach non-browser code paths. Everything
// DOM-specific below is guarded so those suites can still use it.
const HAS_DOM = typeof HTMLCanvasElement !== 'undefined';

// Real geometry, not a stub that always says yes. See utils/canvasGeometry.ts.
global.Path2D = GeometryPath2D as unknown as typeof Path2D;

// Mock Google Maps API
global.google = {
  maps: {
    MapTypeId: {
      ROADMAP: 'roadmap',
      SATELLITE: 'satellite',
      HYBRID: 'hybrid',
      TERRAIN: 'terrain',
    },
    Map: jest.fn().mockImplementation(() => ({
      overlayMapTypes: {
        push: jest.fn(),
        removeAt: jest.fn(),
        getAt: jest.fn(),
        getLength: jest.fn().mockReturnValue(0),
        clear: jest.fn(),
      },
      addListener: jest.fn(),
      removeListener: jest.fn(),
      getZoom: jest.fn().mockReturnValue(10),
      getCenter: jest.fn().mockReturnValue({
        lat: jest.fn().mockReturnValue(0),
        lng: jest.fn().mockReturnValue(0),
      }),
      getBounds: jest.fn().mockReturnValue({
        getNorthEast: jest.fn().mockReturnValue({
          lat: jest.fn().mockReturnValue(1),
          lng: jest.fn().mockReturnValue(1),
        }),
        getSouthWest: jest.fn().mockReturnValue({
          lat: jest.fn().mockReturnValue(-1),
          lng: jest.fn().mockReturnValue(-1),
        }),
      }),
      getProjection: jest.fn().mockReturnValue({
        fromLatLngToPoint: jest.fn().mockReturnValue({ x: 100, y: 100 }),
        fromPointToLatLng: jest.fn().mockReturnValue({
          lat: jest.fn().mockReturnValue(0),
          lng: jest.fn().mockReturnValue(0),
        }),
      }),
      getDiv: jest.fn().mockReturnValue(document.createElement('div')),
    })),
    Size: jest.fn().mockImplementation((width, height) => ({ width, height })),
    Point: jest.fn().mockImplementation((x, y) => ({ x, y })),
    LatLng: jest.fn().mockImplementation((lat, lng) => ({
      lat: jest.fn().mockReturnValue(lat),
      lng: jest.fn().mockReturnValue(lng),
      equals: jest.fn().mockReturnValue(false),
      toString: jest.fn().mockReturnValue(`(${lat}, ${lng})`),
    })),
    // A real implementation, not a stub. `extend` used to be a no-op and there
    // were no getSouthWest/getNorthEast at all, so anything asserting on
    // computed bounds - getFeatureBounds, fitBounds - could not fail.
    LatLngBounds: jest.fn().mockImplementation((sw?: any, ne?: any) => {
      let south = Number.POSITIVE_INFINITY;
      let west = Number.POSITIVE_INFINITY;
      let north = Number.NEGATIVE_INFINITY;
      let east = Number.NEGATIVE_INFINITY;

      const bounds = {
        extend(point: any) {
          const lat = typeof point.lat === 'function' ? point.lat() : point.lat;
          const lng = typeof point.lng === 'function' ? point.lng() : point.lng;
          south = Math.min(south, lat);
          north = Math.max(north, lat);
          west = Math.min(west, lng);
          east = Math.max(east, lng);
          return bounds;
        },
        isEmpty: () => south > north,
        getSouthWest: () => ({ lat: () => south, lng: () => west }),
        getNorthEast: () => ({ lat: () => north, lng: () => east }),
        getCenter: () => ({ lat: () => (south + north) / 2, lng: () => (west + east) / 2 }),
        contains: (point: any) => {
          const lat = typeof point.lat === 'function' ? point.lat() : point.lat;
          const lng = typeof point.lng === 'function' ? point.lng() : point.lng;
          return lat >= south && lat <= north && lng >= west && lng <= east;
        },
        toString: () => `((${south}, ${west}), (${north}, ${east}))`,
      };

      if (sw) bounds.extend(sw);
      if (ne) bounds.extend(ne);
      return bounds;
    }),
    event: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      trigger: jest.fn(),
      clearListeners: jest.fn(),
    },
    ControlPosition: {
      TOP_CENTER: 1,
      TOP_LEFT: 2,
      TOP_RIGHT: 3,
    },
  },
} as any;

// Mock fetch for tile requests
global.fetch = jest.fn();

// performance.now is deliberately NOT mocked.
//
// It used to be replaced with Date.now(), which was described as "consistent
// timing" but did the opposite: Date.now has millisecond resolution, so every
// timing assertion in the performance suite was quantised to 1ms and read as
// either 0 or a jump. jsdom provides a real high-resolution performance.now,
// and the performance suite is excluded from the required check anyway, so
// there is nothing to gain by degrading it.

// Enhanced Canvas 2D context mock.
//
// One context per canvas, cached the way the real getContext behaves, so a
// transform set by one call site is visible to the next - which is exactly the
// aliasing the device-pixel-ratio work had to reason about.
const contexts = new WeakMap<HTMLCanvasElement, any>();

if (HAS_DOM) {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: jest.fn(function (this: HTMLCanvasElement) {
      const existing = contexts.get(this);
      if (existing) return existing;

      let matrix: Matrix = { ...IDENTITY };
      const stack: Matrix[] = [];

      const context = {
        save: jest.fn(() => {
          stack.push({ ...matrix });
        }),
        restore: jest.fn(() => {
          matrix = stack.pop() ?? { ...IDENTITY };
        }),
        setTransform: jest.fn((a: number, b: number, c: number, d: number, e: number, f: number) => {
          matrix = { a, b, c, d, e, f };
        }),
        resetTransform: jest.fn(() => {
          matrix = { ...IDENTITY };
        }),
        scale: jest.fn((x: number, y: number) => {
          matrix = { ...matrix, a: matrix.a * x, d: matrix.d * y };
        }),
        getTransform: jest.fn(() => ({ ...matrix })),
        // The point is in untransformed canvas coordinates; the path is scaled
        // by the current transform. Getting this backwards is the bug the DPR
        // hit-testing work exists to prevent, so the mock must model it exactly.
        isPointInPath: jest.fn((path: GeometryPath2D, x: number, y: number) =>
          path instanceof GeometryPath2D ? pathContainsPoint(path, x, y, matrix) : false,
        ),
        canvas: this,
        ...({
          fillRect: jest.fn(),
          strokeRect: jest.fn(),
          clearRect: jest.fn(),
          beginPath: jest.fn(),
          closePath: jest.fn(),
          moveTo: jest.fn(),
          lineTo: jest.fn(),
          arc: jest.fn(),
          fill: jest.fn(),
          stroke: jest.fn(),
          createImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
          putImageData: jest.fn(),
          getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
          translate: jest.fn(),
          rotate: jest.fn(),
          transform: jest.fn(),
          drawImage: jest.fn(),
          createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
          createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
          createPattern: jest.fn(),
          isPointInStroke: jest.fn().mockReturnValue(true),
          measureText: jest.fn(() => ({ width: 10 })),
          clip: jest.fn(),
          quadraticCurveTo: jest.fn(),
          bezierCurveTo: jest.fn(),
          arcTo: jest.fn(),
          rect: jest.fn(),
          fillText: jest.fn(),
          strokeText: jest.fn(),

          fillStyle: '',
          strokeStyle: '',
          lineWidth: 1,
          lineCap: 'butt',
          lineJoin: 'miter',
          miterLimit: 10,
          lineDashOffset: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
          shadowBlur: 0,
          shadowColor: '',
          globalAlpha: 1,
          globalCompositeOperation: 'source-over',
          font: '10px sans-serif',
          textAlign: 'start',
          textBaseline: 'alphabetic',
        } as Record<string, unknown>),
      };

      contexts.set(this, context);
      return context;
    }),
  });
}

// Mock Image constructor
global.Image = class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src: string = '';
  width: number = 0;
  height: number = 0;

  constructor() {
    setTimeout(() => {
      if (this.onload) {
        this.onload();
      }
    }, 0);
  }
} as any;

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  (global.fetch as jest.Mock).mockClear();
});
