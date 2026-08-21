/**
 * Color utility functions for handling color format conversions
 */
export class ColorUtils {
  private static _colorCache = new Map<string, { r: number; g: number; b: number; a?: number } | null>();
  private static readonly MAX_CACHE_SIZE = 500;

  private static readonly COMMON_COLORS = new Map([
    ['black', { r: 0, g: 0, b: 0 }],
    ['white', { r: 255, g: 255, b: 255 }],
    ['red', { r: 255, g: 0, b: 0 }],
    ['green', { r: 0, g: 128, b: 0 }],
    ['blue', { r: 0, g: 0, b: 255 }],
    ['yellow', { r: 255, g: 255, b: 0 }],
    ['cyan', { r: 0, g: 255, b: 255 }],
    ['magenta', { r: 255, g: 0, b: 255 }],
    ['orange', { r: 255, g: 165, b: 0 }],
    ['purple', { r: 128, g: 0, b: 128 }],
    ['gray', { r: 128, g: 128, b: 128 }],
    ['grey', { r: 128, g: 128, b: 128 }],
  ]);
  private static _cleanupCache(): void {
    if (this._colorCache.size >= this.MAX_CACHE_SIZE) {
      const entries = Array.from(this._colorCache.entries());
      const keepCount = Math.floor(this.MAX_CACHE_SIZE * 0.7);

      this._colorCache.clear();
      entries.slice(-keepCount).forEach(([key, value]) => {
        this._colorCache.set(key, value);
      });
    }
  }

  /**
   * Convert a color string with opacity to rgba format
   * Handles hex, rgb, rgba, and named colors
   */
  static convertColorWithOpacity(colorStr: string, opacity: number): string {
    if (colorStr === 'transparent') return 'transparent';

    const cacheKey = colorStr.toLowerCase();
    let rgbValues = this._colorCache.get(cacheKey);

    if (rgbValues === undefined) {
      rgbValues = this._parseColorInternal(colorStr);
      this._cleanupCache();
      this._colorCache.set(cacheKey, rgbValues);
    }

    if (rgbValues) {
      return `rgba(${rgbValues.r}, ${rgbValues.g}, ${rgbValues.b}, ${opacity})`;
    }

    return this._convertColorWithOpacityOriginal(colorStr, opacity);
  }

  private static _parseColorInternal(colorStr: string): { r: number; g: number; b: number; a?: number } | null {
    // Every branch below works on the normalised string. They used to read the
    // original, so a leading space or an uppercase `RGB(` fell through to null
    // - and CSS colours are case-insensitive, so `fillStyle: 'RGB(1,2,3)'` is
    // perfectly valid input that silently defeated fillOpacity and the hover
    // fallback.
    const lowerColor = colorStr.toLowerCase().trim();

    const commonColor = this.COMMON_COLORS.get(lowerColor);
    if (commonColor) {
      return commonColor;
    }

    if (lowerColor.startsWith('#')) {
      const hex = lowerColor.slice(1);
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
        };
      } else if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
        };
      }
    }

    const rgbMatch = lowerColor.match(/rgba?\((.+)\)/);
    if (rgbMatch) {
      const values = rgbMatch[1].split(',').map((v) => parseFloat(v.trim()));
      if (values.length >= 3) {
        const result = {
          r: Math.round(values[0]),
          g: Math.round(values[1]),
          b: Math.round(values[2]),
        };
        if (values.length >= 4) {
          (result as any).a = values[3];
        }
        return result;
      }
    }

    return null;
  }

  private static _convertColorWithOpacityOriginal(colorStr: string, opacity: number): string {
    if (colorStr.startsWith('rgba(')) {
      return colorStr.replace(/[\d.]+\)$/, `${opacity})`);
    }

    const namedColors: Record<string, string> = {
      transparent: 'transparent',
    };

    if (namedColors[colorStr.toLowerCase()]) {
      return namedColors[colorStr.toLowerCase()];
    }

    return colorStr;
  }

  /**
   * Check if a color string already includes alpha/opacity information
   */
  static hasAlpha(colorStr: string): boolean {
    return colorStr.startsWith('rgba(') || colorStr === 'transparent';
  }

  /**
   * Alpha channel of a color string.
   *
   * Returns 1 for any color that declares no alpha, and 0 for `transparent`.
   * Returns null when the string cannot be parsed at all, so callers can tell
   * "opaque" apart from "unknown" and leave unrecognised colors alone.
   */
  static getAlpha(colorStr: string): number | null {
    if (colorStr === 'transparent') return 0;

    const parsed = this.parseRgb(colorStr);
    if (!parsed) return null;

    return parsed.a !== undefined ? parsed.a : 1;
  }

  /**
   * Same color with its alpha multiplied by `factor`, clamped to [0, 1].
   *
   * Used for the hover fallback, which previously did a literal `"0.3"` to
   * `"0.5"` substring replacement on the color string - gated, additionally,
   * on the color *not* starting with `rgba(`, so it silently did nothing for
   * every one of the library's own defaults.
   *
   * Returns the input unchanged when it cannot be parsed or is transparent.
   */
  static scaleAlpha(colorStr: string, factor: number): string {
    if (colorStr === 'transparent') return colorStr;

    const parsed = this.parseRgb(colorStr);
    if (!parsed) return colorStr;

    const current = parsed.a !== undefined ? parsed.a : 1;
    const scaled = Math.min(1, Math.max(0, current * factor));

    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${scaled})`;
  }

  /**
   * Parse RGB values from a color string
   * Returns null if unable to parse
   */
  static parseRgb(colorStr: string): { r: number; g: number; b: number; a?: number } | null {
    const cacheKey = colorStr.toLowerCase().trim();
    let cachedResult = this._colorCache.get(cacheKey);

    if (cachedResult === undefined) {
      cachedResult = this._parseColorInternal(colorStr);
      this._cleanupCache();
      this._colorCache.set(cacheKey, cachedResult);
    }

    return cachedResult;
  }
}
