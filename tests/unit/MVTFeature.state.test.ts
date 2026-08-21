// MVTFeature's state, drawing and caching branches.

import { MVTFeature } from '../../src/MVTFeature';
import { GeometryType, MVTFeatureOptions } from '../../src/types';
import { createMockTileContext, createMockMVTSource, createMockCanvasContext } from '../utils/mockData';

const geometryFor = (type: GeometryType): { x: number; y: number }[][] => {
  if (type === GeometryType.Point) return [[{ x: 128, y: 128 }]];
  if (type === GeometryType.LineString) {
    return [
      [
        { x: 0, y: 0 },
        { x: 128, y: 128 },
      ],
    ];
  }
  return [
    [
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 110 },
      { x: 10, y: 110 },
    ],
  ];
};

const vtFeature = (type = GeometryType.Polygon, properties: Record<string, unknown> = {}, id: any = 'f1'): any => ({
  id,
  type,
  extent: 256,
  properties,
  loadGeometry: jest.fn(() => geometryFor(type)),
});

const build = (overrides: Partial<MVTFeatureOptions> = {}, type = GeometryType.Polygon): MVTFeature => {
  const mVTSource = createMockMVTSource();
  mVTSource.getStyleForFeature = undefined;

  return new MVTFeature({
    mVTSource,
    vectorTileFeature: vtFeature(type),
    tileContext: createMockTileContext(),
    style: { fillStyle: 'red', strokeStyle: 'blue', lineWidth: 2 },
    selected: false,
    featureId: 'f1',
    customDraw: false,
    ...overrides,
  } as MVTFeatureOptions);
};

