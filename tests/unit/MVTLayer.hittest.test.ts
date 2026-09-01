// Regression test for the hit-test race carried over from Phase 1.
//
// `selectedFeature` and `minDistance` were instance fields mutated during a
// hit test. Hover ran behind a timer while click ran synchronously, so two
// passes could interleave: one returning the other's feature, or an exact hit
// being thrown away because the other pass had already reset minDistance.

import { MVTLayer } from '../../src/MVTLayer';
import { Mercator } from '../../src/Mercator';
import { GeometryType, MVTLayerOptions } from '../../src/types';
import { createMockTileContext } from '../utils/mockData';

/** Minimal stand-in for MVTFeature that reports a fixed hit result. */
const stubFeature = (id: string, opts: { hits: boolean; selected?: boolean }): any => ({
  featureId: id,
  type: GeometryType.Polygon,
  selected: Boolean(opts.selected),
  hovered: false,
  style: {},
  isPointInPath: jest.fn(() => opts.hits),
  getPaths: jest.fn(() => []),
});

const makeLayer = (): MVTLayer => {
  const options: MVTLayerOptions = {
    name: 'layer',
    getIDForLayerFeature: (f: any) => f.id,
    style: {},
    filter: false,
    customDraw: false,
  };
  return new MVTLayer(options);
};

const eventFor = (tileContext: any): any => ({
  latLng: {},
  pixel: {},
  tileContext,
  tilePoint: { x: 10, y: 10 },
});

describe('MVTLayer hit testing', () => {
  let layer: MVTLayer;
  let tileContext: any;

  beforeEach(() => {
    layer = makeLayer();
    tileContext = createMockTileContext({ id: 'tile-1' });
  });

  const seed = (features: any[]): void => {
    (layer as any)._canvasAndMVTFeatures[tileContext.id] = {
      canvas: tileContext.canvas,
      features,
    };
  };

  test('returns the feature under the pointer', () => {
    const hit = stubFeature('hit', { hits: true });
    seed([stubFeature('miss', { hits: false }), hit]);

    const result = layer.handleClickEvent(eventFor(tileContext), {});

    expect(result.feature).toBe(hit);
  });

  test('returns nothing when the pointer is over empty space', () => {
    seed([stubFeature('miss', { hits: false })]);

    const result = layer.handleClickEvent(eventFor(tileContext), {});

    expect(result.feature).toBeUndefined();
  });

  test('prefers an already-selected feature over an overlapping one', () => {
    const selected = stubFeature('selected', { hits: true, selected: true });
    const other = stubFeature('other', { hits: true });
    seed([other, selected]);

    const result = layer.handleClickEvent(eventFor(tileContext), {});

    expect(result.feature).toBe(selected);
  });

  test('a hit test nested inside another does not discard its result', () => {
    // The exact interleaving that used to break. A line hit does not set
    // minDistance to 0, so the sweep keeps going after finding one. If a
    // second hit test ran during a later feature's check, it reset the shared
    // selectedFeature and minDistance, and the outer sweep returned nothing at
    // all - the click landed on empty space even though a line was under it.
    const line = (id: string, path: unknown): any => ({
      featureId: id,
      type: GeometryType.LineString,
      selected: false,
      hovered: false,
      style: { lineWidth: 1 },
      isPointInPath: jest.fn(() => false),
      getPaths: jest.fn(() => [path]),
    });

    const hitter = line('hitter', 'near');
    const corruptor = line('corruptor', 'far');

    const otherTile = createMockTileContext({ id: 'tile-2' });
    (layer as any)._canvasAndMVTFeatures[otherTile.id] = {
      canvas: otherTile.canvas,
      features: [line('other', 'near')],
    };

    // tolerance is lineWidth / 2 + 2, so 0.1 hits and 50 misses.
    jest
      .spyOn(Mercator, 'getDistanceFromLine')
      .mockImplementation((_p: any, path: any) => (path === 'near' ? 0.1 : 50));

    let reentered = false;
    corruptor.getPaths = jest.fn(() => {
      if (!reentered) {
        reentered = true;
        // A full, self-contained hit test runs to completion right here.
        layer.handleClickEvent(eventFor(otherTile), {});
      }
      return ['far'];
    });

    // Reverse iteration checks the last entry first, so the hit is recorded
    // before the corrupting pass runs.
    seed([corruptor, hitter]);

    const result = layer.handleClickEvent(eventFor(tileContext), {});

    expect(reentered).toBe(true);
    expect(result.feature).toBe(hitter);
  });

  test('two consecutive hit tests do not leak state into each other', () => {
    const hit = stubFeature('hit', { hits: true });
    seed([hit]);
    expect(layer.handleClickEvent(eventFor(tileContext), {}).feature).toBe(hit);

    seed([stubFeature('miss', { hits: false })]);
    // A stale minDistance of 0 from the previous pass must not survive.
    expect(layer.handleClickEvent(eventFor(tileContext), {}).feature).toBeUndefined();
  });

  test('an unknown tile is handled without throwing', () => {
    const event = eventFor(createMockTileContext({ id: 'never-seen' }));

    expect(() => layer.handleClickEvent(event, {})).not.toThrow();
    expect(layer.handleClickEvent(event, {}).feature).toBeUndefined();
  });
});
