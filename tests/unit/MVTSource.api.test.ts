// Regression tests for the Phase 4 public API work.

jest.mock('@mapbox/vector-tile', () => ({
  VectorTile: jest.fn(),
  VectorTileFeature: jest.fn(),
}));

jest.mock('pbf', () => jest.fn());

import { MVTSource } from '../../src/MVTSource';
import { MVTError, MVTOptionsError } from '../../src/errors';
import { debugLogger } from '../../src/DebugLogger';

const URL = 'https://example.com/{z}/{x}/{y}.pbf';

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
  fitBounds: jest.fn(),
  getZoom: jest.fn(() => zoom),
  getBounds: jest.fn(() => undefined),
  getProjection: jest.fn(() => undefined),
});

const point = (x: number, y: number): any => ({ x, y });

describe('MVTSource public API', () => {
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
  });

  describe('option validation', () => {
    test('rejects a missing url instead of rendering nothing', () => {
      // `this._url = options.url || ''` used to accept anything, and the docs
      // showed a try/catch around a constructor that never threw.
      expect(() => new MVTSource(map, {} as any)).toThrow(MVTOptionsError);
      expect(() => new MVTSource(map, { url: '' })).toThrow(/options\.url is required/);
      expect(() => new MVTSource(map, { url: '   ' })).toThrow(/options\.url is required/);
    });

    test('rejects a url that is not a tile template, naming what is missing', () => {
      expect(() => new MVTSource(map, { url: 'https://example.com/tiles.pbf' })).toThrow(/missing \{z\}, \{x\}, \{y\}/);
      expect(() => new MVTSource(map, { url: 'https://example.com/{z}/{x}.pbf' })).toThrow(/missing \{y\}/);
    });

    test('rejects something that is not a map', () => {
      expect(() => new MVTSource(null as any, { url: URL })).toThrow(MVTOptionsError);
      expect(() => new MVTSource({} as any, { url: URL })).toThrow(/does not look like a google\.maps\.Map/);
    });

    test('rejects a non-positive tileSize', () => {
      expect(() => new MVTSource(map, { url: URL, tileSize: 0 })).toThrow(/positive number/);
      expect(() => new MVTSource(map, { url: URL, tileSize: -256 })).toThrow(/positive number/);
    });

    test('rejects a maxPixelRatio below 1', () => {
      expect(() => new MVTSource(map, { url: URL, maxPixelRatio: 0.5 })).toThrow(/at least 1/);
    });

    test('rejects an inverted zoom range', () => {
      expect(() => new MVTSource(map, { url: URL, minZoom: 12, maxZoom: 8 })).toThrow(/cannot exceed/);
    });

    test('errors carry the option name and are catchable as MVTError', () => {
      try {
        new MVTSource(map, { url: '' });
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MVTError);
        expect((error as MVTOptionsError).option).toBe('url');
      }
    });

    test('a valid configuration constructs', () => {
      expect(() => {
        source = new MVTSource(map, { url: URL, tileSize: 512, minZoom: 2, maxZoom: 18 });
      }).not.toThrow();
    });
  });

  describe('zoom limits', () => {
    test('defaults span the full Google Maps range, not a hardcoded 6', () => {
      source = new MVTSource(map, { url: URL });

      expect(source.minZoom).toBe(0);
      expect(source.maxZoom).toBe(22);
    });

    test('maxZoom is not clamped to sourceMaxZoom, so overzoom stays reachable', () => {
      // Setting maxZoom to sourceMaxZoom told Google Maps to stop requesting
      // tiles exactly where overzooming was meant to take over.
      source = new MVTSource(map, { url: URL, sourceMaxZoom: 14 });

      expect(source.maxZoom).toBeGreaterThan(14);
    });

    test('honours explicit limits', () => {
      source = new MVTSource(map, { url: URL, minZoom: 4, maxZoom: 16 });

      expect(source.minZoom).toBe(4);
      expect(source.maxZoom).toBe(16);
    });
  });

  describe('setSelection', () => {
    beforeEach(() => {
      source = new MVTSource(map, { url: URL });
    });

    test('replaces by default', () => {
      source!.setSelection(['a', 'b']);
      source!.setSelection(['c']);

      expect(source!.getSelectedFeatureIds().sort()).toEqual(['c']);
    });

    test('adds without dropping what is already selected', () => {
      source!.setSelection(['a']);
      source!.setSelection(['b', 'c'], { mode: 'add' });

      expect(source!.getSelectedFeatureIds().sort()).toEqual(['a', 'b', 'c']);
    });

    test('removes only what it is given', () => {
      source!.setSelection(['a', 'b', 'c']);
      source!.setSelection(['b'], { mode: 'remove' });

      expect(source!.getSelectedFeatureIds().sort()).toEqual(['a', 'c']);
    });

    test('an empty replace clears the selection', () => {
      source!.setSelection(['a', 'b']);
      source!.setSelection([]);

      expect(source!.getSelectedFeatureIds()).toEqual([]);
    });

    test('does not latch multipleSelection and change click behaviour', () => {
      // Passing a 2-element array, or calling addToSelection even once, used
      // to set _multipleSelection true permanently - so clicks stopped
      // replacing the selection for the rest of the session.
      source!.setSelection(['a', 'b']);
      source!.setSelection(['c'], { mode: 'add' });

      expect((source as any)._multipleSelection).toBe(false);
    });

    test('respects multipleSelection when it was actually requested', () => {
      source!.dispose();
      source = new MVTSource(map, { url: URL, multipleSelection: true });

      expect((source as any)._multipleSelection).toBe(true);
    });
  });

  describe('events', () => {
    beforeEach(() => {
      source = new MVTSource(map, { url: URL });
    });

    test('selectionchange reports what was added and removed', () => {
      const listener = jest.fn();
      source!.on('selectionchange', listener);

      source!.setSelection(['a', 'b']);

      expect(listener).toHaveBeenCalledWith({
        selected: ['a', 'b'],
        added: ['a', 'b'],
        removed: [],
      });

      listener.mockClear();
      source!.setSelection(['b', 'c']);

      expect(listener).toHaveBeenCalledWith({
        selected: ['b', 'c'],
        added: ['c'],
        removed: ['a'],
      });
    });

    test('selectionchange stays quiet when nothing actually changed', () => {
      source!.setSelection(['a']);
      const listener = jest.fn();
      source!.on('selectionchange', listener);

      source!.setSelection(['a']);

      expect(listener).not.toHaveBeenCalled();
    });

    test('tileerror carries the tile id and the HTTP status', () => {
      const listener = jest.fn();
      source!.on('tileerror', listener);
      const tileContext = { id: '10:1:2', canvas: document.createElement('canvas'), zoom: 10, tileSize: 256 };

      (source as any)._tileLoader._callbacks.onFailed(tileContext, { status: 404, error: new Error('nope') });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ tileId: '10:1:2', status: 404 }));
    });

    test('tileload fires once a tile has been drawn', () => {
      const listener = jest.fn();
      source!.on('tileload', listener);
      source!.getTile(point(1, 2), 10, document);
      const tileContext = (source as any)._visibleTiles['10:1:2'];

      (source as any)._drawVectorTile({ layers: {} }, tileContext);

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ tileId: '10:1:2' }));
    });

    test('load fires once and idle fires on each transition into idle', () => {
      const load = jest.fn();
      const idle = jest.fn();
      source!.on('load', load);
      source!.on('idle', idle);

      source!.getTile(point(1, 2), 10, document);
      (source as any)._markTileLoaded('10:1:2');
      expect(load).toHaveBeenCalledTimes(1);
      expect(idle).toHaveBeenCalledTimes(1);

      // A new tile drops out of idle, then back in.
      source!.getTile(point(3, 4), 10, document);
      (source as any)._checkIdle();
      (source as any)._markTileLoaded('10:3:4');

      expect(load).toHaveBeenCalledTimes(1);
      expect(idle).toHaveBeenCalledTimes(2);
    });

    test('off removes a listener', () => {
      const listener = jest.fn();
      source!.on('selectionchange', listener);
      source!.off('selectionchange', listener);

      source!.setSelection(['a']);

      expect(listener).not.toHaveBeenCalled();
    });

    test('dispose drops every listener', () => {
      const listener = jest.fn();
      source!.on('selectionchange', listener);

      source!.dispose();
      source = undefined;

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    test('reports real numbers rather than a permanently-false debug flag', () => {
      // MVTUtils.performance.getMetrics read mvtSource.options?.debug, a
      // property that has never existed, so debugEnabled was always false.
      source = new MVTSource(map, { url: URL, debug: true });
      source.getTile(point(1, 2), 10, document);
      source.setSelection(['a']);

      const stats = source.getStats();

      expect(stats.debug).toBe(true);
      expect(stats.visibleTiles).toBe(1);
      expect(stats.selectedFeatures).toBe(1);
      expect(stats.disposed).toBe(false);
      expect(stats.pixelRatio).toBeGreaterThan(0);
    });

    test('reports disposal', () => {
      source = new MVTSource(map, { url: URL });
      source.dispose();

      expect(source.getStats().disposed).toBe(true);
      source = undefined;
    });
  });

  describe('visibility and opacity', () => {
    beforeEach(() => {
      source = new MVTSource(map, { url: URL, fadeInDuration: 0 });
    });

    test('setOpacity applies to tiles already on screen', () => {
      const tile = source!.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      source!.setOpacity(0.5);

      expect(tile.style.opacity).toBe('0.5');
      expect(source!.getOpacity()).toBe(0.5);
    });

    test('setOpacity applies to tiles created later', () => {
      source!.setOpacity(0.25);

      const tile = source!.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      expect(tile.style.opacity).toBe('0.25');
    });

    test('clamps out-of-range opacity', () => {
      source!.setOpacity(5);
      expect(source!.getOpacity()).toBe(1);
      source!.setOpacity(-1);
      expect(source!.getOpacity()).toBe(0);
    });

    test('hide and show toggle tiles without tearing anything down', () => {
      const tile = source!.getTile(point(1, 2), 10, document) as HTMLCanvasElement;
      source!.setSelection(['a']);

      source!.hide();
      expect(tile.style.display).toBe('none');
      expect(source!.isVisible()).toBe(false);
      // Selection survives, which is what separates hide() from dispose().
      expect(source!.getSelectedFeatureIds()).toEqual(['a']);

      source!.show();
      expect(tile.style.display).toBe('');
      expect(source!.isVisible()).toBe(true);
    });

    test('a tile requested while hidden does not appear', () => {
      source!.hide();

      const tile = source!.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

      expect(tile.style.display).toBe('none');
    });

    test('a fade-in reveal ramps to the source opacity, not to 1', () => {
      source!.dispose();
      source = new MVTSource(map, { url: URL });
      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;
      source.setOpacity(0.4);

      (source as any)._revealTile((source as any)._visibleTiles['10:1:2']);

      expect(tile.style.opacity).toBe('0.4');
    });
  });

  describe('getters', () => {
    test('complete the setter pairs', () => {
      const filter = (): boolean => true;
      source = new MVTSource(map, { url: URL, clickableLayers: ['roads'], filter });

      expect(source.getUrl()).toBe(URL);
      expect(source.getClickableLayers()).toEqual(['roads']);
      expect(source.getFilter()).toBe(filter);

      source.setUrl('https://other.example.com/{z}/{x}/{y}.pbf', false);
      expect(source.getUrl()).toBe('https://other.example.com/{z}/{x}/{y}.pbf');
    });

    test('getStyle returns what was configured', () => {
      const style = { fillStyle: 'red' };
      source = new MVTSource(map, { url: URL, style });

      expect(source.getStyle()).toBe(style);
    });
  });

  describe('refreshTile', () => {
    test('re-fetches rather than repainting from cached geometry', () => {
      source = new MVTSource(map, { url: URL });
      source.getTile(point(1, 2), 10, document);
      (global.fetch as jest.Mock).mockClear();

      source.refreshTile('10:1:2');

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('is a no-op for a tile that is not visible', () => {
      source = new MVTSource(map, { url: URL });
      (global.fetch as jest.Mock).mockClear();

      expect(() => source!.refreshTile('10:9:9')).not.toThrow();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('fitBounds', () => {
    test('reports false for a feature that is not loaded', () => {
      source = new MVTSource(map, { url: URL });

      expect(source.fitBounds('nope')).toBe(false);
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    test('getFeatureBounds is undefined for a feature that is not loaded', () => {
      source = new MVTSource(map, { url: URL });

      expect(source.getFeatureBounds('nope')).toBeUndefined();
    });
  });

  describe('debug logging', () => {
    test('a second source with debug off does not silence the first', () => {
      // setDebug wrote a process-global boolean, so constructing any source
      // with debug: false turned debugging off for every other source.
      const first = new MVTSource(map, { url: URL, debug: true });
      expect(debugLogger.isDebugEnabled()).toBe(true);

      const second = new MVTSource(makeMap(), { url: URL, debug: false });
      expect(debugLogger.isDebugEnabled()).toBe(true);

      second.dispose();
      expect(debugLogger.isDebugEnabled()).toBe(true);

      first.dispose();
      expect(debugLogger.isDebugEnabled()).toBe(false);
    });
  });
});
