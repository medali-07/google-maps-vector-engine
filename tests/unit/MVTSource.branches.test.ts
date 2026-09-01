// The remaining MVTSource branches: overzoom, the debug overlay, cache
// eviction, manifest plumbing, and the error and edge paths.

import fs from 'fs';
import path from 'path';
import { MVTSource } from '../../src/MVTSource';

const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.pbf'));
const URL = 'https://tiles.test/{z}/{x}/{y}.pbf';

const latLng = (lat: number, lng: number): any => ({ lat: () => lat, lng: () => lng });

const makeMap = (zoom = 10): any => ({
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
  getZoom: () => zoom,
  getBounds: () => ({ getNorthEast: () => latLng(85, 180), getSouthWest: () => latLng(-85, -180) }),
  getProjection: () => ({ fromLatLngToPoint: () => ({ x: 128, y: 128 }) }),
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

describe('MVTSource branches', () => {
  let source: MVTSource | undefined;

  beforeEach(() => {
    global.fetch = respondWithFixture() as any;
  });

  afterEach(() => {
    source?.dispose();
    source = undefined;
  });

  describe('overzoom', () => {
    test('requests the parent tile past sourceMaxZoom', () => {
      source = new MVTSource(makeMap(12), { url: URL, sourceMaxZoom: 10 });

      source.getTile(point(4, 8), 12, document);

      // Two zoom levels deep, so x and y are shifted right by two.
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://tiles.test/10/1/2.pbf');
    });

    test('records the parent on the tile context so drawing can offset it', () => {
      source = new MVTSource(makeMap(12), { url: URL, sourceMaxZoom: 10 });

      source.getTile(point(4, 8), 12, document);

      expect((source as any)._visibleTiles['12:4:8'].parentId).toBe('10:1:2');
    });

    test('leaves tiles at or below sourceMaxZoom alone', () => {
      source = new MVTSource(makeMap(10), { url: URL, sourceMaxZoom: 10 });

      source.getTile(point(1, 2), 10, document);

      expect((source as any)._visibleTiles['10:1:2'].parentId).toBeUndefined();
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://tiles.test/10/1/2.pbf');
    });

    test('no sourceMaxZoom means no parent at any zoom', () => {
      source = new MVTSource(makeMap(18), { url: URL });

      source.getTile(point(1, 2), 18, document);

      expect((source as any)._visibleTiles['18:1:2'].parentId).toBeUndefined();
    });
  });

  describe('debug overlay', () => {
    test('draws the tile grid and label when debug is on', async () => {
      source = new MVTSource(makeMap(), { url: URL, debug: true });
      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;
      const context = tile.getContext('2d') as any;
      await flush();

      expect(context.strokeRect).toHaveBeenCalled();
      expect(context.fillText).toHaveBeenCalledWith('10 1 2', expect.any(Number), expect.any(Number));
    });

    test('draws nothing extra when debug is off', async () => {
      source = new MVTSource(makeMap(), { url: URL });
      const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;
      const context = tile.getContext('2d') as any;
      await flush();

      expect(context.strokeRect).not.toHaveBeenCalled();
    });
  });

  describe('tile cache', () => {
    test('evicts oldest entries past the cache limit', async () => {
      source = new MVTSource(makeMap(), { url: URL, cache: true });

      // MAX_TILES_CACHE_SIZE is 100.
      for (let i = 0; i < 105; i++) {
        source.getTile(point(i, 0), 10, document);
      }
      await flush();

      expect(source.getStats().cachedTiles).toBeLessThanOrEqual(100);
    });

    test('cache off keeps nothing', async () => {
      source = new MVTSource(makeMap(), { url: URL, cache: false });

      source.getTile(point(1, 2), 10, document);
      await flush();

      expect(source.getStats().cachedTiles).toBe(0);
    });

    test('deleteTileDrawn evicts one entry', async () => {
      source = new MVTSource(makeMap(), { url: URL, cache: true });
      source.getTile(point(1, 2), 10, document);
      await flush();

      source.deleteTileDrawn('10:1:2');

      expect(source.getStats().cachedTiles).toBe(0);
    });
  });

  describe('releaseTile', () => {
    test('ignores a node it never handed out', () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(1, 2), 10, document);

      expect(() => source!.releaseTile(document.createElement('canvas'))).not.toThrow();
      expect(source.getStats().visibleTiles).toBe(1);
    });

    test('tolerates null, which Google Maps can pass', () => {
      source = new MVTSource(makeMap(), { url: URL });

      expect(() => source!.releaseTile(null)).not.toThrow();
      expect(() => source!.releaseTile(undefined)).not.toThrow();
    });

    test('keeps the tile while another copy is still mounted', () => {
      // The world repeats horizontally at low zoom, so the same tile id can be
      // mounted more than once.
      source = new MVTSource(makeMap(3), { url: URL });
      const first = source.getTile(point(1, 2), 3, document);
      source.getTile(point(9, 2), 3, document);

      source.releaseTile(first as Element);

      expect(source.getStats().visibleTiles).toBe(1);
    });
  });

  describe('manifest plumbing', () => {
    test('setTileAvailabilityManifest filters later requests', async () => {
      source = new MVTSource(makeMap(), { url: URL });

      await source.setTileAvailabilityManifest({ '10': { '1': [[0, 5]] } });

      expect(source.getTileAvailabilityManifest()).toEqual({ '10': { '1': [[0, 5]] } });
    });

    test('refreshManifest re-runs a manifest function', async () => {
      const fetcher = jest.fn(() => Promise.resolve({ '10': { '1': [[0, 5] as [number, number]] } }));
      source = new MVTSource(makeMap(), { url: URL, tileAvailabilityManifest: fetcher });
      await flush();
      const before = fetcher.mock.calls.length;

      await source.refreshManifest();

      expect(fetcher.mock.calls.length).toBe(before + 1);
    });

    test('an unavailable tile emits tileerror and is not requested', async () => {
      source = new MVTSource(makeMap(), {
        url: URL,
        tileAvailabilityManifest: { '10': { '1': [[0, 5]] } },
      });
      await flush();
      (global.fetch as jest.Mock).mockClear();
      const errors = jest.fn();
      source.on('tileerror', errors);

      source.getTile(point(1, 99), 10, document);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith(expect.objectContaining({ tileId: '10:1:99' }));
    });
  });

  describe('tileLoaded', () => {
    test('resolves true straight away when everything has already settled', async () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(1, 2), 10, document);
      await flush();

      await expect(source.tileLoaded(1000)).resolves.toBe(true);
    });

    test('resolves false rather than hanging when nothing ever settles', async () => {
      global.fetch = jest.fn(() => new Promise(() => {})) as any;
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(1, 2), 10, document);

      await expect(source.tileLoaded(150)).resolves.toBe(false);
    });

    test('resolves false with no visible tiles at all', async () => {
      source = new MVTSource(makeMap(), { url: URL });

      await expect(source.tileLoaded(150)).resolves.toBe(false);
    });

    test('resolves false once the source is disposed mid-wait', async () => {
      global.fetch = jest.fn(() => new Promise(() => {})) as any;
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(1, 2), 10, document);

      const pending = source.tileLoaded(5000);
      source.dispose();
      const result = await pending;
      source = undefined;

      expect(result).toBe(false);
    });
  });

  describe('fitBounds', () => {
    test('moves the map to a loaded feature', async () => {
      const map = makeMap(0);
      source = new MVTSource(map, { url: URL });
      source.getTile(point(0, 0), 0, document);
      await flush();

      expect(source.fitBounds(1)).toBe(true);
      expect(map.fitBounds).toHaveBeenCalled();
    });

    test('passes padding through', async () => {
      const map = makeMap(0);
      source = new MVTSource(map, { url: URL });
      source.getTile(point(0, 0), 0, document);
      await flush();

      source.fitBounds(1, 40);

      expect(map.fitBounds).toHaveBeenCalledWith(expect.anything(), 40);
    });

    test('getFeatureBounds skips tiles that are no longer visible', async () => {
      source = new MVTSource(makeMap(0), { url: URL });
      const node = source.getTile(point(0, 0), 0, document);
      await flush();
      source.releaseTile(node as Element);

      expect(source.getFeatureBounds(1)).toBeUndefined();
    });
  });

  describe('dispose', () => {
    test('is safe to call twice', () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.dispose();

      expect(() => source!.dispose()).not.toThrow();
      source = undefined;
    });

    test('survives a map that throws while removing the overlay', () => {
      const map = makeMap();
      map.overlayMapTypes.getArray = () => {
        throw new Error('detached');
      };
      source = new MVTSource(map, { url: URL });

      expect(() => source!.dispose()).not.toThrow();
      source = undefined;
    });

    test('drops the feature index and layers', async () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(1, 2), 10, document);
      await flush();
      expect(source.getStats().features).toBeGreaterThan(0);

      source.dispose();
      const stats = source.getStats();
      source = undefined;

      expect(stats.features).toBe(0);
      expect(stats.layers).toBe(0);
    });
  });

  describe('tile ids', () => {
    test('round-trip through getTileId and getTileObject', () => {
      source = new MVTSource(makeMap(), { url: URL });

      expect(source.getTileObject(source.getTileId(10, 5, 7))).toEqual({ z: 10, x: 5, y: 7 });
    });

    test('a malformed id is rejected rather than yielding NaN', () => {
      source = new MVTSource(makeMap(), { url: URL });

      expect(() => source!.getTileObject('nonsense')).toThrow(/Malformed tile id/);
      expect(() => source!.getTileObject('10:x:2')).toThrow(/Malformed tile id/);
    });
  });

  describe('default feature ids', () => {
    test('a feature without an id gets a stable hash, not a random one', () => {
      // Math.random() gave the same feature a different id on every parse, so
      // it could never be merged across tiles or keep its selection.
      const noIdFixture = {
        id: undefined,
        type: 3,
        extent: 4096,
        properties: { name: 'Nameless' },
        loadGeometry: () => [[{ x: 0, y: 0 }]],
      };
      source = new MVTSource(makeMap(), { url: URL });

      const first = (source as any).defaultGetIDForLayerFeature(noIdFixture);
      const second = (source as any).defaultGetIDForLayerFeature({ ...noIdFixture });

      expect(first).toEqual(expect.stringContaining('feature_'));
      expect(second).toBe(first);
    });

    test('prefers the tile feature id over the properties', () => {
      source = new MVTSource(makeMap(), { url: URL });

      const id = (source as any).defaultGetIDForLayerFeature({
        id: 99,
        properties: { fid: 'ignored', id: 'also-ignored' },
      });

      expect(id).toBe(99);
    });

    test('falls back through the configured and common property names', () => {
      source = new MVTSource(makeMap(), { url: URL, defaultFeatureId: 'code' });

      expect((source as any).defaultGetIDForLayerFeature({ properties: { code: 'C1' } })).toBe('C1');
      expect((source as any).defaultGetIDForLayerFeature({ properties: { ID: 7 } })).toBe(7);
    });

    test('ignores non-scalar property values', () => {
      source = new MVTSource(makeMap(), { url: URL });

      const id = (source as any).defaultGetIDForLayerFeature({ properties: { fid: true, name: 'x' } });

      expect(id).toEqual(expect.stringContaining('feature_'));
    });
  });
});
