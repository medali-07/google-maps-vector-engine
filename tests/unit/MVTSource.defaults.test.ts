// Optional-parameter and default-argument branches, plus the handful of paths
// that only run when something is absent. Individually small, but they are
// most of what separates the branch total from the statement total.

import fs from 'fs';
import path from 'path';
import { MVTSource } from '../../src/MVTSource';

const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.pbf'));
const URL = 'https://tiles.test/{z}/{x}/{y}.pbf';

const latLng = (lat: number, lng: number): any => ({ lat: () => lat, lng: () => lng });

const makeMap = (overrides: Record<string, unknown> = {}): any => ({
  overlayMapTypes: { getArray: () => [], removeAt: jest.fn(), push: jest.fn(), insertAt: jest.fn() },
  data: {
    addListener: () => ({ remove: jest.fn() }),
    remove: jest.fn(),
    addGeoJson: () => [{ setProperty: jest.fn() }],
    overrideStyle: jest.fn(),
  },
  addListener: () => ({ remove: jest.fn() }),
  setOptions: jest.fn(),
  fitBounds: jest.fn(),
  getZoom: () => 10,
  getBounds: () => ({ getNorthEast: () => latLng(85, 180), getSouthWest: () => latLng(-85, -180) }),
  getProjection: () => ({ fromLatLngToPoint: () => ({ x: 128, y: 128 }) }),
  ...overrides,
});

const point = (x: number, y: number): any => ({ x, y });

