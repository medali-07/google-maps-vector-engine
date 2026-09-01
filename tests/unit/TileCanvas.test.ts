import {
  DEFAULT_MAX_PIXEL_RATIO,
  clearTileCanvas,
  createTileCanvas,
  getTileContext2D,
  pixelRatioOf,
  resolvePixelRatio,
  toDevicePixels,
} from '../../src/render/TileCanvas';

const setDpr = (value: unknown): void => {
  Object.defineProperty(window, 'devicePixelRatio', {
    value,
    configurable: true,
    writable: true,
  });
};

describe('TileCanvas', () => {
  const originalDpr = window.devicePixelRatio;

  afterEach(() => {
    setDpr(originalDpr);
    jest.restoreAllMocks();
  });

  describe('resolvePixelRatio', () => {
    test('uses the display ratio when it is under the ceiling', () => {
      setDpr(2);
      expect(resolvePixelRatio(3)).toBe(2);
    });

    test('caps at the ceiling on a 3x or 4x phone screen', () => {
      setDpr(4);
      expect(resolvePixelRatio(2)).toBe(2);
    });

    test('defaults the ceiling to 2', () => {
      setDpr(3);
      expect(resolvePixelRatio()).toBe(DEFAULT_MAX_PIXEL_RATIO);
    });

    test('never renders below CSS resolution', () => {
      setDpr(0.5);
      expect(resolvePixelRatio(2)).toBe(0.5);

      // A ceiling under 1 is nonsense and must not shrink the backing store.
      setDpr(2);
      expect(resolvePixelRatio(0.25)).toBe(DEFAULT_MAX_PIXEL_RATIO);
    });

    test('falls back to 1 when the display reports nothing usable', () => {
      setDpr(undefined);
      expect(resolvePixelRatio(2)).toBe(1);

      setDpr(Number.NaN);
      expect(resolvePixelRatio(2)).toBe(1);

      setDpr(0);
      expect(resolvePixelRatio(2)).toBe(1);
    });
  });

  describe('pixelRatioOf', () => {
    test('treats a context without a ratio as 1:1', () => {
      expect(pixelRatioOf({})).toBe(1);
      expect(pixelRatioOf({ pixelRatio: undefined })).toBe(1);
    });

    test('rejects a nonsense ratio rather than scaling by it', () => {
      expect(pixelRatioOf({ pixelRatio: 0 })).toBe(1);
      expect(pixelRatioOf({ pixelRatio: Number.NaN })).toBe(1);
      expect(pixelRatioOf({ pixelRatio: -2 })).toBe(1);
    });

    test('passes a real ratio through', () => {
      expect(pixelRatioOf({ pixelRatio: 2 })).toBe(2);
    });
  });

  describe('createTileCanvas', () => {
    test('sizes the backing store by the ratio but keeps the CSS size', () => {
      const canvas = createTileCanvas(document, '3:1:2', 256, 2);

      expect(canvas.width).toBe(512);
      expect(canvas.height).toBe(512);
      expect(canvas.style.width).toBe('256px');
      expect(canvas.style.height).toBe('256px');
      expect(canvas.id).toBe('3:1:2');
    });

    test('is a plain 1:1 canvas at ratio 1', () => {
      const canvas = createTileCanvas(document, 'a', 256, 1);

      expect(canvas.width).toBe(256);
      expect(canvas.style.width).toBe('256px');
    });

    test('rounds a fractional ratio to whole pixels', () => {
      const canvas = createTileCanvas(document, 'a', 256, 1.5);
      expect(canvas.width).toBe(384);
      expect(Number.isInteger(canvas.width)).toBe(true);
    });
  });

  describe('getTileContext2D', () => {
    test('applies the device-pixel transform', () => {
      const canvas = createTileCanvas(document, 'a', 256, 2);
      const setTransform = jest.fn();
      jest.spyOn(canvas, 'getContext').mockReturnValue({ setTransform } as unknown as CanvasRenderingContext2D);

      getTileContext2D({ canvas, pixelRatio: 2 });

      expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    });

    test('sets rather than multiplies, so repeated acquisition does not compound', () => {
      const canvas = createTileCanvas(document, 'a', 256, 2);
      const setTransform = jest.fn();
      const scale = jest.fn();
      jest.spyOn(canvas, 'getContext').mockReturnValue({ setTransform, scale } as unknown as CanvasRenderingContext2D);

      getTileContext2D({ canvas, pixelRatio: 2 });
      getTileContext2D({ canvas, pixelRatio: 2 });

      expect(scale).not.toHaveBeenCalled();
      expect(setTransform).toHaveBeenNthCalledWith(1, 2, 0, 0, 2, 0, 0);
      expect(setTransform).toHaveBeenNthCalledWith(2, 2, 0, 0, 2, 0, 0);
    });

    test('returns null when the canvas has no 2d context', () => {
      const canvas = document.createElement('canvas');
      jest.spyOn(canvas, 'getContext').mockReturnValue(null);

      expect(getTileContext2D({ canvas })).toBeNull();
    });
  });

  describe('toDevicePixels', () => {
    test('scales a CSS-pixel hit-test point into canvas pixels', () => {
      expect(toDevicePixels(128, 2)).toBe(256);
      expect(toDevicePixels(128, 1)).toBe(128);
    });
  });

  describe('clearTileCanvas', () => {
    test('clears the whole backing store with the transform reset', () => {
      const canvas = createTileCanvas(document, 'a', 256, 2);
      const context = {
        save: jest.fn(),
        restore: jest.fn(),
        setTransform: jest.fn(),
        clearRect: jest.fn(),
      };
      jest.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

      clearTileCanvas(canvas);

      expect(context.save).toHaveBeenCalled();
      expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
      // Device pixels, not CSS pixels: a 256px tile at ratio 2 is 512 across.
      expect(context.clearRect).toHaveBeenCalledWith(0, 0, 512, 512);
      expect(context.restore).toHaveBeenCalled();
    });

    test('is a no-op when there is no context', () => {
      const canvas = document.createElement('canvas');
      jest.spyOn(canvas, 'getContext').mockReturnValue(null);

      expect(() => clearTileCanvas(canvas)).not.toThrow();
    });
  });
});
