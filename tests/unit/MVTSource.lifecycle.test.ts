// Regression tests for the Phase 1 tile-lifecycle and memory fixes.
//
// Each test here corresponds to a specific defect that shipped in 0.2.0.

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
  getZoom: jest.fn(() => zoom),
  getBounds: jest.fn(() => undefined),
  getProjection: jest.fn(() => undefined),
});

const point = (x: number, y: number): any => ({ x, y });

describe('MVTSource tile lifecycle', () => {
  let map: any;
  let source: MVTSource;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    map = makeMap();

    // Never resolves, so requests stay in flight for abort assertions.
    fetchMock = jest.fn(() => new Promise(() => {}));
    global.fetch = fetchMock as any;

    source = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
  });

  afterEach(() => {
    source.dispose();
  });

  describe('tile id normalization', () => {
    // Google Maps hands out unwrapped x for repeated worlds and across the
    // antimeridian. Stored ids must match what hit-testing derives.
    test('wraps negative x into the valid range', () => {
      expect(source.getTileId(3, -1, 2)).toBe('3:7:2');
    });

    test('wraps x beyond the world width', () => {
      expect(source.getTileId(3, 8, 2)).toBe('3:0:2');
      expect(source.getTileId(3, 9, 2)).toBe('3:1:2');
    });

    test('leaves in-range x untouched', () => {
      expect(source.getTileId(3, 5, 2)).toBe('3:5:2');
    });

    test('requests a wrapped x rather than a negative one', () => {
      source.getTile(point(-1, 2), 3, document);
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toBe('https://example.com/3/7/2.pbf');
      expect(url).not.toContain('-1');
    });

    test('getTileObject rejects a malformed id instead of returning NaN', () => {
      expect(() => source.getTileObject('not-a-tile')).toThrow(/Malformed tile id/);
    });
  });

  describe('releaseTile', () => {
    test('aborts the in-flight request for the released tile', () => {
      const node = source.getTile(point(1, 1), 10, document);
      const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;

      expect(signal.aborted).toBe(false);
      source.releaseTile(node);
      expect(signal.aborted).toBe(true);
    });

    test('drops the tile from the visible set', () => {
      const node = source.getTile(point(1, 1), 10, document);
      expect(Object.keys((source as any)._visibleTiles)).toContain('10:1:1');

      source.releaseTile(node);
      expect(Object.keys((source as any)._visibleTiles)).not.toContain('10:1:1');
    });

    test('is a no-op for an unknown node', () => {
      const stray = document.createElement('canvas');
      expect(() => source.releaseTile(stray)).not.toThrow();
    });

    test('tolerates null, which Google Maps can pass', () => {
      expect(() => source.releaseTile(null)).not.toThrow();
    });

    test('keeps shared state while another copy of the tile is still mounted', () => {
      // The same tile id is mounted twice at low zoom, where the world repeats.
      const a = source.getTile(point(1, 1), 10, document);
      const b = source.getTile(point(1, 1), 10, document);
      expect(a).not.toBe(b);

      source.releaseTile(a);
      expect(Object.keys((source as any)._visibleTiles)).toContain('10:1:1');

      source.releaseTile(b);
      expect(Object.keys((source as any)._visibleTiles)).not.toContain('10:1:1');
    });
  });

  describe('drawTile', () => {
    test('returns a distinct canvas per call for the same tile', () => {
      // A DOM node lives in one place: handing the same canvas back a second
      // time detached it from the first mount and blanked that tile.
      const first = source.getTile(point(2, 3), 10, document);
      const second = source.getTile(point(2, 3), 10, document);

      expect(first).not.toBe(second);
      expect(first).toBeInstanceOf(HTMLCanvasElement);
      expect(second).toBeInstanceOf(HTMLCanvasElement);
    });
  });

  describe('tile cache', () => {
    test('caches the decoded tile, not the canvas, and skips the refetch', () => {
      const cached = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', cache: true });
      const decoded = { layers: {} } as any;
      (cached as any)._tilesDrawn['10:4:4'] = decoded;
      jest.spyOn(cached as any, '_drawVectorTile').mockImplementation(() => {});

      const before = fetchMock.mock.calls.length;
      const node = cached.getTile(point(4, 4), 10, document);

      expect(fetchMock.mock.calls.length).toBe(before);
      expect(node).toBeInstanceOf(HTMLCanvasElement);
      cached.dispose();
    });

    test('a cached entry holds no canvas reference', () => {
      const cached = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf', cache: true });
      const tileContext = {
        id: '10:5:5',
        canvas: document.createElement('canvas'),
        zoom: 10,
        tileSize: 256,
        vectorTile: { layers: {} } as any,
      };
      (cached as any)._setTileDrawn(tileContext);

      const entry = (cached as any)._tilesDrawn['10:5:5'];
      expect(entry).toBe(tileContext.vectorTile);
      expect(entry.canvas).toBeUndefined();
      cached.dispose();
    });
  });

  describe('tileLoaded', () => {
    test('resolves false on timeout rather than hanging forever', async () => {
      source.getTile(point(1, 1), 10, document);

      // Previously this never settled: loadedTilesLen was only ever assigned
      // 0, so the resolve condition was unsatisfiable and the poll recursed
      // indefinitely.
      await expect(source.tileLoaded(60)).resolves.toBe(false);
    });

    test('resolves true once every visible tile has settled', async () => {
      source.getTile(point(1, 1), 10, document);
      (source as any)._markTileLoaded('10:1:1');

      await expect(source.tileLoaded(1000)).resolves.toBe(true);
    });

    test('reports progress through loadedTilesLen', () => {
      expect(source.loadedTilesLen).toBe(0);
      source.getTile(point(1, 1), 10, document);
      (source as any)._markTileLoaded('10:1:1');
      expect(source.loadedTilesLen).toBe(1);
    });
  });

  describe('dispose', () => {
    test('aborts every in-flight tile request', () => {
      source.getTile(point(1, 1), 10, document);
      source.getTile(point(2, 2), 10, document);

      const signals = fetchMock.mock.calls.map((c: any[]) => (c[1] as RequestInit).signal!);
      expect(signals.every((s) => !s.aborted)).toBe(true);

      source.dispose();
      expect(signals.every((s) => s.aborted)).toBe(true);
    });

    test('is idempotent', () => {
      source.dispose();
      expect(() => source.dispose()).not.toThrow();
    });

    test('a late response cannot revive a disposed source', async () => {
      let resolveFetch: (r: unknown) => void = () => {};
      global.fetch = jest.fn(
        () =>
          new Promise((res) => {
            resolveFetch = res;
          }),
      ) as any;

      const late = new MVTSource(map, { url: 'https://example.com/{z}/{x}/{y}.pbf' });
      late.getTile(point(1, 1), 10, document);
      late.dispose();

      resolveFetch({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });
      await Promise.resolve();
      await Promise.resolve();

      // The whole point: no layers re-created, no tiles re-registered.
      expect(Object.keys(late.mVTLayers)).toHaveLength(0);
      expect(Object.keys((late as any)._tilesDrawn)).toHaveLength(0);
    });
  });

  describe('selection state', () => {
    test('survives a feature being unregistered when its tile is released', () => {
      source.setSelectedFeatures(['feature-a']);
      expect(source.isFeatureSelected('feature-a')).toBe(true);

      // Releasing a tile disposes off-screen features, which unregisters them.
      // Selection is source-level state and must not be dropped with them.
      source.unregisterFeature('feature-a');
      expect(source.isFeatureSelected('feature-a')).toBe(true);
    });

    test('clears hover when the feature is unregistered', () => {
      (source as any)._hoveredFeatureIds.add('feature-b');
      source.unregisterFeature('feature-b');
      expect(source.isFeatureHovered('feature-b')).toBe(false);
    });
  });

  describe('setUrl', () => {
    test('drops cached tiles so stale ones are not re-served', () => {
      source.getTile(point(1, 1), 10, document);
      (source as any)._tilesDrawn['10:1:1'] = { id: '10:1:1' };

      source.setUrl('https://other.example.com/{z}/{x}/{y}.pbf', false);

      expect(Object.keys((source as any)._tilesDrawn)).toHaveLength(0);
      expect(source.loadedTilesLen).toBe(0);
    });

    test('aborts requests aimed at the previous url', () => {
      source.getTile(point(1, 1), 10, document);
      const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;

      source.setUrl('https://other.example.com/{z}/{x}/{y}.pbf', false);
      expect(signal.aborted).toBe(true);
    });
  });

  describe('fractional zoom', () => {
    test('accepts a response while the map reports a fractional zoom', () => {
      // Vector basemaps report fractional zoom during smooth zoom; comparing
      // it directly against the integer tile zoom discarded every response.
      map.getZoom.mockReturnValue(10.4);
      const tileContext = { id: '10:1:1', zoom: 10, canvas: document.createElement('canvas'), tileSize: 256 };

      const drawSpy = jest.spyOn(source as any, '_drawVectorTile').mockImplementation(() => {});
      jest.spyOn(source as any, '_parseVectorTileGeometries').mockImplementation(() => {});

      (source as any)._onTileResponse(tileContext, new ArrayBuffer(8));
      expect(drawSpy).toHaveBeenCalled();
    });

    test('still discards a response for a genuinely different zoom', () => {
      map.getZoom.mockReturnValue(12);
      const tileContext = { id: '10:1:1', zoom: 10, canvas: document.createElement('canvas'), tileSize: 256 };

      const drawSpy = jest.spyOn(source as any, '_drawVectorTile').mockImplementation(() => {});
      (source as any)._onTileResponse(tileContext, new ArrayBuffer(8));
      expect(drawSpy).not.toHaveBeenCalled();
    });
  });
});
