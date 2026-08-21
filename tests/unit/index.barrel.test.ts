// Everything the package exports beyond the three classes was untested and,
// until this phase, not even measured: index.ts was excluded from coverage
// collection. A single tileLoaded() test would have caught C3 immediately.

jest.mock('@mapbox/vector-tile', () => ({
  VectorTile: jest.fn(),
  VectorTileFeature: jest.fn(),
}));
jest.mock('pbf', () => jest.fn());

import {
  MVTSource,
  MVTLayer,
  MVTFeature,
  Mercator,
  ColorUtils,
  DebugLogger,
  debugLogger,
  createLogger,
  GeometryType,
  MVTError,
  MVTOptionsError,
  createMVTSource,
  DefaultStyles,
  AccessiblePalette,
  ManifestUtils,
  MVTUtils,
  MVTFactory,
} from '../../index';

const makeMap = (): any => ({
  overlayMapTypes: { getArray: () => [], removeAt: jest.fn(), push: jest.fn(), insertAt: jest.fn() },
  data: {
    addListener: () => ({ remove: jest.fn() }),
    remove: jest.fn(),
    addGeoJson: () => [],
    overrideStyle: jest.fn(),
  },
  addListener: () => ({ remove: jest.fn() }),
  setOptions: jest.fn(),
  getZoom: () => 10,
  getBounds: () => undefined,
  getProjection: () => undefined,
});

const vectorFeature = (properties: Record<string, unknown> = {}, id?: string | number): any => ({
  id,
  type: 3,
  extent: 4096,
  properties,
  loadGeometry: () => [],
});

describe('package barrel', () => {
  test('exports every documented value', () => {
    for (const [name, value] of Object.entries({
      MVTSource,
      MVTLayer,
      MVTFeature,
      Mercator,
      ColorUtils,
      DebugLogger,
      debugLogger,
      createLogger,
      GeometryType,
      MVTError,
      MVTOptionsError,
      createMVTSource,
      DefaultStyles,
      AccessiblePalette,
      ManifestUtils,
      MVTUtils,
      MVTFactory,
    })) {
      expect(value).toBeDefined();
      expect(name).toBeTruthy();
    }
  });

  test('GeometryType matches the MVT spec values', () => {
    expect(GeometryType.Point).toBe(1);
    expect(GeometryType.LineString).toBe(2);
    expect(GeometryType.Polygon).toBe(3);
  });
});

describe('createMVTSource', () => {
  let source: MVTSource | undefined;

  afterEach(() => {
    source?.dispose();
    source = undefined;
  });

  test('applies its defaults', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as any;
    source = createMVTSource(makeMap(), 'https://tiles.test/{z}/{x}/{y}.pbf');

    expect(source).toBeInstanceOf(MVTSource);
    expect(source.getUrl()).toBe('https://tiles.test/{z}/{x}/{y}.pbf');
    expect(source.getStats().debug).toBe(false);
  });

  test('lets options override the defaults', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as any;
    source = createMVTSource(makeMap(), 'https://tiles.test/{z}/{x}/{y}.pbf', { tileSize: 512, minZoom: 3 });

    expect(source.minZoom).toBe(3);
  });

  test('still validates, so a bad url throws here too', () => {
    expect(() => createMVTSource(makeMap(), 'not-a-template')).toThrow(MVTOptionsError);
  });
});