const respondWithFixture = (): jest.Mock =>
  jest.fn(() =>
    Promise.resolve({
      status: 200,
      statusText: 'OK',
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(FIXTURE.buffer.slice(FIXTURE.byteOffset, FIXTURE.byteOffset + FIXTURE.byteLength)),
    }),
  );

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('MVTSource defaults', () => {
  let source: MVTSource | undefined;

  beforeEach(() => {
    global.fetch = respondWithFixture() as any;
  });

  afterEach(() => {
    source?.dispose();
    source = undefined;
  });

  const loaded = async (options: Record<string, unknown> = {}): Promise<MVTSource> => {
    source = new MVTSource(makeMap(), { url: URL, ...options } as any);
    source.getTile(point(512, 512), 10, document);
    await flush();
    return source;
  };

  describe('mutators default to redrawing', () => {
    test('setStyle, setFilter, setUrl and setVisibleLayers all accept a single argument', async () => {
      jest.useFakeTimers();
      try {
        const s = await loaded();

        expect(() => {
          s.setStyle({ fillStyle: 'red' });
          s.setFilter(() => true);
          s.setVisibleLayers(['roads']);
          s.setUrl('https://other.test/{z}/{x}/{y}.pbf');
        }).not.toThrow();

        jest.advanceTimersByTime(50);
      } finally {
        jest.useRealTimers();
      }
    });

    test('setFilter false clears the filter', async () => {
      const s = await loaded({ filter: () => true });

      s.setFilter(false, false);

      expect(s.getFilter()).toBe(false);
    });
  });

  describe('events with optional listeners', () => {
    test('once fires a single time and then unsubscribes', async () => {
      const s = await loaded();
      const listener = jest.fn();
      s.once('selectionchange', listener);

      s.setSelection([1]);
      s.setSelection([2]);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('off with only an event name drops every listener for it', async () => {
      const s = await loaded();
      const a = jest.fn();
      const b = jest.fn();
      s.on('selectionchange', a);
      s.on('selectionchange', b);

      s.off('selectionchange');
      s.setSelection([1]);

      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
    });

    test('off with no arguments drops everything', async () => {
      const s = await loaded();
      const listener = jest.fn();
      s.on('selectionchange', listener);
      s.on('tileload', listener);

      s.off();
      s.setSelection([1]);

      expect(listener).not.toHaveBeenCalled();
    });

    test('the unsubscribe function returned by on works', async () => {
      const s = await loaded();
      const listener = jest.fn();

      const stop = s.on('selectionchange', listener);
      stop();
      s.setSelection([1]);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('tileLoaded default timeout', () => {
    test('accepts no argument at all', async () => {
      const s = await loaded();

      await expect(s.tileLoaded()).resolves.toBe(true);
    });
  });

  describe('paths taken when something is absent', () => {
    test('a source with no clickable layers consults them all', async () => {
      const s = await loaded();

      expect(s.getClickableLayers()).toBe(false);
    });

    test('a source with no style uses the built-in default', async () => {
      const s = await loaded();

      expect(typeof s.getStyle()).toBe('function');
    });

    test('a source with no manifest reports none', async () => {
      const s = await loaded();

      expect(s.getTileAvailabilityManifest()).toBeUndefined();
    });

    test('refreshManifest with no manifest configured is harmless', async () => {
      const s = await loaded();

      await expect(s.refreshManifest()).resolves.toBeUndefined();
    });

    test('setTileAvailabilityManifest with no argument clears it', async () => {
      const s = await loaded();
      await s.setTileAvailabilityManifest({ '10': { '1': [[0, 5]] } });
      expect(s.getTileAvailabilityManifest()).toBeDefined();

      await s.setTileAvailabilityManifest();

      // Clearing must actually clear: returning early here left the previous
      // manifest resolved, with no way to un-filter tiles.
      expect(s.getTileAvailabilityManifest()).toBeUndefined();
    });

    test('a manifest that fails to load leaves tiles unfiltered', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation();
      source = new MVTSource(makeMap(), {
        url: URL,
        tileAvailabilityManifest: () => Promise.reject(new Error('down')),
      });
      await flush();

      expect(source.getTileAvailabilityManifest()).toBeUndefined();
      warn.mockRestore();
    });

    test('deselecting a feature aborts its pending replacement request', async () => {
      let settle: (v: unknown) => void = () => {};
      const s = await loaded({
        getReplacementFeature: () => new Promise((resolve) => (settle = resolve)),
        featureSelectionCallback: jest.fn(),
      });

      s.setSelection([1]);
      await flush();
      expect((s as any)._pendingReplacementRequests.size).toBe(1);

      s.setSelection([]);
      await flush();

      expect((s as any)._pendingReplacementRequests.size).toBe(0);
      settle(null);
    });

    test('a second selection of the same feature does not duplicate the request', async () => {
      const s = await loaded({
        getReplacementFeature: () => new Promise(() => {}),
        featureSelectionCallback: jest.fn(),
      });

      s.setSelection([1]);
      await flush();
      s.setSelection([1], { mode: 'add' });
      await flush();

      expect((s as any)._pendingReplacementRequests.size).toBe(1);
    });
  });

  describe('tile drawing entry points', () => {
    test('drawTile builds a context directly', async () => {
      const s = await loaded();

      const context = s.drawTile(point(1, 2), 10, document);

      expect(context.id).toBe('10:1:2');
      expect(context.canvas).toBeInstanceOf(HTMLCanvasElement);
    });

    test('getTile hands back a canvas element', async () => {
      const s = await loaded();

      const node = s.getTile(point(7, 7), 10, document);

      expect(node).toBeInstanceOf(HTMLCanvasElement);
    });

    test('redrawing a tile twice does not redraw the debug overlay', async () => {
      const s = await loaded({ debug: true, cache: true });
      const context = (s as any)._visibleTiles['10:512:512'];
      const canvasContext = context.canvas.getContext('2d');
      canvasContext.strokeRect.mockClear();

      (s as any)._drawVectorTile(context.vectorTile, context);

      expect(canvasContext.strokeRect).not.toHaveBeenCalled();
    });
  });

  describe('feature to vector feature', () => {
    test('returns null for a feature with no tiles left', async () => {
      const s = await loaded();
      const feature = s.getFeature(1)!;
      Object.keys(feature.getTiles()).forEach((id) => feature.removeTile(id));

      expect((s as any)._getVectorFeatureFromMVTFeature(feature)).toBeNull();
    });

    test('returns the decoded feature when a tile is present', async () => {
      const s = await loaded();

      expect((s as any)._getVectorFeatureFromMVTFeature(s.getFeature(1))).toBeDefined();
    });
  });
});
