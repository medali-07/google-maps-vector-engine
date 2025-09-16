import 'jest-canvas-mock';
import '@testing-library/jest-dom';

// Mock Google Maps API
global.google = {
  maps: {
    MapTypeId: {
      ROADMAP: 'roadmap',
      SATELLITE: 'satellite',
      HYBRID: 'hybrid',
      TERRAIN: 'terrain'
    },
    Map: jest.fn().mockImplementation(() => ({
      overlayMapTypes: {
        push: jest.fn(),
        removeAt: jest.fn(),
        getAt: jest.fn(),
        getLength: jest.fn().mockReturnValue(0),
        clear: jest.fn()
      },
      addListener: jest.fn(),
      removeListener: jest.fn(),
      getZoom: jest.fn().mockReturnValue(10),
      getCenter: jest.fn().mockReturnValue({ 
        lat: jest.fn().mockReturnValue(0), 
        lng: jest.fn().mockReturnValue(0) 
      }),
      getBounds: jest.fn().mockReturnValue({
        getNorthEast: jest.fn().mockReturnValue({ 
          lat: jest.fn().mockReturnValue(1), 
          lng: jest.fn().mockReturnValue(1) 
        }),
        getSouthWest: jest.fn().mockReturnValue({ 
          lat: jest.fn().mockReturnValue(-1), 
          lng: jest.fn().mockReturnValue(-1) 
        })
      }),
      getProjection: jest.fn().mockReturnValue({
        fromLatLngToPoint: jest.fn().mockReturnValue({ x: 100, y: 100 }),
        fromPointToLatLng: jest.fn().mockReturnValue({ 
          lat: jest.fn().mockReturnValue(0), 
          lng: jest.fn().mockReturnValue(0) 
        })
      }),
      getDiv: jest.fn().mockReturnValue(document.createElement('div'))
    })),
    Size: jest.fn().mockImplementation((width, height) => ({ width, height })),
    Point: jest.fn().mockImplementation((x, y) => ({ x, y })),
    LatLng: jest.fn().mockImplementation((lat, lng) => ({ 
      lat: jest.fn().mockReturnValue(lat), 
      lng: jest.fn().mockReturnValue(lng),
      equals: jest.fn().mockReturnValue(false),
      toString: jest.fn().mockReturnValue(`(${lat}, ${lng})`)
    })),
    LatLngBounds: jest.fn().mockImplementation(() => ({
      contains: jest.fn().mockReturnValue(true),
      extend: jest.fn(),
      getCenter: jest.fn().mockReturnValue({ 
        lat: jest.fn().mockReturnValue(0), 
        lng: jest.fn().mockReturnValue(0) 
      })
    })),
    event: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      trigger: jest.fn(),
      clearListeners: jest.fn()
    },
    ControlPosition: {
      TOP_CENTER: 1,
      TOP_LEFT: 2,
      TOP_RIGHT: 3
    }
  }
} as any;

// Mock fetch for tile requests
global.fetch = jest.fn();

// Mock performance.now for consistent timing
global.performance = {
  ...global.performance,
  now: jest.fn(() => Date.now())
};

// Enhanced Canvas 2D context mock
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: jest.fn(() => ({
    fillRect: jest.fn(),
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
    save: jest.fn(),
    restore: jest.fn(),
    scale: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    transform: jest.fn(),
    setTransform: jest.fn(),
    drawImage: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
    createPattern: jest.fn(),
    isPointInPath: jest.fn().mockReturnValue(true),
    isPointInStroke: jest.fn().mockReturnValue(true),
    measureText: jest.fn(() => ({ width: 10 })),
    clip: jest.fn(),
    quadraticCurveTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    arcTo: jest.fn(),
    rect: jest.fn(),
    fillText: jest.fn(),
    strokeText: jest.fn(),
    
    // Canvas properties
    canvas: {
      width: 256,
      height: 256,
      toDataURL: jest.fn(() => 'data:image/png;base64,mock')
    },
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
    textBaseline: 'alphabetic'
  }))
});

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
