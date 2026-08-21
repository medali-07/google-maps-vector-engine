// Phase 3 rendering regressions on MVTFeature: fillOpacity, which was
// declared and documented but never read, and hit testing under a device-pixel
// transform.

import { MVTFeature } from '../../src/MVTFeature';
import { GeometryType, MVTFeatureOptions } from '../../src/types';
import {
  createMockMVTSource,
  createMockVectorTileFeature,
  createMockTileContext,
  createMockCanvasContext,
} from '../utils/mockData';

const buildFeature = (
  style: MVTFeatureOptions['style'],
  tileContext: any,
  type: GeometryType = GeometryType.Polygon,
): MVTFeature => {
  const mVTSource = createMockMVTSource();
  // Style resolution belongs to StyleResolver; here the feature's own style is
  // what must reach the canvas.
  mVTSource.getStyleForFeature = undefined;

  return new MVTFeature({
    mVTSource,
    vectorTileFeature: createMockVectorTileFeature({ id: 'f', type }),
    tileContext,
    style,
    selected: false,
    featureId: 'f',
    customDraw: false,
  });
};

describe('MVTFeature rendering', () => {
  describe('fillOpacity', () => {
    test('multiplies into the fill colour instead of being ignored', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);

      const feature = buildFeature({ fillStyle: 'rgba(0, 100, 200, 0.5)', fillOpacity: 0.5 }, tileContext);
      feature.draw(tileContext);

      expect(context.fillStyle).toBe('rgba(0, 100, 200, 0.25)');
    });

    test('leaves the fill alone when no opacity is set', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);

      const feature = buildFeature({ fillStyle: 'rgba(0, 100, 200, 0.5)' }, tileContext);
      feature.draw(tileContext);

      expect(context.fillStyle).toBe('rgba(0, 100, 200, 0.5)');
    });

    test('an opacity of 0 renders a fully transparent fill', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);

      const feature = buildFeature({ fillStyle: '#0072B2', fillOpacity: 0 }, tileContext);
      feature.draw(tileContext);

      expect(context.fillStyle).toBe('rgba(0, 114, 178, 0)');
    });
  });

  describe('device-pixel transform', () => {
    test('drawing applies the tile ratio to the context', () => {
      const tileContext = createMockTileContext({ pixelRatio: 2 });
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);

      const feature = buildFeature({ fillStyle: 'red' }, tileContext);
      feature.draw(tileContext);

      expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    });

    test('hit testing scales the query point by the same ratio', () => {
      // isPointInPath treats its coordinates as untransformed canvas pixels
      // while the path is scaled by the context transform. Without scaling the
      // point by hand, every click on a retina screen lands in the wrong place.
      const tileContext = createMockTileContext({ pixelRatio: 2 });
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);

      const feature = buildFeature({ fillStyle: 'red' }, tileContext);
      feature.isPointInPath({ x: 10, y: 20 }, tileContext);

      expect(context.isPointInPath).toHaveBeenCalledWith(expect.anything(), 20, 40);
    });

    test('a 1:1 tile passes the point through untouched', () => {
      const tileContext = createMockTileContext();
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);

      const feature = buildFeature({ fillStyle: 'red' }, tileContext);
      feature.isPointInPath({ x: 10, y: 20 }, tileContext);

      expect(context.isPointInPath).toHaveBeenCalledWith(expect.anything(), 10, 20);
    });

    test('a non-polygon is never hit tested against a path', () => {
      const tileContext = createMockTileContext({ pixelRatio: 2 });
      const context = createMockCanvasContext();
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(context);

      const feature = buildFeature({ strokeStyle: 'red' }, tileContext, GeometryType.LineString);

      expect(feature.isPointInPath({ x: 10, y: 20 }, tileContext)).toBe(false);
      expect(context.isPointInPath).not.toHaveBeenCalled();
    });
  });

  describe('style context', () => {
    test('the style function receives the zoom and tile being drawn', () => {
      const tileContext = createMockTileContext({ zoom: 14 });
      jest.spyOn(tileContext.canvas, 'getContext').mockReturnValue(createMockCanvasContext());

      const mVTSource = createMockMVTSource();
      const getStyleForFeature = jest.fn(() => ({ fillStyle: 'red' }));
      mVTSource.getStyleForFeature = getStyleForFeature;

      const feature = new MVTFeature({
        mVTSource,
        vectorTileFeature: createMockVectorTileFeature({ id: 'f' }),
        tileContext,
        style: {},
        selected: false,
        featureId: 'f',
        customDraw: false,
      });

      feature.draw(tileContext);

      expect(getStyleForFeature).toHaveBeenCalledWith(expect.anything(), 'f', {
        zoom: 14,
        tileContext,
      });
    });
  });
});
