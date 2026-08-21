// ColorUtils was at 2.6% when this roadmap started - 1 of 39 lines, 0 of 4
// functions - despite being the only colour parsing in the library and the
// thing the hover fallback now depends on.

import { ColorUtils } from '../../src/ColorUtils';

describe('ColorUtils.parseRgb', () => {
  test('parses six-digit hex', () => {
    expect(ColorUtils.parseRgb('#0072B2')).toEqual({ r: 0, g: 114, b: 178 });
  });

  test('parses three-digit hex by doubling each nibble', () => {
    expect(ColorUtils.parseRgb('#f0a')).toEqual({ r: 255, g: 0, b: 170 });
  });

  test('parses rgb() and rgba()', () => {
    expect(ColorUtils.parseRgb('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(ColorUtils.parseRgb('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  test('rounds fractional channel values', () => {
    expect(ColorUtils.parseRgb('rgb(1.4, 2.6, 3.5)')).toEqual({ r: 1, g: 3, b: 4 });
  });

  test('tolerates whitespace and mixed case', () => {
    expect(ColorUtils.parseRgb('  RGBA( 10 , 20 , 30 , 1 ) ')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  test('parses the named colours it knows', () => {
    expect(ColorUtils.parseRgb('red')).toEqual({ r: 255, g: 0, b: 0 });
    expect(ColorUtils.parseRgb('GREY')).toEqual({ r: 128, g: 128, b: 128 });
    expect(ColorUtils.parseRgb('gray')).toEqual(ColorUtils.parseRgb('grey'));
  });

  test('returns null for anything it cannot parse', () => {
    expect(ColorUtils.parseRgb('not-a-colour')).toBeNull();
    expect(ColorUtils.parseRgb('#12345')).toBeNull();
    expect(ColorUtils.parseRgb('rgb(1, 2)')).toBeNull();
  });

  test('caches, so a repeated parse returns the same object', () => {
    const first = ColorUtils.parseRgb('#123456');
    expect(ColorUtils.parseRgb('#123456')).toBe(first);
  });

  test('the cache is case-insensitive', () => {
    expect(ColorUtils.parseRgb('#ABCDEF')).toEqual(ColorUtils.parseRgb('#abcdef'));
  });

  test('caches negative results too, so a bad colour is not reparsed', () => {
    expect(ColorUtils.parseRgb('still-not-a-colour')).toBeNull();
    expect(ColorUtils.parseRgb('still-not-a-colour')).toBeNull();
  });

  test('survives more entries than the cache holds', () => {
    // MAX_CACHE_SIZE is 500; this forces the eviction path.
    for (let i = 0; i < 600; i++) {
      ColorUtils.parseRgb(`rgb(${i % 256}, ${(i * 3) % 256}, ${(i * 7) % 256})`);
    }

    expect(ColorUtils.parseRgb('#0072B2')).toEqual({ r: 0, g: 114, b: 178 });
  });
});

describe('ColorUtils.convertColorWithOpacity', () => {
  test('replaces the alpha on a parseable colour', () => {
    expect(ColorUtils.convertColorWithOpacity('#0072B2', 0.4)).toBe('rgba(0, 114, 178, 0.4)');
    expect(ColorUtils.convertColorWithOpacity('red', 1)).toBe('rgba(255, 0, 0, 1)');
  });

  test('overrides an alpha that was already there', () => {
    expect(ColorUtils.convertColorWithOpacity('rgba(1, 2, 3, 0.9)', 0.1)).toBe('rgba(1, 2, 3, 0.1)');
  });

  test('passes transparent through untouched', () => {
    expect(ColorUtils.convertColorWithOpacity('transparent', 0.5)).toBe('transparent');
  });

  test('falls back rather than mangling an unparseable colour', () => {
    expect(ColorUtils.convertColorWithOpacity('hsl(200, 50%, 50%)', 0.5)).toBe('hsl(200, 50%, 50%)');
  });
});

describe('ColorUtils.hasAlpha', () => {
  test('recognises the forms that carry alpha', () => {
    expect(ColorUtils.hasAlpha('rgba(0, 0, 0, 0.5)')).toBe(true);
    expect(ColorUtils.hasAlpha('transparent')).toBe(true);
  });

  test('rejects the forms that do not', () => {
    expect(ColorUtils.hasAlpha('#000000')).toBe(false);
    expect(ColorUtils.hasAlpha('rgb(0, 0, 0)')).toBe(false);
    expect(ColorUtils.hasAlpha('red')).toBe(false);
  });
});