describe('DefaultStyles', () => {
  test('every preset returns a usable style', () => {
    for (const preset of [
      DefaultStyles.basic,
      DefaultStyles.minimal,
      DefaultStyles.highContrast,
      DefaultStyles.accessible,
      DefaultStyles.dark,
    ]) {
      const style = preset();
      expect(typeof style).toBe('object');
      expect(style.lineWidth).toBeGreaterThan(0);
    }
  });

  test('returns a fresh object each call, so callers cannot corrupt the preset', () => {
    const first = DefaultStyles.basic();
    first.fillStyle = 'mutated';

    expect(DefaultStyles.basic().fillStyle).not.toBe('mutated');
  });

  test('the accessible presets signal selection by width as well as colour', () => {
    // Blue vs vermillion is 1.34:1 in luminance, so hue alone would vanish in
    // greyscale. The width step is what actually carries the state.
    for (const preset of [DefaultStyles.accessible(), DefaultStyles.dark()]) {
      expect(preset.selected?.lineWidth).toBeGreaterThan(preset.lineWidth!);
      expect(preset.hover?.lineWidth).toBeGreaterThan(preset.lineWidth!);
    }
  });

  test('geometry-specific selection styles exist for all three types', () => {
    expect(DefaultStyles.selected.polygon().lineWidth).toBeGreaterThan(0);
    expect(DefaultStyles.selected.point().radius).toBeGreaterThan(0);
    expect(DefaultStyles.selected.line().lineWidth).toBeGreaterThan(0);
  });

  test('AccessiblePalette carries the full Okabe-Ito set as hex', () => {
    const colours = Object.values(AccessiblePalette);
    expect(colours).toHaveLength(8);
    expect(colours.every((c) => /^#[0-9A-F]{6}$/i.test(c))).toBe(true);
    expect(new Set(colours).size).toBe(8);
  });
});

describe('MVTUtils.extractFeatureId', () => {
  test('prefers the feature id', () => {
    expect(MVTUtils.extractFeatureId(vectorFeature({ fid: 'ignored' }, 42))).toBe(42);
  });

  test('falls back to the configured property', () => {
    expect(MVTUtils.extractFeatureId(vectorFeature({ custom: 'abc' }), 'custom')).toBe('abc');
  });

  test('then to the common id properties, in order', () => {
    expect(MVTUtils.extractFeatureId(vectorFeature({ objectid: 7 }))).toBe(7);
    expect(MVTUtils.extractFeatureId(vectorFeature({ gid: 'g1' }))).toBe('g1');
  });

  test('ignores a boolean, which is never a usable id', () => {
    const id = MVTUtils.extractFeatureId(vectorFeature({ fid: true, name: 'x' }));
    expect(id).toEqual(expect.stringContaining('generated_'));
  });

  test('generates a stable hash when nothing usable is present', () => {
    const props = { name: 'Somewhere', category: 'A' };
    const first = MVTUtils.extractFeatureId(vectorFeature(props));
    const second = MVTUtils.extractFeatureId(vectorFeature({ ...props }));

    expect(first).toEqual(expect.stringContaining('generated_'));
    expect(second).toBe(first);
  });

  test('different properties hash differently', () => {
    const a = MVTUtils.extractFeatureId(vectorFeature({ name: 'A' }));
    const b = MVTUtils.extractFeatureId(vectorFeature({ name: 'B' }));

    expect(a).not.toBe(b);
  });
});

describe('MVTUtils filters and styles', () => {
  test('createPropertyFilter keeps only matching values', () => {
    const filter = MVTUtils.createPropertyFilter('category', ['A', 'B']);

    expect(filter(vectorFeature({ category: 'A' }))).toBe(true);
    expect(filter(vectorFeature({ category: 'C' }))).toBe(false);
    expect(filter(vectorFeature({}))).toBe(false);
  });

  test('createPropertyFilter matches numbers too', () => {
    const filter = MVTUtils.createPropertyFilter('level', [1, 2]);

    expect(filter(vectorFeature({ level: 2 }))).toBe(true);
    expect(filter(vectorFeature({ level: 3 }))).toBe(false);
  });

  test('createPropertyBasedStyle maps values to styles', () => {
    const style = MVTUtils.createPropertyBasedStyle('type', {
      residential: { fillStyle: 'yellow' },
      commercial: { fillStyle: 'blue' },
    });

    expect(style(vectorFeature({ type: 'residential' })).fillStyle).toBe('yellow');
    expect(style(vectorFeature({ type: 'commercial' })).fillStyle).toBe('blue');
  });

  test('createPropertyBasedStyle falls back for unmapped and missing values', () => {
    const style = MVTUtils.createPropertyBasedStyle('type', { a: { fillStyle: 'red' } });
    const fallback = DefaultStyles.basic();

    expect(style(vectorFeature({ type: 'unmapped' }))).toEqual(fallback);
    expect(style(vectorFeature({}))).toEqual(fallback);
  });
});

describe('MVTFactory', () => {
  test('createHighPerformanceConfig produces a valid, usable config', () => {
    const config = MVTFactory.createHighPerformanceConfig('https://tiles.test/{z}/{x}/{y}.pbf');

    expect(config.cache).toBe(true);
    expect(config.debug).toBe(false);
    expect(config.url).toContain('{z}');

    global.fetch = jest.fn(() => new Promise(() => {})) as any;
    const source = new MVTSource(makeMap(), config);
    expect(source).toBeInstanceOf(MVTSource);
    source.dispose();
  });

  test('options override the factory defaults', () => {
    const config = MVTFactory.createHighPerformanceConfig('https://tiles.test/{z}/{x}/{y}.pbf', { debug: true });
    expect(config.debug).toBe(true);
  });

  test('the French administrative config is gone', () => {
    // It hardcoded communes/departments/iris/postal_code in a library that is
    // not about France. Removed in 1.0; see MIGRATION.md.
    expect((MVTFactory as Record<string, unknown>).createAdministrativeConfig).toBeUndefined();
  });
});

describe('ManifestUtils.validateManifest', () => {
  test('accepts a well-formed manifest', () => {
    expect(ManifestUtils.validateManifest({ '10': { '1': [[0, 5]] } })).toBe(true);
    expect(ManifestUtils.validateManifest({})).toBe(true);
  });

  test('rejects non-objects', () => {
    for (const bad of [null, undefined, 'string', 42, true]) {
      expect(ManifestUtils.validateManifest(bad)).toBe(false);
    }
  });

  test('rejects a non-numeric zoom or x key', () => {
    expect(ManifestUtils.validateManifest({ ten: { '1': [[0, 5]] } })).toBe(false);
    expect(ManifestUtils.validateManifest({ '10': { one: [[0, 5]] } })).toBe(false);
  });

  test('rejects malformed y ranges', () => {
    expect(ManifestUtils.validateManifest({ '10': { '1': 'nope' } })).toBe(false);
    expect(ManifestUtils.validateManifest({ '10': { '1': [[0]] } })).toBe(false);
    expect(ManifestUtils.validateManifest({ '10': { '1': [[0, 5, 9]] } })).toBe(false);
    expect(ManifestUtils.validateManifest({ '10': { '1': [['a', 'b']] } })).toBe(false);
  });
});

describe('ManifestUtils.createManifestFetcher', () => {
  test('fetches and returns the manifest json', async () => {
    const manifest = { '10': { '1': [[0, 5]] } };
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(manifest) }),
    ) as any;

    const fetcher = ManifestUtils.createManifestFetcher('https://api.test/manifest');

    await expect(fetcher()).resolves.toEqual(manifest);
    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('GET');
  });

  test('merges custom headers over the default content type', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({}) }),
    ) as any;

    await ManifestUtils.createManifestFetcher('https://api.test/manifest', { Authorization: 'Bearer x' })();

    expect((global.fetch as jest.Mock).mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer x',
    });
  });

  test('throws with the status when the request fails', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable', json: () => Promise.resolve({}) }),
    ) as any;

    await expect(ManifestUtils.createManifestFetcher('https://api.test/manifest')()).rejects.toThrow(/503/);
  });
});
