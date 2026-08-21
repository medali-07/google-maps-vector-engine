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
      expect(fn).toHaveBeenCalledWith(f);
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
