// Regression tests for defects found in the final pre-release review:
// falsy feature ids clobbered by the index fallback, same-id multi-part
// features overwriting each other, the idle edge failing to re-arm, the
// setOpacity(0) latch, retries reviving released tiles, stale selection
// callbacks after an await, repaints targeting a released world copy, and
// off() being unable to remove a once() listener.

jest.mock('@mapbox/vector-tile', () => ({
  VectorTile: jest.fn(),
  VectorTileFeature: jest.fn(),
}));

jest.mock('pbf', () => jest.fn());

import { MVTSource } from '../../src/MVTSource';
import { MVTLayer } from '../../src/MVTLayer';
import { EventEmitter } from '../../src/events/EventEmitter';
import { TileLoader, TileLoaderCallbacks } from '../../src/tiles/TileLoader';
import { GeometryType, MVTLayerOptions, TileContext } from '../../src/types';
import { createMockTileContext, createMockMVTSource, createMockCanvasContext } from '../utils/mockData';

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
  getZoom: jest.fn(() => zoom),
  getBounds: jest.fn(() => undefined),
  getProjection: jest.fn(() => undefined),
});

const point = (x: number, y: number): any => ({ x, y });

const vtFeature = (id: string | number, type = GeometryType.Polygon, ring?: { x: number; y: number }[]): any => ({
  id,
  type,
  extent: 256,
  properties: {},
  loadGeometry: () => [
    ring ?? [
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 110 },
    ],
  ],
});

const makeLayer = (overrides: Partial<MVTLayerOptions> = {}): MVTLayer =>
  new MVTLayer({
    name: 'layer',
    getIDForLayerFeature: (f: any) => f.id,
    filter: false,
    style: { fillStyle: 'red' },
    customDraw: false,
    ...overrides,
  } as MVTLayerOptions);

describe('EventEmitter: off after once', () => {
  test('off removes a listener that was registered via once', () => {
    const emitter = new EventEmitter<{ ping: void }>();
    const listener = jest.fn();

    emitter.once('ping', listener);
    // The set stores the once-wrapper, not the caller's function; off must
    // still find and remove it.
    emitter.off('ping', listener);
    emitter.emit('ping', undefined);

    expect(listener).not.toHaveBeenCalled();
    expect(emitter.listenerCount('ping')).toBe(0);
  });
});

