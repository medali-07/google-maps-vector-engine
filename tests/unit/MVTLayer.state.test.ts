// MVTLayer's parsing, z-ordering and lifecycle branches.

import { MVTLayer } from '../../src/MVTLayer';
import { GeometryType, MVTLayerOptions } from '../../src/types';
import { createMockTileContext, createMockMVTSource, createMockCanvasContext } from '../utils/mockData';

const vtFeature = (id: string, type = GeometryType.Polygon, properties: Record<string, unknown> = {}): any => ({
  id,
  type,
  extent: 256,
  properties,
  loadGeometry: () => [
    [
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

describe('MVTLayer', () => {
  let source: any;
  let tileContext: any;

  beforeEach(() => {
    source = createMockMVTSource();
    source.getStyleForFeature = undefined;
    tileContext = createMockTileContext();
    jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
  });

  describe('parsing', () => {
    test('creates one feature per vector tile feature', () => {
      const layer = makeLayer();

      layer.parseVectorTileFeatures(source, [vtFeature('a'), vtFeature('b')], tileContext);

      expect(Object.keys((layer as any)._mVTFeatures).sort()).toEqual(['a', 'b']);
    });

    test('reuses an existing feature seen in another tile', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('a')], tileContext);
      const first = (layer as any)._mVTFeatures.a;

      const second = createMockTileContext({ id: 'tile-2' });
      jest.spyOn(second.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
      layer.parseVectorTileFeatures(source, [vtFeature('a')], second);

      expect((layer as any)._mVTFeatures.a).toBe(first);
      expect(Object.keys(first.getTiles())).toHaveLength(2);
    });

    test('a filter drops the features it rejects', () => {
      const layer = makeLayer({ filter: (f: any) => f.id !== 'b' });

      layer.parseVectorTileFeatures(source, [vtFeature('a'), vtFeature('b')], tileContext);

      expect(Object.keys((layer as any)._mVTFeatures)).toEqual(['a']);
    });

    test('a style function is applied per feature', () => {
      const style = jest.fn((f: any) => ({ fillStyle: f.id === 'a' ? 'red' : 'blue' }));
      const layer = makeLayer({ style });

      layer.parseVectorTileFeatures(source, [vtFeature('a'), vtFeature('b')], tileContext);

      expect((layer as any)._mVTFeatures.a.style.fillStyle).toBe('red');
      expect((layer as any)._mVTFeatures.b.style.fillStyle).toBe('blue');
    });

    test('picks up selection and hover state from the source', () => {
      source.isFeatureSelected = (id: string) => id === 'a';
      source.isFeatureHovered = (id: string) => id === 'b';
      const layer = makeLayer();

      layer.parseVectorTileFeatures(source, [vtFeature('a'), vtFeature('b')], tileContext);

      expect((layer as any)._mVTFeatures.a.selected).toBe(true);
      expect((layer as any)._mVTFeatures.b.hovered).toBe(true);
    });

    test('updates state on a feature seen again in another tile', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('a')], tileContext);
      expect((layer as any)._mVTFeatures.a.selected).toBe(false);

      source.isFeatureSelected = () => true;
      const second = createMockTileContext({ id: 'tile-2' });
      jest.spyOn(second.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
      layer.parseVectorTileFeatures(source, [vtFeature('a')], second);

      expect((layer as any)._mVTFeatures.a.selected).toBe(true);
    });
  });

  describe('z-ordering', () => {
    test('draws plain, then hovered, then selected', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('plain'), vtFeature('hov'), vtFeature('sel')], tileContext);

      const features = (layer as any)._mVTFeatures;
      features.hov.hovered = true;
      features.sel.selected = true;

      const order: string[] = [];
      for (const key of ['plain', 'hov', 'sel']) {
        jest.spyOn(features[key], 'draw').mockImplementation(() => order.push(key));
      }

      layer.drawTile(tileContext);

      expect(order).toEqual(['plain', 'hov', 'sel']);
    });

    test('drawing an unknown tile is a no-op', () => {
      const layer = makeLayer();

      expect(() => layer.drawTile(createMockTileContext({ id: 'nowhere' }))).not.toThrow();
    });

    test('drawing a tile with no features is a no-op', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [], tileContext);

      expect(() => layer.drawTile(tileContext)).not.toThrow();
    });
  });

  describe('mutation', () => {
    test('setStyle restyles every feature', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('a')], tileContext);

      layer.setStyle({ fillStyle: 'green' });

      expect(layer.style).toEqual({ fillStyle: 'green' });
      expect((layer as any)._mVTFeatures.a.style.fillStyle).toBe('green');
    });

    test('setStyle accepts a function', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('a')], tileContext);

      layer.setStyle(() => ({ fillStyle: 'purple' }));

      expect((layer as any)._mVTFeatures.a.style.fillStyle).toBe('purple');
    });

    test('setFilter records the filter', () => {
      const layer = makeLayer();
      const filter = (): boolean => true;

      layer.setFilter(filter);
      expect((layer as any)._filter).toBe(filter);

      layer.setFilter(false);
      expect((layer as any)._filter).toBe(false);
    });

    test('setSelected delegates to the source, which owns selection state', () => {
      source._selectFeature = jest.fn();
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('a')], tileContext);

      layer.setSelected('a');

      expect(source._selectFeature).toHaveBeenCalledWith('a');
    });

    test('setSelected ignores an unknown feature', () => {
      const layer = makeLayer();

      expect(() => layer.setSelected('nope')).not.toThrow();
    });
  });

  describe('releaseTile', () => {
    test('drops the tile and disposes features left with none', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('a')], tileContext);

      const empty = layer.releaseTile(tileContext.id);

      expect(empty).toBe(true);
      expect((layer as any)._mVTFeatures.a).toBeUndefined();
    });

    test('keeps a feature that still appears in another tile', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('a')], tileContext);
      const second = createMockTileContext({ id: 'tile-2' });
      jest.spyOn(second.canvas, 'getContext').mockReturnValue(createMockCanvasContext());
      layer.parseVectorTileFeatures(source, [vtFeature('a')], second);

      const empty = layer.releaseTile(tileContext.id);

      expect(empty).toBe(false);
      expect((layer as any)._mVTFeatures.a).toBeDefined();
    });

    test('releasing an unknown tile reports whether the layer is empty', () => {
      const layer = makeLayer();

      expect(layer.releaseTile('never-seen')).toBe(true);
    });
  });

  describe('dispose', () => {
    test('drops every feature and tile', () => {
      const layer = makeLayer();
      layer.parseVectorTileFeatures(source, [vtFeature('a'), vtFeature('b')], tileContext);

      layer.dispose();

      expect(Object.keys((layer as any)._mVTFeatures)).toHaveLength(0);
      expect(Object.keys((layer as any)._canvasAndMVTFeatures)).toHaveLength(0);
    });

    test('is safe to call twice', () => {
      const layer = makeLayer();
      layer.dispose();

      expect(() => layer.dispose()).not.toThrow();
    });
  });
});
