// The last of MVTSource's uncovered branches: the hover-delay timer, batch
// selection, event conversion when the map is not ready, and the paths that
// only run the second time round.

import fs from 'fs';
import path from 'path';
import { MVTSource } from '../../src/MVTSource';

const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.pbf'));
const URL = 'https://tiles.test/{z}/{x}/{y}.pbf';

const latLng = (lat: number, lng: number): any => ({ lat: () => lat, lng: () => lng });

const makeMap = (overrides: Record<string, unknown> = {}): any => ({
  overlayMapTypes: { getArray: () => [], removeAt: jest.fn(), push: jest.fn(), insertAt: jest.fn() },
  data: {
    addListener: () => ({ remove: jest.fn() }),
    remove: jest.fn(),
    addGeoJson: () => [{ setProperty: jest.fn() }],
    overrideStyle: jest.fn(),
  },
  addListener: () => ({ remove: jest.fn() }),
  setOptions: jest.fn(),
  fitBounds: jest.fn(),
  getZoom: () => 10,
  getBounds: () => ({ getNorthEast: () => latLng(85, 180), getSouthWest: () => latLng(-85, -180) }),
  getProjection: () => ({ fromLatLngToPoint: () => ({ x: 128, y: 128 }) }),
  ...overrides,
});

const point = (x: number, y: number): any => ({ x, y });

