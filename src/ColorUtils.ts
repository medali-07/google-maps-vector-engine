/**
 * Color utility functions for handling color format conversions
 */
export class ColorUtils {
  /**
   * Convert a color string with opacity to rgba format
   * Handles hex, rgb, rgba, and named colors
   */
  static convertColorWithOpacity(colorStr: string, opacity: number): string {
    // Handle hex colors
    if (colorStr.startsWith('#')) {
      const hex = colorStr.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
      } else if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
      }
    }
    
    // Handle rgb() colors
    if (colorStr.startsWith('rgb(')) {
      const values = colorStr.match(/\d+/g);
      if (values && values.length >= 3) {
        return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${opacity})`;
      }
    }
    
    // Handle rgba() colors - replace existing alpha
    if (colorStr.startsWith('rgba(')) {
      return colorStr.replace(/[\d.]+\)$/, `${opacity})`);
    }
    
    // Handle named colors (convert common ones to rgba)
    const namedColors: Record<string, string> = {
      'black': `rgba(0, 0, 0, ${opacity})`,
      'white': `rgba(255, 255, 255, ${opacity})`,
      'red': `rgba(255, 0, 0, ${opacity})`,
      'green': `rgba(0, 128, 0, ${opacity})`,
      'blue': `rgba(0, 0, 255, ${opacity})`,
      'transparent': 'transparent'
    };
    
    if (namedColors[colorStr.toLowerCase()]) {
      return namedColors[colorStr.toLowerCase()];
    }
    
    // Fallback: return original color (this shouldn't happen in normal cases)
    return colorStr;
  }

  /**
   * Check if a color string already includes alpha/opacity information
   */
  static hasAlpha(colorStr: string): boolean {
    return colorStr.startsWith('rgba(') || colorStr === 'transparent';
  }

  /**
   * Parse RGB values from a color string
   * Returns null if unable to parse
   */
  static parseRgb(colorStr: string): { r: number; g: number; b: number; a?: number } | null {
    // Handle hex colors
    if (colorStr.startsWith('#')) {
      const hex = colorStr.slice(1);
      if (hex.length === 3) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16)
        };
      } else if (hex.length === 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16)
        };
      }
    }
    
    // Handle rgb() and rgba() colors
    const rgbMatch = colorStr.match(/rgba?\((.+)\)/);
    if (rgbMatch) {
      const values = rgbMatch[1].split(',').map(v => parseFloat(v.trim()));
      if (values.length >= 3) {
        const result = {
          r: values[0],
          g: values[1],
          b: values[2]
        };
        if (values.length >= 4) {
          (result as any).a = values[3];
        }
        return result;
      }
    }
    
    return null;
  }
}
