// Interaction and state paths on MVTSource, exercised against the real tile
// fixture so the hit-test, overlay and redraw code actually runs.

import fs from 'fs';
import path from 'path';
import { MVTSource } from '../../src/MVTSource';

const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.pbf'));
const URL = 'https://tiles.test/{z}/{x}/{y}.pbf';

const latLng = (lat: number, lng: number): any => ({ lat: () => lat, lng: () => lng });

interface MapHandles {
  map: any;
  listeners: Map<string, (...args: any[]) => void>;
  dataListeners: Map<string, (...args: any[]) => void>;
  addedGeoJson: any[];
  removedOverlays: any[];
}

const makeMap = (zoom = 10): MapHandles => {
  const listeners = new Map<string, (...args: any[]) => void>();
  const dataListeners = new Map<string, (...args: any[]) => void>();
  const addedGeoJson: any[] = [];
  const removedOverlays: any[] = [];

  const map = {
    overlayMapTypes: { getArray: () => [], removeAt: jest.fn(), push: jest.fn(), insertAt: jest.fn() },
    data: {
      addListener: (event: string, handler: (...args: any[]) => void) => {
        dataListeners.set(event, handler);
        return { remove: jest.fn() };
      },
      remove: (overlay: any) => removedOverlays.push(overlay),
      addGeoJson: (geojson: any) => {
        addedGeoJson.push(geojson);
        return [{ id: geojson.id, setProperty: jest.fn(), getProperty: jest.fn() }];
      },
      overrideStyle: jest.fn(),
    },
    addListener: (event: string, handler: (...args: any[]) => void) => {
      listeners.set(event, handler);
      return { remove: jest.fn() };
    },
    setOptions: jest.fn(),
    fitBounds: jest.fn(),
    getZoom: () => zoom,
    getBounds: () => ({ getNorthEast: () => latLng(85, 180), getSouthWest: () => latLng(-85, -180) }),
    getProjection: () => ({ fromLatLngToPoint: () => ({ x: 128, y: 128 }) }),
  };

  return { map, listeners, dataListeners, addedGeoJson, removedOverlays };
};

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