describe('MVTFeature state', () => {
  test('takes its identity and properties from the decoded feature', () => {
    const feature = build();

    expect(feature.featureId).toBe('f1');
    expect(feature.type).toBe(GeometryType.Polygon);
    expect(feature.selected).toBe(false);
  });

  test('registers itself with the source', () => {
    const mVTSource = createMockMVTSource();
    mVTSource.registerFeature = jest.fn();
    build({ mVTSource });

    expect(mVTSource.registerFeature).toHaveBeenCalled();
  });

  describe('selection', () => {
    test('select and deselect delegate to the source', () => {
      const mVTSource = createMockMVTSource();
      mVTSource._selectFeature = jest.fn();
      mVTSource._deselectFeature = jest.fn();
      const feature = build({ mVTSource });

      feature.select();
      expect(mVTSource._selectFeature).toHaveBeenCalledWith('f1');

      feature.selected = true;
      feature.deselect();
      expect(mVTSource._deselectFeature).toHaveBeenCalledWith('f1');
    });

    test('select is a no-op when already selected', () => {
      const mVTSource = createMockMVTSource();
      mVTSource._selectFeature = jest.fn();
      const feature = build({ mVTSource, selected: true });

      feature.select();

      expect(mVTSource._selectFeature).not.toHaveBeenCalled();
    });

    test('deselect is a no-op when not selected', () => {
      const mVTSource = createMockMVTSource();
      mVTSource._deselectFeature = jest.fn();
      const feature = build({ mVTSource });

      feature.deselect();

      expect(mVTSource._deselectFeature).not.toHaveBeenCalled();
    });

    test('toggle flips whichever way it is currently set', () => {
      const mVTSource = createMockMVTSource();
      mVTSource._selectFeature = jest.fn();
      mVTSource._deselectFeature = jest.fn();
      const feature = build({ mVTSource });

      feature.toggle();
      expect(mVTSource._selectFeature).toHaveBeenCalled();

      feature.selected = true;
      feature.toggle();
      expect(mVTSource._deselectFeature).toHaveBeenCalled();
    });

    test('setSelected records the state and schedules a redraw', () => {
      const mVTSource = createMockMVTSource();
      mVTSource._scheduleRedrawForFeature = jest.fn();
      const feature = build({ mVTSource });

      feature.setSelected(true);
      expect(feature.selected).toBe(true);

      feature.setSelected(false);
      expect(feature.selected).toBe(false);
    });
  });

  describe('style', () => {
    test('setStyle replaces the style', () => {
      const feature = build();

      feature.setStyle({ fillStyle: 'green' });

      expect(feature.style).toEqual({ fillStyle: 'green' });
    });

    test('applies each declared property to the context', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);
      const feature = build({ tileContext, style: { fillStyle: 'red', strokeStyle: 'blue', lineWidth: 7 } });

      feature.draw(tileContext);

      expect(context.fillStyle).toBe('red');
      expect(context.strokeStyle).toBe('blue');
      expect(context.lineWidth).toBe(7);
    });

    test('leaves context properties alone when the style omits them', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      context.fillStyle = 'untouched';
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);
      const feature = build({ tileContext, style: { strokeStyle: 'blue' } });

      feature.draw(tileContext);

      expect(context.fillStyle).toBe('untouched');
    });

    test('always sets round caps and joins', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);
      const feature = build({ tileContext });

      feature.draw(tileContext);

      expect(context.lineCap).toBe('round');
      expect(context.lineJoin).toBe('round');
    });
  });

  describe('drawing each geometry type', () => {
    const drawWith = (type: GeometryType, style: Record<string, unknown> = {}): any => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);
      const mVTSource = createMockMVTSource();
      mVTSource.getStyleForFeature = undefined;

      const feature = new MVTFeature({
        mVTSource,
        vectorTileFeature: vtFeature(type),
        tileContext,
        style: { fillStyle: 'red', strokeStyle: 'blue', ...style },
        selected: false,
        featureId: 'f1',
        customDraw: false,
      } as MVTFeatureOptions);

      feature.draw(tileContext);
      return context;
    };

    test('a point is drawn as an arc', () => {
      const context = drawWith(GeometryType.Point);
      expect(context.arc).toHaveBeenCalled();
      expect(context.fill).toHaveBeenCalled();
    });

    test('a point honours its radius', () => {
      const context = drawWith(GeometryType.Point, { radius: 9 });
      expect(context.arc.mock.calls[0][2]).toBe(9);
    });

    test('a point falls back to a default radius', () => {
      const context = drawWith(GeometryType.Point, {});
      expect(context.arc.mock.calls[0][2]).toBe(3);
    });

    test('a line is stroked from a path', () => {
      const context = drawWith(GeometryType.LineString);
      expect(context.stroke).toHaveBeenCalled();
    });

    test('a polygon is filled and stroked', () => {
      const context = drawWith(GeometryType.Polygon);
      expect(context.fill).toHaveBeenCalled();
      expect(context.stroke).toHaveBeenCalled();
    });

    test('a polygon with no fill is only stroked', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);
      const mVTSource = createMockMVTSource();
      mVTSource.getStyleForFeature = undefined;

      const feature = new MVTFeature({
        mVTSource,
        vectorTileFeature: vtFeature(GeometryType.Polygon),
        tileContext,
        style: { strokeStyle: 'blue' },
        selected: false,
        featureId: 'f1',
        customDraw: false,
      } as MVTFeatureOptions);
      feature.draw(tileContext);

      expect(context.fill).not.toHaveBeenCalled();
      expect(context.stroke).toHaveBeenCalled();
    });

    test('a custom draw function replaces the default entirely', () => {
      const customDraw = jest.fn();
      const tileContext = createMockTileContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
      const feature = build({ tileContext, customDraw });

      feature.draw(tileContext);

      expect(customDraw).toHaveBeenCalledWith(tileContext, expect.anything(), expect.anything(), feature);
    });

    test('drawing a tile the feature does not belong to is a no-op', () => {
      const feature = build();
      const other = createMockTileContext({ id: 'elsewhere' });

      expect(() => feature.draw(other)).not.toThrow();
    });

    test('a feature replaced by an overlay builds paths but is not painted', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);
      const mVTSource = createMockMVTSource();
      mVTSource.getStyleForFeature = undefined;
      mVTSource.isFeatureReplaced = () => true;

      const feature = build({ mVTSource, tileContext, selected: true });
      feature.selected = true;
      feature.draw(tileContext);

      expect(context.fill).not.toHaveBeenCalled();
    });
  });

  describe('tiles', () => {
    test('addTileFeature records the tile and its divisor', () => {
      const feature = build();
      const second = createMockTileContext({ id: 'second' });

      feature.addTileFeature(vtFeature(), second);

      expect(feature.getTile(second).divisor).toBe(256 / 256);
      expect(Object.keys(feature.getTiles())).toHaveLength(2);
    });

    test('removeTile drops one tile and reports what is left', () => {
      const feature = build();
      const second = createMockTileContext({ id: 'second' });
      feature.addTileFeature(vtFeature(), second);

      const remaining = feature.removeTile(second.id);

      expect(remaining).toBe(1);
      expect(feature.getTiles()[second.id]).toBeUndefined();
    });

    test('removing the last tile reports zero', () => {
      const feature = build();
      const only = Object.keys(feature.getTiles())[0];

      expect(feature.removeTile(only)).toBe(0);
    });

    test('removing an unknown tile changes nothing', () => {
      const feature = build();

      expect(feature.removeTile('never-seen')).toBe(1);
    });
  });

  describe('path caching', () => {
    test('getPaths caches per tile', () => {
      const tileContext = createMockTileContext();
      const vt = vtFeature();
      const feature = build({ tileContext, vectorTileFeature: vt });

      const first = feature.getPaths(tileContext);
      const second = feature.getPaths(tileContext);

      expect(second).toBe(first);
    });

    test('getPaths returns nothing for a tile the feature is not in', () => {
      const feature = build();

      expect(feature.getPaths(createMockTileContext({ id: 'nowhere' }))).toEqual([]);
    });

    test('getPaths returns nothing when the geometry is empty', () => {
      const tileContext = createMockTileContext();
      const empty = { ...vtFeature(), loadGeometry: () => [] };
      const feature = build({ tileContext, vectorTileFeature: empty });

      expect(feature.getPaths(tileContext)).toEqual([]);
    });

    test('setStyle does not invalidate the geometry cache', () => {
      // Deliberate: _cachedPaths holds decoded coordinates, which no style
      // property can change. Re-decoding on every restyle would make setStyle
      // as expensive as a fresh parse.
      const tileContext = createMockTileContext();
      const feature = build({ tileContext });
      const before = feature.getPaths(tileContext);

      feature.setStyle({ fillStyle: 'green' });

      expect(feature.getPaths(tileContext)).toBe(before);
    });

    test('survives more tiles than the path cache holds', () => {
      const feature = build();

      for (let i = 0; i < 60; i++) {
        const context = createMockTileContext({ id: `tile-${i}` });
        feature.addTileFeature(vtFeature(), context);
        feature.getPaths(context);
      }

      expect(() => feature.getPaths(createMockTileContext({ id: 'tile-0' }))).not.toThrow();
    });

    test('decodes geometry only once per tile while the cache holds', () => {
      // The Path2D cache used to call loadGeometry before checking itself, so
      // it saved object construction but never the decode, which dominates.
      const tileContext = createMockTileContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
      const vt = vtFeature();
      const feature = build({ tileContext, vectorTileFeature: vt });

      feature.draw(tileContext);
      const afterFirst = vt.loadGeometry.mock.calls.length;
      feature.draw(tileContext);

      expect(vt.loadGeometry.mock.calls.length).toBe(afterFirst);
    });
  });

  describe('overzoom', () => {
    test('offsets geometry into the child tile', () => {
      const mVTSource = createMockMVTSource();
      mVTSource.getStyleForFeature = undefined;
      mVTSource.getTileObject = (id: string) => {
        const [z, x, y] = id.split(':').map(Number);
        return { z, x, y };
      };

      const tileContext = createMockTileContext({ id: '11:3:5', parentId: '10:1:2' });
      const feature = build({ mVTSource, tileContext });

      const paths = feature.getPaths(tileContext);

      // Scale is 2, and the child's odd x/y put it in the far quadrant, so the
      // offset is applied rather than the raw doubled coordinate.
      expect(paths[0][0].x).toBe(10 * 2 - 1 * 256);
      expect(paths[0][0].y).toBe(10 * 2 - 1 * 256);
    });
  });

  describe('dispose', () => {
    test('drops tiles and unregisters from the source', () => {
      const mVTSource = createMockMVTSource();
      mVTSource.unregisterFeature = jest.fn();
      const feature = build({ mVTSource });

      feature.dispose();

      expect(Object.keys(feature.getTiles())).toHaveLength(0);
      expect(mVTSource.unregisterFeature).toHaveBeenCalledWith('f1');
    });

    test('is safe when the source has no unregister hook', () => {
      const mVTSource = createMockMVTSource();
      mVTSource.unregisterFeature = undefined;
      const feature = build({ mVTSource });

      expect(() => feature.dispose()).not.toThrow();
    });
  });
});