const respondWithFixture = (): jest.Mock =>
  jest.fn(() =>
    Promise.resolve({
      status: 200,
      statusText: 'OK',
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(FIXTURE.buffer.slice(FIXTURE.byteOffset, FIXTURE.byteOffset + FIXTURE.byteLength)),
    }),
  );

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('MVTSource edges', () => {
  let source: MVTSource | undefined;

  beforeEach(() => {
    global.fetch = respondWithFixture() as any;
  });

  afterEach(() => {
    source?.dispose();
    source = undefined;
  });

  describe('event conversion', () => {
    test('returns nothing when the projection is not ready yet', () => {
      source = new MVTSource(makeMap({ getProjection: () => undefined }), { url: URL });

      expect((source as any)._convertToMVTEvent({ latLng: latLng(0, 0) })).toBeNull();
    });

    test('returns nothing when the map has no bounds yet', () => {
      source = new MVTSource(makeMap({ getBounds: () => undefined }), { url: URL });

      expect((source as any)._convertToMVTEvent({ latLng: latLng(0, 0) })).toBeNull();
    });

    test('returns nothing when the event carries no latLng', () => {
      source = new MVTSource(makeMap(), { url: URL });

      expect((source as any)._convertToMVTEvent({})).toBeNull();
    });

    test('produces a pixel point when everything is ready', () => {
      source = new MVTSource(makeMap(), { url: URL });

      const event = (source as any)._convertToMVTEvent({ latLng: latLng(0, 0) });

      expect(event.pixel).toBeDefined();
      expect(event.latLng).toBeDefined();
    });

    test('treats an undefined zoom as 0 rather than producing NaN', () => {
      source = new MVTSource(makeMap({ getZoom: () => undefined }), { url: URL });

      const event = (source as any)._convertToMVTEvent({ latLng: latLng(0, 0) });

      expect(Number.isNaN(event.pixel.x)).toBe(false);
    });
  });

  describe('hover delay', () => {
    test('defers the hit test by the configured delay', () => {
      jest.useFakeTimers();
      try {
        source = new MVTSource(makeMap(), { url: URL, hoverDelay: 200 });
        const run = jest.spyOn(source as any, '_mouseEventContinue').mockImplementation(() => {});
        const event = { latLng: latLng(0, 0), pixel: point(1, 1) };

        (source as any)._mouseEvent(event, undefined, { delay: 200 });
        expect(run).not.toHaveBeenCalled();

        jest.advanceTimersByTime(200);
        expect(run).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    test('a newer event supersedes the one still waiting', () => {
      jest.useFakeTimers();
      try {
        source = new MVTSource(makeMap(), { url: URL, hoverDelay: 200 });
        const run = jest.spyOn(source as any, '_mouseEventContinue').mockImplementation(() => {});

        (source as any)._mouseEvent({ latLng: latLng(0, 0), pixel: point(1, 1) }, undefined, { delay: 200 });
        (source as any)._mouseEvent({ latLng: latLng(1, 1), pixel: point(2, 2) }, undefined, { delay: 200 });
        jest.advanceTimersByTime(200);

        expect(run).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    test('a delay of zero runs synchronously', () => {
      source = new MVTSource(makeMap(), { url: URL });
      const run = jest.spyOn(source as any, '_mouseEventContinue').mockImplementation(() => {});

      (source as any)._mouseEvent({ latLng: latLng(0, 0), pixel: point(1, 1) }, undefined, { delay: 0 });

      expect(run).toHaveBeenCalled();
    });

    test('an event with no pixel or latLng is dropped', () => {
      source = new MVTSource(makeMap(), { url: URL });
      const run = jest.spyOn(source as any, '_mouseEventContinue').mockImplementation(() => {});

      (source as any)._mouseEvent({}, undefined, { delay: 0 });
      (source as any)._mouseEvent({ latLng: latLng(0, 0) }, undefined, { delay: 0 });

      expect(run).not.toHaveBeenCalled();
    });

    test('a deferred hit test is abandoned after dispose', () => {
      jest.useFakeTimers();
      try {
        source = new MVTSource(makeMap(), { url: URL, hoverDelay: 200 });
        const run = jest.spyOn(source as any, '_mouseEventContinue').mockImplementation(() => {});

        (source as any)._mouseEvent({ latLng: latLng(0, 0), pixel: point(1, 1) }, undefined, { delay: 200 });
        source.dispose();
        source = undefined;
        jest.advanceTimersByTime(200);

        expect(run).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('hover state transitions', () => {
    test('setting hover on an already-hovered feature does not thrash', async () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(512, 512), 10, document);
      await flush();

      (source as any)._setFeatureHover(1, true);
      (source as any)._setFeatureHover(1, true);
      expect(source.getStats().hoveredFeatures).toBe(1);

      (source as any)._setFeatureHover(1, false);
      expect(source.getStats().hoveredFeatures).toBe(0);

      // Clearing something already clear is a no-op.
      (source as any)._setFeatureHover(1, false);
      expect(source.getStats().hoveredFeatures).toBe(0);
    });

    test('hovering an unknown feature is harmless', () => {
      source = new MVTSource(makeMap(), { url: URL });

      expect(() => (source as any)._setFeatureHover('ghost', true)).not.toThrow();
    });
  });

  describe('batch selection', () => {
    test('selecting many at once ends in the right state', async () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(512, 512), 10, document);
      await flush();

      source.setSelection([1, 2, 10, 11]);

      expect(source.getSelectedFeatureIds()).toHaveLength(4);
      expect(source.getStats().selectedFeatures).toBe(4);
    });

    test('removing ids that are not selected changes nothing', async () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(512, 512), 10, document);
      await flush();
      source.setSelection([1]);

      source.setSelection([99, 98], { mode: 'remove' });

      expect(source.getSelectedFeatureIds()).toEqual([1]);
    });

    test('adding ids that are already selected changes nothing', async () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(512, 512), 10, document);
      await flush();
      source.setSelection([1]);

      source.setSelection([1], { mode: 'add' });

      expect(source.getSelectedFeatureIds()).toEqual([1]);
    });

    test('selecting ids for features not yet loaded is remembered', () => {
      source = new MVTSource(makeMap(), { url: URL });

      source.setSelection(['not-loaded-yet']);

      expect(source.isFeatureSelected('not-loaded-yet')).toBe(true);
      expect(source.getSelectedFeatures()).toHaveLength(0);
    });

    test('selectedFeatures given at construction are applied', () => {
      source = new MVTSource(makeMap(), { url: URL, selectedFeatures: ['a', 'b'] });

      expect(source.getSelectedFeatureIds().sort()).toEqual(['a', 'b']);
    });
  });

  describe('feature index', () => {
    test('registerFeature and unregisterFeature maintain the index', async () => {
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(512, 512), 10, document);
      await flush();
      const feature = source.getFeature(1)!;

      source.unregisterFeature(1);
      expect(source.getFeature(1)).toBeUndefined();

      source.registerFeature(feature);
      expect(source.getFeature(1)).toBe(feature);
    });

    test('unregistering clears hover but preserves selection', async () => {
      // Selection must survive a tile being released, or panning loses it.
      source = new MVTSource(makeMap(), { url: URL });
      source.getTile(point(512, 512), 10, document);
      await flush();
      source.setSelection([1]);
      (source as any)._setFeatureHover(1, true);

      source.unregisterFeature(1);

      expect(source.isFeatureSelected(1)).toBe(true);
      expect(source.isFeatureHovered(1)).toBe(false);
    });
  });

  describe('setStyle deferred redraw', () => {
    test('schedules a redraw on the next turn when asked to', () => {
      jest.useFakeTimers();
      try {
        source = new MVTSource(makeMap(), { url: URL });
        const schedule = jest.spyOn(source as any, '_scheduleRedraw');

        source.setStyle({ fillStyle: 'red' }, true);
        expect(schedule).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(schedule).toHaveBeenCalledWith('all');
      } finally {
        jest.useRealTimers();
      }
    });

    test('the deferred redraw is cancelled by dispose', () => {
      jest.useFakeTimers();
      try {
        source = new MVTSource(makeMap(), { url: URL });
        const schedule = jest.spyOn(source as any, '_scheduleRedraw');

        source.setStyle({ fillStyle: 'red' }, true);
        source.dispose();
        source = undefined;
        jest.advanceTimersByTime(10);

        expect(schedule).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('fractional zoom', () => {
    test('accepts a response while the map reports a fractional zoom', async () => {
      // Vector basemaps report fractional zoom during a smooth transition.
      source = new MVTSource(makeMap({ getZoom: () => 10.4 }), { url: URL });
      source.getTile(point(1, 2), 10, document);
      await flush();

      expect(source.getStats().features).toBeGreaterThan(0);
    });

    test('still rejects a response for a genuinely different zoom', async () => {
      source = new MVTSource(makeMap({ getZoom: () => 12 }), { url: URL });
      source.getTile(point(1, 2), 10, document);
      await flush();

      expect(source.getStats().features).toBe(0);
    });
  });
});
