// Regression tests for the Phase 3 rendering and interaction work.

jest.mock('@mapbox/vector-tile', () => ({
  VectorTile: jest.fn(),
  VectorTileFeature: jest.fn(),
}));

jest.mock('pbf', () => jest.fn());

import { MVTSource } from '../../src/MVTSource';

const makeMap = (zoom = 10): any => ({
  overlayMapTypes: {
    getArray: jest.fn(() => []),
    removeAt: jest.fn(),
    push: jest.fn(),
    insertAt: jest.fn(),
  },
  data: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    remove: jest.fn(),
    addGeoJson: jest.fn(() => []),
    overrideStyle: jest.fn(),
  },
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  setOptions: jest.fn(),
  getZoom: jest.fn(() => zoom),
  getBounds: jest.fn(() => undefined),
  getProjection: jest.fn(() => undefined),
});

const point = (x: number, y: number): any => ({ x, y });

const setDpr = (value: number): void => {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true, writable: true });
};

/** Listener the source registered for a given map event. */
const listenerFor = (map: any, event: string): ((...args: any[]) => void) | undefined => {
  const call = map.addListener.mock.calls.find((c: any[]) => c[0] === event);
  return call ? call[1] : undefined;
};

describe('MVTSource rendering', () => {
  const originalDpr = window.devicePixelRatio;
  let map: any;
  let source: MVTSource | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    map = makeMap();
    global.fetch = jest.fn(() => new Promise(() => {})) as any;
  });

  afterEach(() => {
    source?.dispose();
    source = undefined;
    setDpr(originalDpr);
  });

  describe('device pixel ratio', () => {
    test('renders the backing store at the display ratio, keeping the CSS size', () => {
      setDpr(2);
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });

      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      expect(tile.width).toBe(512);
      expect(tile.height).toBe(512);
      // Google Maps positions tiles by CSS size, so that must not change.
      expect(tile.style.width).toBe('256px');
      expect(tile.style.height).toBe('256px');
    });

    test('caps the ratio at maxPixelRatio', () => {
      setDpr(4);
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', maxPixelRatio: 2 });

      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      expect(tile.width).toBe(512);
    });

    test('maxPixelRatio 1 restores the pre-1.0 1:1 canvas', () => {
      setDpr(3);
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', maxPixelRatio: 1 });

      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      expect(tile.width).toBe(256);
      expect(tile.height).toBe(256);
    });

    test('honours a custom tileSize at the scaled ratio', () => {
      setDpr(2);
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', tileSize: 512 });

      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      expect(tile.width).toBe(1024);
      expect(tile.style.width).toBe('512px');
    });

    test('records the ratio on the tile context so hit testing can match it', () => {
      setDpr(2);
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      source.getTile(point(1, 2), 10, document);

      const context = (source as any)._visibleTiles['10:1:2'];
      expect(context.pixelRatio).toBe(2);
      expect(context.tileSize).toBe(256);
    });
  });

  describe('tile fade-in', () => {
    test('a new tile starts transparent with a transition', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });

      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      expect(tile.style.opacity).toBe('0');
      expect(tile.style.transition).toContain('opacity');
    });

    test('fadeInDuration 0 paints instantly, with no opacity applied', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', fadeInDuration: 0 });

      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      expect(tile.style.opacity).toBe('');
      expect(tile.style.transition).toBe('');
    });

    test('the tile is revealed once it has been drawn', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;
      const context = (source as any)._visibleTiles['10:1:2'];

      (source as any)._drawVectorTile({ layers: {} }, context);

      expect(tile.style.opacity).toBe('1');
    });

    test('a failed tile is revealed too, rather than left pinned at zero', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;
      const context = (source as any)._visibleTiles['10:1:2'];

      (source as any)._revealTile(context);

      expect(tile.style.opacity).toBe('1');
    });
  });

  describe('cursor feedback', () => {
    test('shows the pointer while over a feature and clears it after', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });

      (source as any)._setHoverCursor(true);
      expect(map.setOptions).toHaveBeenCalledWith({ draggableCursor: 'pointer' });

      map.setOptions.mockClear();
      (source as any)._setHoverCursor(false);
      // null hands the cursor back to the map, rather than pinning 'default'
      // and breaking the grab cursor shown while dragging.
      expect(map.setOptions).toHaveBeenCalledWith({ draggableCursor: null });
    });

    test('does not touch the map when the state has not changed', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });

      (source as any)._setHoverCursor(true);
      map.setOptions.mockClear();
      (source as any)._setHoverCursor(true);
      (source as any)._setHoverCursor(true);

      expect(map.setOptions).not.toHaveBeenCalled();
    });

    test('honours a custom cursor', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', hoverCursor: 'crosshair' });

      (source as any)._setHoverCursor(true);

      expect(map.setOptions).toHaveBeenCalledWith({ draggableCursor: 'crosshair' });
    });

    test('hoverCursor false leaves the cursor entirely alone', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', hoverCursor: false });

      (source as any)._setHoverCursor(true);

      expect(map.setOptions).not.toHaveBeenCalled();
    });

    test('the cursor is handed back on dispose', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      (source as any)._setHoverCursor(true);
      map.setOptions.mockClear();

      source.dispose();
      source = undefined;

      expect(map.setOptions).toHaveBeenCalledWith({ draggableCursor: null });
    });
  });

  describe('hover wiring', () => {
    test('mousemove is bound even without an onMouseHover callback', () => {
      // FeatureStyle.hover is a documented option, but mousemove used to be
      // wired only when a callback was supplied, so hover styling was dead for
      // everyone who just wanted the style.
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });

      expect(listenerFor(map, 'mousemove')).toBeDefined();
      expect(listenerFor(map, 'mouseout')).toBeDefined();
    });

    test('mousemove is skipped when nothing can observe hover', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', hoverCursor: false });

      expect(listenerFor(map, 'mousemove')).toBeUndefined();
    });

    test('hover runs behind the frame throttle rather than synchronously', () => {
      jest.useFakeTimers();
      try {
        source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
        const hitTest = jest.spyOn(source as any, '_runHoverHitTest').mockImplementation(() => {});
        jest.spyOn(source as any, '_convertToMVTEvent').mockImplementation(() => ({ pixel: {}, latLng: {} }));

        const onMove = listenerFor(map, 'mousemove')!;
        for (let i = 0; i < 10; i++) onMove({ latLng: {} });

        // Ten moves inside one frame must not be ten hit-test sweeps.
        expect(hitTest).not.toHaveBeenCalled();
        jest.advanceTimersByTime(16);
        expect(hitTest).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    test('hovering never selects, even with no hover callback', () => {
      // Hover used to be identified by comparing the callback against
      // onMouseHover. With cursor-only hover there is no callback, so the
      // comparison failed and every feature the pointer crossed fell through
      // into the selection branch and got selected.
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      const feature = { featureId: 'f1' };

      (source as any)._mouseSelectedFeature({ feature }, undefined, {
        setSelected: true,
        hover: true,
      });

      expect(source.isFeatureSelected('f1')).toBe(false);
      expect(source.isFeatureHovered('f1')).toBe(true);
    });

    test('clicking still selects', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      const feature = { featureId: 'f1' };

      (source as any)._mouseSelectedFeature({ feature }, undefined, {
        setSelected: true,
        hover: false,
      });

      expect(source.isFeatureSelected('f1')).toBe(true);
    });

    test('the same function as both onClick and onMouseHover still separates the two', () => {
      const shared = jest.fn();
      source = new MVTSource(map, {
        url: 'https://example.com/{z}/{x}/{y}.pbf',
        onClick: shared,
        onMouseHover: shared,
      });
      const feature = { featureId: 'f1' };

      (source as any)._mouseSelectedFeature({ feature }, shared, { setSelected: true, hover: false });

      expect(source.isFeatureSelected('f1')).toBe(true);
    });

    test('hover clears when the pointer leaves the loaded tiles', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      const clearHover = jest.spyOn(source, 'clearAllHoveredFeatures');

      // No tile is loaded at this location, so there is nothing to hit test.
      const latLng = { lat: () => 48.85, lng: () => 2.35 };
      (source as any)._mouseEventContinue({ latLng, pixel: { x: 0, y: 0 } }, undefined, { hover: true });

      expect(clearHover).toHaveBeenCalled();
    });

    test('mouseout clears hover state and the cursor', () => {
      source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      (source as any)._setHoverCursor(true);
      const clearHover = jest.spyOn(source, 'clearAllHoveredFeatures');
      map.setOptions.mockClear();

      listenerFor(map, 'mouseout')!();

      expect(clearHover).toHaveBeenCalled();
      expect(map.setOptions).toHaveBeenCalledWith({ draggableCursor: null });
    });
  });
});