describe('TileLoader: released tiles stay released', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('abort() cancels a pending retry, so a released tile is not re-fetched', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(() => Promise.reject(new Error('network down')));
    global.fetch = fetchMock as any;
    const callbacks: TileLoaderCallbacks = {
      onResponse: jest.fn(),
      onSettled: jest.fn(),
      onFailed: jest.fn(),
      isDisposed: () => false,
    };
    const loader = new TileLoader(URL, {}, callbacks);
    const ctx: TileContext = { id: '10:1:2', canvas: document.createElement('canvas'), zoom: 10, tileSize: 256 };

    loader.fetch(ctx, { z: 10, x: 1, y: 2 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Google Maps releases the tile during the retry backoff. The armed retry
    // used to fire anyway and rebuild the whole tile's state.
    loader.abort('10:1:2');
    jest.advanceTimersByTime(120000);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('MVTLayer: feature identity', () => {
  let source: any;
  let tileContext: any;

  beforeEach(() => {
    source = createMockMVTSource();
    source.getStyleForFeature = undefined;
    tileContext = createMockTileContext();
    jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
  });

  test('feature id 0 survives instead of being replaced by the array index', () => {
    const layer = makeLayer();

    // Placed at index 1 so the falsy fallback would have renamed it to 1.
    layer.parseVectorTileFeatures(source, [vtFeature('a'), vtFeature(0)], tileContext);

    expect((layer as any)._mVTFeatures[0]).toBeDefined();
    expect((layer as any)._mVTFeatures[1]).toBeUndefined();
  });

  test('feature id 0 keeps one identity across tiles', () => {
    const layer = makeLayer();
    layer.parseVectorTileFeatures(source, [vtFeature('a'), vtFeature(0)], tileContext);
    const first = (layer as any)._mVTFeatures[0];

    const second = createMockTileContext({ id: 'tile-2' });
    jest.spyOn(second.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
    // Different index in the second tile; the identity must not change.
    layer.parseVectorTileFeatures(source, [vtFeature(0)], second);

    expect((layer as any)._mVTFeatures[0]).toBe(first);
    expect(Object.keys(first.getTiles())).toHaveLength(2);
  });
});

describe('MVTLayer: multi-part features in one tile', () => {
  let source: any;
  let tileContext: any;

  const partA = (): any =>
    vtFeature('road', GeometryType.LineString, [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
    ]);
  const partB = (): any =>
    vtFeature('road', GeometryType.LineString, [
      { x: 200, y: 200 },
      { x: 250, y: 250 },
    ]);

  beforeEach(() => {
    source = createMockMVTSource();
    source.getStyleForFeature = undefined;
    tileContext = createMockTileContext();
    jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
  });

  test('a second same-id feature becomes an additional part, not a replacement', () => {
    const layer = makeLayer();

    layer.parseVectorTileFeatures(source, [partA(), partB()], tileContext);

    const feature = (layer as any)._mVTFeatures.road;
    // Both parts contribute geometry: the second used to overwrite the first,
    // so only the last part was drawn and hit-tested.
    expect(feature.getPaths(tileContext)).toHaveLength(2);
    // The feature itself appears once in the tile's draw list.
    expect((layer as any)._canvasAndMVTFeatures[tileContext.id].features).toHaveLength(1);
  });

  test('every part is drawn', () => {
    const customDraw = jest.fn();
    const layer = makeLayer({ customDraw });
    const a = partA();
    const b = partB();

    layer.parseVectorTileFeatures(source, [a, b], tileContext);

    const drawn = customDraw.mock.calls.map((call) => call[1].vectorTileFeature);
    expect(drawn).toContain(a);
    expect(drawn).toContain(b);
  });

  test('re-parsing the same tile resets parts instead of accumulating them', () => {
    const layer = makeLayer();

    layer.parseVectorTileFeatures(source, [partA(), partB()], tileContext);
    layer.parseVectorTileFeatures(source, [partA(), partB()], tileContext);

    const feature = (layer as any)._mVTFeatures.road;
    expect(feature.getPaths(tileContext)).toHaveLength(2);
  });
});

describe('MVTSource: idle edge and loaded-tile bookkeeping', () => {
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

  test('idle re-fires when a pan reveals a new tile, with no manual poke', () => {
    source = new MVTSource(map, { url: URL });
    const idle = jest.fn();
    source.on('idle', idle);

    source.getTile(point(1, 2), 10, document);
    (source as any)._markTileLoaded('10:1:2');
    expect(idle).toHaveBeenCalledTimes(1);

    // Requesting a tile must itself mark the source busy. Nothing used to,
    // so this second cycle produced no idle event at all.
    source.getTile(point(3, 4), 10, document);
    (source as any)._markTileLoaded('10:3:4');

    expect(idle).toHaveBeenCalledTimes(2);
  });

  test('a released tile no longer counts as loaded when re-requested', async () => {
    source = new MVTSource(map, { url: URL, cache: false });
    const el = source.getTile(point(1, 2), 10, document);
    (source as any)._markTileLoaded('10:1:2');
    await expect(source.tileLoaded(50)).resolves.toBe(true);

    source.releaseTile(el);
    source.getTile(point(1, 2), 10, document);

    // The tile is being fetched again; its stale "loaded" mark used to make
    // tileLoaded() report true over a blank tile.
    await expect(source.tileLoaded(50)).resolves.toBe(false);
  });

  test('a tile served from cache counts as loaded on remount', () => {
    source = new MVTSource(map, { url: URL, cache: true });
    (source as any)._tilesDrawn['10:1:2'] = { layers: {} };
    const idle = jest.fn();
    source.on('idle', idle);

    source.getTile(point(1, 2), 10, document);

    expect(idle).toHaveBeenCalledTimes(1);
  });
});

describe('MVTSource: opacity', () => {
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

  test('setOpacity(0) does not permanently latch tiles invisible', () => {
    source = new MVTSource(map, { url: URL, fadeInDuration: 0 });
    const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

    source.setOpacity(0);
    expect(tile.style.opacity).toBe('0');

    // '0' used to be read as "still waiting on the fade-in", so every visible
    // tile was skipped here and stayed invisible until released.
    source.setOpacity(0.8);
    expect(tile.style.opacity).toBe('0.8');
  });

  test('a tile still waiting on its first content stays held at 0', () => {
    source = new MVTSource(map, { url: URL, fadeInDuration: 150 });
    const tile = source.getTile(point(1, 2), 10, document) as HTMLCanvasElement;

    source.setOpacity(0.5);

    expect(tile.style.opacity).toBe('0');
  });
});

describe('MVTSource: repeated world copies', () => {
  let map: any;
  let source: MVTSource | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    map = makeMap(3);
    global.fetch = jest.fn(() => new Promise(() => {})) as any;
  });

  afterEach(() => {
    source?.dispose();
    source = undefined;
  });

  test('releasing one copy of a twice-mounted tile repoints repaints at the survivor', () => {
    source = new MVTSource(map, { url: URL });

    // x=9 wraps to x=1 at zoom 3, so both mounts share the tile id.
    const first = source.getTile(point(1, 2), 3, document);
    const second = source.getTile(point(9, 2), 3, document);
    expect((source as any)._visibleTiles['3:1:2'].canvas).toBe(second);

    // Stand in for the decoded tile the fetch would have attached.
    const decoded = { layers: {} };
    (source as any)._visibleTiles['3:1:2'].vectorTile = decoded;

    source.releaseTile(second);

    // Repaints used to keep drawing into the released canvas while the copy
    // still on screen never updated again.
    expect((source as any)._visibleTiles['3:1:2'].canvas).toBe(first);

    // The decoded tile must survive the repoint: redrawTile() refuses to
    // schedule anything for a context without one, so dropping it here turned
    // every later repaint of this tile into a silent no-op.
    expect((source as any)._visibleTiles['3:1:2'].vectorTile).toBe(decoded);
    const schedule = jest.spyOn((source as any)._redraws, 'schedule');
    source.redrawTile('3:1:2');
    expect(schedule).toHaveBeenCalledWith('3:1:2');
  });
});

describe('MVTSource: stale selection callbacks', () => {
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

  test('a "selected" result arriving after deselection is dropped', async () => {
    const callback = jest.fn();
    source = new MVTSource(map, { url: URL, featureSelectionCallback: callback });

    // The feature is no longer selected by the time the async work resolves -
    // the callback used to fire selected=true anyway, after the deselection.
    await (source as any)._callFeatureSelectionCallback('f1', { properties: {} }, true);

    expect(callback).not.toHaveBeenCalled();
  });

  test('a deselection still reports through the callback', async () => {
    const callback = jest.fn();
    source = new MVTSource(map, { url: URL, featureSelectionCallback: callback });

    await (source as any)._callFeatureSelectionCallback('f1', { properties: {} }, false);

    expect(callback).toHaveBeenCalledWith('f1', expect.anything(), false);
  });

  test('nothing fires after dispose', async () => {
    const callback = jest.fn();
    source = new MVTSource(map, { url: URL, featureSelectionCallback: callback });
    (source as any)._selectedFeatureIds.add('f1');
    source.dispose();

    await (source as any)._callFeatureSelectionCallback('f1', { properties: {} }, true);

    expect(callback).not.toHaveBeenCalled();
    source = undefined;
  });
});