describe('MVTSource interaction', () => {
  let handles: MapHandles;
  let source: MVTSource | undefined;

  beforeEach(() => {
    handles = makeMap();
    global.fetch = respondWithFixture() as any;
  });

  afterEach(() => {
    source?.dispose();
    source = undefined;
  });

  /**
   * Build a source with a tile already decoded.
   *
   * The tile loaded is the one lat/lng 0,0 falls in at zoom 10, so the mouse
   * tests resolve to a tile that actually exists - `_mouseEventContinue`
   * derives the id from the event's latLng and returns early otherwise.
   */
  const TILE_X = 512;
  const TILE_Y = 512;
  const TILE_ID = `10:${TILE_X}:${TILE_Y}`;

  const withTile = async (options: Record<string, unknown> = {}): Promise<MVTSource> => {
    source = new MVTSource(handles.map, { url: URL, ...options } as any);
    source.getTile(point(TILE_X, TILE_Y), 10, document);
    await flush();
    return source;
  };

  describe('hover state', () => {
    test('setting and clearing hover moves features in and out of the hovered set', async () => {
      const s = await withTile();

      (s as any)._setFeatureHover(1, true);
      expect(s.isFeatureHovered(1)).toBe(true);
      expect(s.getStats().hoveredFeatures).toBe(1);

      s.clearAllHoveredFeatures();
      expect(s.isFeatureHovered(1)).toBe(false);
      expect(s.getStats().hoveredFeatures).toBe(0);
    });

    test('clearing hover with nothing hovered is a no-op', async () => {
      const s = await withTile();
      expect(() => s.clearAllHoveredFeatures()).not.toThrow();
    });

    test('hover survives a selection change', async () => {
      const s = await withTile();

      (s as any)._setFeatureHover(1, true);
      s.setSelection([2]);

      expect(s.isFeatureHovered(1)).toBe(true);
      expect(s.isFeatureSelected(2)).toBe(true);
    });
  });

  describe('mouse routing', () => {
    test('a click resolves the feature under the pointer and selects it', async () => {
      // End to end with real geometry: the click is routed to the tile, hit
      // tested against the decoded polygon, and the result selected. Under the
      // old always-true isPointInPath stub this proved nothing.
      const onClick = jest.fn();
      const s = await withTile({ onClick });

      handles.listeners.get('click')!({ latLng: latLng(0, 0) });

      expect(onClick).toHaveBeenCalled();
      const event = onClick.mock.calls[0][0];
      expect(event.feature).toBeDefined();
      expect(s.getSelectedFeatureIds()).toEqual([event.feature.featureId]);
    });

    test('a click outside every loaded tile selects nothing', async () => {
      const onClick = jest.fn();
      const s = await withTile({ onClick });

      // Far from the single tile this source has loaded.
      handles.listeners.get('click')!({ latLng: latLng(60, 120) });

      expect(onClick).toHaveBeenCalled();
      expect(onClick.mock.calls[0][0].feature).toBeUndefined();
      expect(s.getSelectedFeatureIds()).toEqual([]);
    });

    test('a click is ignored when the event carries no latLng', async () => {
      const onClick = jest.fn();
      await withTile({ onClick });

      handles.listeners.get('click')!({});

      expect(onClick).not.toHaveBeenCalled();
    });

    test('the hit test runs across every clickable layer', async () => {
      const s = await withTile();
      const buildings = jest.spyOn(s.mVTLayers.buildings, 'handleClickEvent');
      const roads = jest.spyOn(s.mVTLayers.roads, 'handleClickEvent');

      (s as any)._mouseEventContinue({ latLng: latLng(0, 0), pixel: point(10, 10) }, undefined, { setSelected: true });

      expect(buildings).toHaveBeenCalled();
      expect(roads).toHaveBeenCalled();
    });

    test('limitToFirstVisibleLayer stops at the first layer that hits', async () => {
      const s = await withTile({ limitToFirstVisibleLayer: true });
      const feature = { featureId: 'x' };
      jest.spyOn(s.mVTLayers.roads, 'handleClickEvent').mockImplementation((event: any) => ({ ...event, feature }));
      const buildings = jest.spyOn(s.mVTLayers.buildings, 'handleClickEvent');

      (s as any)._mouseEventContinue({ latLng: latLng(0, 0), pixel: point(10, 10) }, undefined, {
        limitToFirstVisibleLayer: true,
      });

      expect(buildings).not.toHaveBeenCalled();
    });

    test('clickableLayers restricts which layers are consulted', async () => {
      const s = await withTile({ clickableLayers: ['roads'] });
      const buildings = jest.spyOn(s.mVTLayers.buildings, 'handleClickEvent');

      (s as any)._mouseEventContinue({ latLng: latLng(0, 0), pixel: point(10, 10) }, undefined, {});

      expect(buildings).not.toHaveBeenCalled();
    });

    test('toggleSelection deselects a feature that was already selected', async () => {
      const s = await withTile({ toggleSelection: true });

      (s as any)._mouseSelectedFeature({ feature: { featureId: 1 } }, undefined, { setSelected: true });
      expect(s.isFeatureSelected(1)).toBe(true);

      (s as any)._mouseSelectedFeature({ feature: { featureId: 1 } }, undefined, { setSelected: true });
      expect(s.isFeatureSelected(1)).toBe(false);
    });

    test('toggleSelection off keeps a selected feature selected', async () => {
      const s = await withTile({ toggleSelection: false });

      (s as any)._mouseSelectedFeature({ feature: { featureId: 1 } }, undefined, { setSelected: true });
      (s as any)._mouseSelectedFeature({ feature: { featureId: 1 } }, undefined, { setSelected: true });

      expect(s.isFeatureSelected(1)).toBe(true);
    });

    test('setSelected false leaves the selection alone', async () => {
      const s = await withTile();

      (s as any)._mouseSelectedFeature({ feature: { featureId: 1 } }, undefined, { setSelected: false });

      expect(s.isFeatureSelected(1)).toBe(false);
    });

    test('the event carries the resulting selection state', async () => {
      const s = await withTile();
      const event: any = { feature: { featureId: 1 } };

      (s as any)._mouseSelectedFeature(event, undefined, { setSelected: true });

      expect(event.selectionChanged).toBe(true);
      expect(event.isSelected).toBe(true);
    });

    test('single-selection mode replaces rather than accumulating on click', async () => {
      const s = await withTile({ multipleSelection: false });

      (s as any)._selectFeature(1);
      (s as any)._selectFeature(2);

      expect(s.getSelectedFeatureIds()).toEqual([2]);
    });

    test('multipleSelection accumulates on click', async () => {
      const s = await withTile({ multipleSelection: true });

      (s as any)._selectFeature(1);
      (s as any)._selectFeature(2);

      expect(s.getSelectedFeatureIds().sort()).toEqual([1, 2]);
    });
  });

  describe('mutation and redraw', () => {
    test('setStyle re-styles every layer and invalidates the cache', async () => {
      const s = await withTile();

      s.setStyle({ fillStyle: 'lime' }, false);

      expect(s.getStyle()).toEqual({ fillStyle: 'lime' });
      expect(s.mVTLayers.buildings.style).toEqual({ fillStyle: 'lime' });
    });

    test('setFilter pushes the filter down to every layer', async () => {
      const s = await withTile();
      const filter = (): boolean => false;

      s.setFilter(filter, false);

      expect(s.getFilter()).toBe(filter);
    });

    test('setVisibleLayers records what should render', async () => {
      const s = await withTile();

      s.setVisibleLayers(['roads'], false);
      expect(s.getVisibleLayers()).toEqual(['roads']);

      s.setVisibleLayers(undefined, false);
      expect(s.getVisibleLayers()).toBeUndefined();
    });

    test('setUrl drops the cache so stale tiles are not re-served', async () => {
      const s = await withTile({ cache: true });
      expect(s.getStats().cachedTiles).toBe(1);

      s.setUrl('https://other.test/{z}/{x}/{y}.pbf', false);

      expect(s.getStats().cachedTiles).toBe(0);
      expect(s.getStats().loadedTiles).toBe(0);
    });

    test('redrawAllTiles clears the drawn cache', async () => {
      const s = await withTile({ cache: true });

      s.redrawAllTiles();

      expect(s.getStats().cachedTiles).toBe(0);
    });

    test('redrawTile repaints a visible tile from decoded geometry', async () => {
      const s = await withTile();
      const repaint = jest.spyOn(s as any, '_repaintTiles');

      s.redrawTile(TILE_ID);
      (s as any)._redraws.flushNow();

      expect(repaint).toHaveBeenCalledWith([TILE_ID]);
    });

    test('redrawTile is a no-op for an unknown tile', async () => {
      const s = await withTile();
      expect(() => s.redrawTile('99:9:9')).not.toThrow();
    });

    test('a repaint clears the canvas before redrawing', async () => {
      const s = await withTile();
      const clear = jest.spyOn(s, 'clearTile');

      (s as any)._repaintTiles([TILE_ID]);

      expect(clear).toHaveBeenCalled();
    });
  });

  describe('zoom changes', () => {
    test('drop the visible tiles so the new zoom starts clean', async () => {
      const s = await withTile();
      expect(s.getStats().visibleTiles).toBe(1);

      handles.listeners.get('zoom_changed')!();

      expect(s.getStats().visibleTiles).toBe(0);
    });

    test('restore the selection after the deferred window', async () => {
      jest.useFakeTimers();
      try {
        const s = await withTile();
        s.setSelection([1]);

        handles.listeners.get('zoom_changed')!();
        jest.advanceTimersByTime(100);

        expect(s.isFeatureSelected(1)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    test('do not resurrect a selection the user cleared during the window', async () => {
      jest.useFakeTimers();
      try {
        const s = await withTile();
        s.setSelection([1]);

        handles.listeners.get('zoom_changed')!();
        s.setSelection([]);
        jest.advanceTimersByTime(100);

        expect(s.isFeatureSelected(1)).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('GeoJSON overlays', () => {
    const replacement = {
      type: 'Feature' as const,
      id: 1,
      properties: { name: 'Detailed' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    };

    test('a selected feature is replaced by its high-detail overlay', async () => {
      const s = await withTile({ getReplacementFeature: () => replacement });

      s.setSelection([1]);
      await flush();

      expect(handles.addedGeoJson.length).toBeGreaterThan(0);
      expect(s.isFeatureReplaced(1)).toBe(true);
    });

    test('deselecting removes the overlay again', async () => {
      const s = await withTile({ getReplacementFeature: () => replacement });

      s.setSelection([1]);
      await flush();
      s.setSelection([]);
      await flush();

      expect(handles.removedOverlays.length).toBeGreaterThan(0);
      expect(s.isFeatureReplaced(1)).toBe(false);
    });

    test('a replacement returning null falls back to merging the tiles', async () => {
      const s = await withTile({ getReplacementFeature: () => null, featureSelectionCallback: jest.fn() });

      s.setSelection([1]);
      await flush();

      expect(s.isFeatureReplaced(1)).toBe(false);
    });

    test('the selection callback receives GeoJSON for the selected feature', async () => {
      const callback = jest.fn();
      const s = await withTile({ getReplacementFeature: () => replacement, featureSelectionCallback: callback });

      s.setSelection([1]);
      await flush();

      expect(callback).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'Feature' }), true);
    });

    test('a replacement that throws does not break selection', async () => {
      const s = await withTile({
        getReplacementFeature: () => {
          throw new Error('upstream down');
        },
        featureSelectionCallback: jest.fn(),
      });

      s.setSelection([1]);
      await flush();

      expect(s.isFeatureSelected(1)).toBe(true);
    });

    test('dispose removes every overlay it added', async () => {
      const s = await withTile({ getReplacementFeature: () => replacement });
      s.setSelection([1]);
      await flush();
      handles.removedOverlays.length = 0;

      s.dispose();
      source = undefined;

      expect(handles.removedOverlays.length).toBeGreaterThan(0);
    });
  });

  describe('per-tile queries', () => {
    test('getSelectedFeaturesInTile reports only what that tile holds', async () => {
      const s = await withTile();

      s.setSelection([1]);

      expect(s.getSelectedFeaturesInTile(TILE_ID)).toHaveLength(1);
      expect(s.getSelectedFeaturesInTile('99:9:9')).toHaveLength(0);
    });

    test('getFeature finds a decoded feature by id', async () => {
      const s = await withTile();

      expect(s.getFeature(1)).toBeDefined();
      expect(s.getFeature('nope')).toBeUndefined();
    });
  });

  describe('GeoJSON overlay handlers', () => {
    const replacement = {
      type: 'Feature' as const,
      id: 1,
      properties: { name: 'Detailed' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    };

    /** Select feature 1 so its overlay exists, and hand back that overlay. */
    const withOverlay = async (options: Record<string, unknown> = {}): Promise<{ s: MVTSource; overlay: any }> => {
      const s = await withTile({ getReplacementFeature: () => replacement, ...options });
      s.setSelection([1]);
      await flush();
      const overlay = Array.from((s as any)._overlayToFeatureId.keys())[0];
      return { s, overlay };
    };

    test('clicking an overlay deselects the feature it stands for', async () => {
      const { s, overlay } = await withOverlay();
      expect(s.isFeatureSelected(1)).toBe(true);

      handles.dataListeners.get('click')!({ feature: overlay });

      expect(s.isFeatureSelected(1)).toBe(false);
    });

    test('clicking an overlay for an unselected feature selects it', async () => {
      const { s, overlay } = await withOverlay();
      (s as any)._selectedFeatureIds.delete(1);

      handles.dataListeners.get('click')!({ feature: overlay });

      expect(s.isFeatureSelected(1)).toBe(true);
    });

    test('the reverse map preserves a numeric feature id', async () => {
      // Object.entries over the overlay map stringifies keys, so a numeric id
      // came back as "1" and never matched the selection set - clicking to
      // deselect added an unreachable ghost entry instead.
      const { s, overlay } = await withOverlay();

      expect((s as any)._findOverlayFeatureId(overlay)).toBe(1);
      expect(typeof (s as any)._findOverlayFeatureId(overlay)).toBe('number');
    });

    test('an unknown overlay resolves to null and is ignored', async () => {
      const { s } = await withOverlay();

      expect((s as any)._findOverlayFeatureId({})).toBeNull();
      expect((s as any)._findOverlayFeatureId(undefined)).toBeNull();
      expect(() => handles.dataListeners.get('click')!({ feature: {} })).not.toThrow();
    });

    test('a click with no feature is ignored', async () => {
      await withOverlay();

      expect(() => handles.dataListeners.get('click')!({})).not.toThrow();
    });

    test('mouseover and mousemove report the real feature', async () => {
      const onMouseHover = jest.fn();
      const { overlay } = await withOverlay({ onMouseHover });
      onMouseHover.mockClear();

      handles.dataListeners.get('mouseover')!({ feature: overlay, latLng: latLng(1, 2) });
      handles.dataListeners.get('mousemove')!({ feature: overlay, latLng: latLng(1, 2) });

      expect(onMouseHover).toHaveBeenCalledTimes(2);
      const event = onMouseHover.mock.calls[0][0];
      expect(event.feature).toBeDefined();
      expect(event.feature.featureId).toBe(1);
    });

    test('mouseout reports no feature', async () => {
      const onMouseHover = jest.fn();
      await withOverlay({ onMouseHover });
      onMouseHover.mockClear();

      handles.dataListeners.get('mouseout')!({ latLng: latLng(1, 2) });

      expect(onMouseHover).toHaveBeenCalledWith(expect.objectContaining({ feature: undefined }));
    });

    test('the hover handlers stay silent without a hover callback', async () => {
      const { overlay } = await withOverlay();

      expect(() => {
        handles.dataListeners.get('mouseover')!({ feature: overlay, latLng: latLng(1, 2) });
        handles.dataListeners.get('mouseout')!({});
      }).not.toThrow();
    });

    test('an event without a latLng still produces a usable event', async () => {
      const onMouseHover = jest.fn();
      const { overlay } = await withOverlay({ onMouseHover });
      onMouseHover.mockClear();

      handles.dataListeners.get('mouseover')!({ feature: overlay });

      expect(onMouseHover.mock.calls[0][0].latLng).toBeDefined();
    });
  });
});
