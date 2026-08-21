import { ColorUtils } from '../../src/ColorUtils';

describe('ColorUtils alpha handling', () => {
  describe('getAlpha', () => {
    test('reads the alpha out of an rgba string', () => {
      expect(ColorUtils.getAlpha('rgba(255, 140, 0, 0.4)')).toBeCloseTo(0.4);
    });

    test('reports 1 for a color that declares no alpha', () => {
      expect(ColorUtils.getAlpha('#E69F00')).toBe(1);
      expect(ColorUtils.getAlpha('rgb(1, 2, 3)')).toBe(1);
      expect(ColorUtils.getAlpha('red')).toBe(1);
    });

    test('reports 0 for transparent', () => {
      expect(ColorUtils.getAlpha('transparent')).toBe(0);
    });

    test('reports null for something it cannot parse, so callers can tell it apart from opaque', () => {
      expect(ColorUtils.getAlpha('not-a-color')).toBeNull();
    });
  });

  describe('scaleAlpha', () => {
    test('lifts the alpha of an rgba color', () => {
      // The case the old substring hack could never handle: it was gated on
      // the color *not* containing "rgba(", so every library default was
      // skipped and hover produced no visible change at all.
      expect(ColorUtils.scaleAlpha('rgba(188, 189, 220, 0.5)', 1.5)).toBe('rgba(188, 189, 220, 0.75)');
    });

    test('treats an alpha-less color as fully opaque', () => {
      expect(ColorUtils.scaleAlpha('#0072B2', 0.5)).toBe('rgba(0, 114, 178, 0.5)');
    });

    test('clamps rather than emitting an out-of-range alpha', () => {
      expect(ColorUtils.scaleAlpha('rgba(0, 0, 0, 0.8)', 4)).toBe('rgba(0, 0, 0, 1)');
      expect(ColorUtils.scaleAlpha('rgba(0, 0, 0, 0.8)', -1)).toBe('rgba(0, 0, 0, 0)');
    });

    test('leaves transparent and unparseable colors alone', () => {
      expect(ColorUtils.scaleAlpha('transparent', 2)).toBe('transparent');
      expect(ColorUtils.scaleAlpha('not-a-color', 2)).toBe('not-a-color');
    });

    test('handles named and short-hex colors', () => {
      expect(ColorUtils.scaleAlpha('red', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
      expect(ColorUtils.scaleAlpha('#f00', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    });
  });
});
