import { StyleResolver } from '../../src/style/StyleResolver';
import { GeometryType } from '../../src/types';

const feature = (type = GeometryType.Polygon, properties: Record<string, any> = {}): any => ({
  type,
  properties,
});

const stateWith = (selected: Set<string | number>, hovered: Set<string | number>, count = 0) => ({
  isSelected: (id: string | number) => selected.has(id),
  isHovered: (id: string | number) => hovered.has(id),
  featureCount: () => count,
});

describe('StyleResolver', () => {
  let selected: Set<string | number>;
  let hovered: Set<string | number>;

  beforeEach(() => {
    selected = new Set();
    hovered = new Set();
  });

  describe('base resolution', () => {
    test('returns a static style untouched when the feature has no state', () => {
      const style = { fillStyle: 'red', lineWidth: 2 };
      const resolver = new StyleResolver(style, stateWith(selected, hovered));

      expect(resolver.resolve(feature(), 'a')).toEqual(style);
    });

    test('calls a style function with the feature', () => {
      const fn = jest.fn(() => ({ fillStyle: 'blue' }));
      const resolver = new StyleResolver(fn, stateWith(selected, hovered));
      const f = feature(GeometryType.Polygon, { name: 'x' });

      expect(resolver.resolve(f, 'a')).toEqual({ fillStyle: 'blue' });
      expect(fn).toHaveBeenCalledWith(f, undefined);
    });

    test('strips the nested selected/hover keys from the result', () => {
      const style = {
        fillStyle: 'red',
        selected: { fillStyle: 'orange' },
        hover: { fillStyle: 'pink' },
      };
      const resolver = new StyleResolver(style, stateWith(selected, hovered));
      selected.add('a');

      const result = resolver.resolve(feature(), 'a');
      expect(result.selected).toBeUndefined();
      expect(result.hover).toBeUndefined();
    });
  });

  describe('state precedence', () => {
    test('selected style wins over the base style', () => {
      const resolver = new StyleResolver(
        { fillStyle: 'red', selected: { fillStyle: 'orange' } },
        stateWith(selected, hovered),
      );
      selected.add('a');

      expect(resolver.resolve(feature(), 'a').fillStyle).toBe('orange');
    });

    test('hover style applies when hovered and not selected', () => {
      const resolver = new StyleResolver(
        { fillStyle: 'red', hover: { fillStyle: 'pink' } },
        stateWith(selected, hovered),
      );
      hovered.add('a');

      expect(resolver.resolve(feature(), 'a').fillStyle).toBe('pink');
    });

    test('selected beats hover when a feature is both', () => {
      const resolver = new StyleResolver(
        { fillStyle: 'red', selected: { fillStyle: 'orange' }, hover: { fillStyle: 'pink' } },
        stateWith(selected, hovered),
      );
      selected.add('a');
      hovered.add('a');

      expect(resolver.resolve(feature(), 'a').fillStyle).toBe('orange');
    });

    test('falls back to a computed highlight when selected with no selected style', () => {
      const resolver = new StyleResolver({ lineWidth: 1 }, stateWith(selected, hovered));
      selected.add('a');

      const result = resolver.resolve(feature(GeometryType.Polygon), 'a');
      expect(result.fillStyle).toBe(StyleResolver.selectedStyleFor(feature()).fillStyle);
    });

    test('keeps an explicit fillStyle rather than overriding it with the fallback', () => {
      const resolver = new StyleResolver({ fillStyle: 'red' }, stateWith(selected, hovered));
      selected.add('a');

      expect(resolver.resolve(feature(), 'a').fillStyle).toBe('red');
    });
  });

  describe('caching', () => {
    test('returns the same object for a repeated resolve under load', () => {
      const fn = jest.fn(() => ({ fillStyle: 'blue', selected: { fillStyle: 'orange' } }));
      const resolver = new StyleResolver(fn, stateWith(selected, hovered, 500));
      selected.add('a');

      const first = resolver.resolve(feature(), 'a');
      const second = resolver.resolve(feature(), 'a');

      expect(second).toBe(first);
    });

    test('setStyle invalidates cached entries', () => {
      const resolver = new StyleResolver(
        { fillStyle: 'red', selected: { fillStyle: 'orange' } },
        stateWith(selected, hovered, 500),
      );
      selected.add('a');
      resolver.resolve(feature(), 'a');
      expect(resolver.size).toBeGreaterThan(0);

      resolver.setStyle({ fillStyle: 'green', selected: { fillStyle: 'lime' } });
      expect(resolver.size).toBe(0);
      expect(resolver.resolve(feature(), 'a').fillStyle).toBe('lime');
    });

    test('a state change produces a different cache entry', () => {
      const resolver = new StyleResolver(
        { fillStyle: 'red', selected: { fillStyle: 'orange' } },
        stateWith(selected, hovered, 500),
      );

      const unselected = resolver.resolve(feature(), 'a');
      selected.add('a');
      const nowSelected = resolver.resolve(feature(), 'a');

      expect(unselected.fillStyle).toBe('red');
      expect(nowSelected.fillStyle).toBe('orange');
    });
  });

  describe('hover fallback', () => {
    test('lifts the fill alpha of an rgba color', () => {
      // The old implementation replaced the substring "0.3" with "0.5", and
      // only when the color did not contain "rgba(" - so for the library's own
      // defaults, all of which are rgba, hovering changed nothing at all.
      const resolver = new StyleResolver({ fillStyle: 'rgba(188, 189, 220, 0.5)' }, stateWith(selected, hovered));
      hovered.add('a');

      expect(resolver.resolve(feature(), 'a').fillStyle).toBe('rgba(188, 189, 220, 0.75)');
    });

    test('thickens the outline as well, so hover survives greyscale', () => {
      const resolver = new StyleResolver(
        { fillStyle: 'rgba(0, 114, 178, 0.25)', lineWidth: 1.5 },
        stateWith(selected, hovered),
      );
      hovered.add('a');

      expect(resolver.resolve(feature(), 'a').lineWidth).toBe(2.5);
    });

    test('still emphasises a feature with no fill at all', () => {
      const resolver = new StyleResolver({ strokeStyle: '#0072B2' }, stateWith(selected, hovered));
      hovered.add('a');

      const result = resolver.resolve(feature(GeometryType.LineString), 'a');
      expect(result.lineWidth).toBe(2);
    });

    test('an explicit hover style still wins over the fallback', () => {
      const resolver = new StyleResolver(
        { fillStyle: 'rgba(0, 0, 0, 0.5)', hover: { fillStyle: 'pink', lineWidth: 9 } },
        stateWith(selected, hovered),
      );
      hovered.add('a');

      const result = resolver.resolve(feature(), 'a');
      expect(result.fillStyle).toBe('pink');
      expect(result.lineWidth).toBe(9);
    });
  });

  describe('style context', () => {
    test('passes zoom and tile through to a style function', () => {
      const fn = jest.fn(() => ({ fillStyle: 'blue' }));
      const resolver = new StyleResolver(fn, stateWith(selected, hovered));
      const context = { zoom: 12, tileContext: { id: '12:1:1' } as any };

      resolver.resolve(feature(), 'a', context);

      expect(fn).toHaveBeenCalledWith(expect.anything(), context);
    });

    test('lets a style function vary by zoom', () => {
      const byZoom = (_f: any, ctx?: any) => ({ lineWidth: (ctx?.zoom ?? 0) >= 12 ? 4 : 1 });
      const resolver = new StyleResolver(byZoom, stateWith(selected, hovered));
      const tileContext = { id: 't' } as any;

      expect(resolver.resolve(feature(), 'a', { zoom: 8, tileContext }).lineWidth).toBe(1);
      expect(resolver.resolve(feature(), 'a', { zoom: 14, tileContext }).lineWidth).toBe(4);
    });

    test('caches per zoom, so one zoom does not serve another its style', () => {
      const byZoom = jest.fn((_f: any, ctx?: any) => ({ lineWidth: ctx?.zoom }));
      const resolver = new StyleResolver(byZoom, stateWith(selected, hovered, 500));
      const tileContext = { id: 't' } as any;
      selected.add('a');

      resolver.resolve(feature(), 'a', { zoom: 8, tileContext });
      const atFourteen = resolver.resolve(feature(), 'a', { zoom: 14, tileContext });

      expect(atFourteen.lineWidth).toBe(14);
    });
  });

  describe('cache keying', () => {
    test('two features differing outside the old whitelist no longer collide', () => {
      // `name` was not one of the ten hashed properties, so these two features
      // produced the same cache key and the second was served the first's
      // style. Sharing an id is normal: the default extractor falls back to a
      // single id for every feature without one.
      const fn = jest.fn((f: any) => ({ fillStyle: f.properties.name === 'alpha' ? 'red' : 'green' }));
      const resolver = new StyleResolver(fn, stateWith(selected, hovered, 500));

      const alpha = resolver.resolve(feature(GeometryType.Polygon, { name: 'alpha' }), 'shared-id');
      const beta = resolver.resolve(feature(GeometryType.Polygon, { name: 'beta' }), 'shared-id');

      expect(alpha.fillStyle).toBe('red');
      expect(beta.fillStyle).toBe('green');
    });

    test('property order does not change the key', () => {
      const resolver = new StyleResolver(() => ({ fillStyle: 'blue' }), stateWith(selected, hovered, 500));

      resolver.resolve(feature(GeometryType.Polygon, { a: 1, b: 2 }), 'id');
      const before = resolver.size;
      resolver.resolve(feature(GeometryType.Polygon, { b: 2, a: 1 }), 'id');

      expect(resolver.size).toBe(before);
    });

    test('the same feature object still hits the cache', () => {
      const fn = jest.fn(() => ({ fillStyle: 'blue' }));
      const resolver = new StyleResolver(fn, stateWith(selected, hovered, 500));
      const f = feature(GeometryType.Polygon, { name: 'x' });
      selected.add('a');

      const first = resolver.resolve(f, 'a');
      const second = resolver.resolve(f, 'a');

      expect(second).toBe(first);
    });
  });

  describe('defaults', () => {
    test('gives each geometry type its own default', () => {
      expect(StyleResolver.defaultStyleFor(feature(GeometryType.Point)).radius).toBe(5);
      expect(StyleResolver.defaultStyleFor(feature(GeometryType.LineString)).lineWidth).toBe(3);
      expect(StyleResolver.defaultStyleFor(feature(GeometryType.Polygon)).lineWidth).toBe(1);
    });

    test('selected fallbacks are heavier than the defaults', () => {
      expect(StyleResolver.selectedStyleFor(feature(GeometryType.Point)).radius).toBe(7);
      expect(StyleResolver.selectedStyleFor(feature(GeometryType.LineString)).lineWidth).toBe(5);
      expect(StyleResolver.selectedStyleFor(feature(GeometryType.Polygon)).lineWidth).toBe(3);
    });

    test('returns an empty style for an unknown geometry type', () => {
      expect(StyleResolver.selectedStyleFor(feature(99 as GeometryType))).toEqual({});
    });
  });
});
