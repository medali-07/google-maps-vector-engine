// The network path: availability filtering, status handling, cancellation,
// timeout and bounded retry. It sat at 24% branch coverage, which is a poor
// place for the only code in the library that talks to a server.

import { TileLoader, TileLoaderCallbacks, TileFailureReason } from '../../src/tiles/TileLoader';
import { TileContext } from '../../src/types';

const tileContext = (id = '10:1:2'): TileContext => ({
  id,
  canvas: document.createElement('canvas'),
  zoom: 10,
  tileSize: 256,
});

const coord = (z = 10, x = 1, y = 2): { z: number; x: number; y: number } => ({ z, x, y });

interface Harness {
  loader: TileLoader;
  onResponse: jest.Mock;
  onSettled: jest.Mock;
  onFailed: jest.Mock;
  disposed: { value: boolean };
}

const makeLoader = (url = 'https://tiles.test/{z}/{x}/{y}.pbf', manifest?: any): Harness => {
  const onResponse = jest.fn();
  const onSettled = jest.fn();
  const onFailed = jest.fn();
  const disposed = { value: false };

  const callbacks: TileLoaderCallbacks = {
    onResponse,
    onSettled,
    onFailed,
    isDisposed: () => disposed.value,
  };

  return {
    loader: new TileLoader(url, { 'X-Test': '1' }, callbacks, manifest),
    onResponse,
    onSettled,
    onFailed,
    disposed,
  };
};

/** Resolve a fetch with the given status and body. */
const respond = (status: number, body = new ArrayBuffer(8)): jest.Mock =>
  jest.fn(() =>
    Promise.resolve({
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      ok: status >= 200 && status < 300,
      arrayBuffer: () => Promise.resolve(body),
    }),
  );

/** Let the pending fetch promise chain drain. */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('TileLoader', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('url templating', () => {
    test('substitutes z, x and y', () => {
      const fetchMock = respond(200);
      global.fetch = fetchMock as any;
      const { loader } = makeLoader();

      loader.fetch(tileContext(), coord(7, 63, 42));

      expect(fetchMock.mock.calls[0][0]).toBe('https://tiles.test/7/63/42.pbf');
    });

    test('sends the configured headers and an abort signal', () => {
      const fetchMock = respond(200);
      global.fetch = fetchMock as any;
      const { loader } = makeLoader();

      loader.fetch(tileContext(), coord());

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.headers).toEqual({ 'X-Test': '1' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    test('setUrl redirects later requests', () => {
      const fetchMock = respond(200);
      global.fetch = fetchMock as any;
      const { loader } = makeLoader();

      loader.setUrl('https://other.test/{z}/{x}/{y}.mvt');
      loader.fetch(tileContext(), coord(1, 2, 3));

      expect(fetchMock.mock.calls[0][0]).toBe('https://other.test/1/2/3.mvt');
    });
  });

  describe('responses', () => {
    test('hands a 200 body to onResponse and settles', async () => {
      const body = new ArrayBuffer(16);
      global.fetch = respond(200, body) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      await flush();

      expect(h.onResponse).toHaveBeenCalledWith(expect.objectContaining({ id: '10:1:2' }), body);
      expect(h.onSettled).toHaveBeenCalledWith('10:1:2');
      expect(h.onFailed).not.toHaveBeenCalled();
    });

    test('treats 204 as an empty tile, not a failure', async () => {
      // Anything but 200 used to be silently blank; 204 is the conventional
      // "nothing here" response and must settle cleanly.
      global.fetch = respond(204) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      await flush();

      expect(h.onSettled).toHaveBeenCalledWith('10:1:2');
      expect(h.onFailed).not.toHaveBeenCalled();
      expect(h.onResponse).not.toHaveBeenCalled();
    });

    test('treats 304 the same way', async () => {
      global.fetch = respond(304) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      await flush();

      expect(h.onSettled).toHaveBeenCalled();
      expect(h.onFailed).not.toHaveBeenCalled();
    });

    test('a settled request is no longer counted as pending', async () => {
      global.fetch = respond(200) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      expect(h.loader.pendingCount).toBe(1);

      await flush();
      expect(h.loader.pendingCount).toBe(0);
    });

    test('discards a response for a tile that was released mid-flight', async () => {
      global.fetch = respond(200) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      h.loader.abort('10:1:2');
      await flush();

      expect(h.onResponse).not.toHaveBeenCalled();
    });

    test('discards a response once the source is disposed', async () => {
      global.fetch = respond(200) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      h.disposed.value = true;
      await flush();

      expect(h.onResponse).not.toHaveBeenCalled();
    });
  });

  describe('failures and retry', () => {
    test('retries an HTTP error with backoff, then reports it', async () => {
      jest.useFakeTimers();
      const fetchMock = respond(500);
      global.fetch = fetchMock as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());

      // MAX_RETRIES is 2, so three attempts in total.
      for (let attempt = 0; attempt < TileLoader.MAX_RETRIES; attempt++) {
        await flush();
        jest.advanceTimersByTime(TileLoader.RETRY_BASE_MS * Math.pow(2, attempt));
      }
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(TileLoader.MAX_RETRIES + 1);
      expect(h.onFailed).toHaveBeenCalledTimes(1);
    });

    test('reports the HTTP status on the failure', async () => {
      jest.useFakeTimers();
      global.fetch = respond(404) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      for (let attempt = 0; attempt < TileLoader.MAX_RETRIES; attempt++) {
        await flush();
        jest.advanceTimersByTime(TileLoader.RETRY_BASE_MS * Math.pow(2, attempt));
      }
      await flush();

      const reason = h.onFailed.mock.calls[0][1] as TileFailureReason;
      expect(reason.status).toBe(404);
      expect(reason.error).toBeInstanceOf(Error);
    });

    test('a network error carries no status', async () => {
      jest.useFakeTimers();
      global.fetch = jest.fn(() => Promise.reject(new Error('network down'))) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      for (let attempt = 0; attempt < TileLoader.MAX_RETRIES; attempt++) {
        await flush();
        jest.advanceTimersByTime(TileLoader.RETRY_BASE_MS * Math.pow(2, attempt));
      }
      await flush();

      const reason = h.onFailed.mock.calls[0][1] as TileFailureReason;
      expect(reason.status).toBeUndefined();
    });

    test('stops retrying once the source is disposed', async () => {
      jest.useFakeTimers();
      const fetchMock = respond(500);
      global.fetch = fetchMock as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      await flush();
      h.disposed.value = true;
      jest.advanceTimersByTime(10_000);
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(h.onFailed).not.toHaveBeenCalled();
    });

    test('a deliberate abort is not reported as an error', async () => {
      const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
      global.fetch = jest.fn(() => Promise.reject(abortError)) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      h.loader.abort('10:1:2');
      await flush();

      expect(h.onFailed).not.toHaveBeenCalled();
    });
  });

  describe('cancellation', () => {
    test('abort cancels the in-flight request for one tile', () => {
      global.fetch = jest.fn(() => new Promise(() => {})) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal;

      h.loader.abort('10:1:2');

      expect(signal.aborted).toBe(true);
      expect(h.loader.pendingCount).toBe(0);
    });

    test('abort is a no-op for a tile with nothing in flight', () => {
      const h = makeLoader();
      expect(() => h.loader.abort('nope')).not.toThrow();
    });

    test('abortAll cancels every request and pending retry', () => {
      jest.useFakeTimers();
      global.fetch = jest.fn(() => new Promise(() => {})) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext('10:1:1'), coord(10, 1, 1));
      h.loader.fetch(tileContext('10:2:2'), coord(10, 2, 2));
      expect(h.loader.pendingCount).toBe(2);

      const signals = (global.fetch as jest.Mock).mock.calls.map((c) => c[1].signal as AbortSignal);
      h.loader.abortAll();

      expect(signals.every((s) => s.aborted)).toBe(true);
      expect(h.loader.pendingCount).toBe(0);
    });

    test('re-fetching the same tile aborts the previous attempt', () => {
      global.fetch = jest.fn(() => new Promise(() => {})) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      const first = (global.fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal;

      h.loader.fetch(tileContext(), coord());

      expect(first.aborted).toBe(true);
      expect(h.loader.pendingCount).toBe(1);
    });

    test('a timeout aborts the request', () => {
      jest.useFakeTimers();
      global.fetch = jest.fn(() => new Promise(() => {})) as any;
      const h = makeLoader();

      h.loader.fetch(tileContext(), coord());
      const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal;

      jest.advanceTimersByTime(TileLoader.TIMEOUT_MS);

      expect(signal.aborted).toBe(true);
    });
  });

  describe('availability manifest', () => {
    const manifest = { '10': { '1': [[0, 5] as [number, number]] } };

    test('allows every tile when there is no manifest', () => {
      const { loader } = makeLoader();
      expect(loader.isTileAvailable(10, 1, 2)).toBe(true);
    });

    test('accepts a static manifest and filters by it', async () => {
      const { loader } = makeLoader('https://tiles.test/{z}/{x}/{y}.pbf', manifest);
      await loader.initializeManifest();

      expect(loader.isTileAvailable(10, 1, 2)).toBe(true);
      expect(loader.isTileAvailable(10, 1, 5)).toBe(true);
      expect(loader.isTileAvailable(10, 1, 6)).toBe(false);
      expect(loader.isTileAvailable(10, 9, 2)).toBe(false);
      expect(loader.isTileAvailable(11, 1, 2)).toBe(false);
    });

    test('accepts a manifest returned by a function', async () => {
      const { loader } = makeLoader('https://tiles.test/{z}/{x}/{y}.pbf', () => Promise.resolve(manifest));
      await loader.initializeManifest();

      expect(loader.getManifest()).toEqual(manifest);
      expect(loader.isTileAvailable(10, 1, 3)).toBe(true);
    });

    test('degrades to allowing everything when the manifest fails to load', async () => {
      // A manifest endpoint being down must not blank the whole map.
      const { loader } = makeLoader('https://tiles.test/{z}/{x}/{y}.pbf', () =>
        Promise.reject(new Error('manifest 500')),
      );
      await loader.initializeManifest();

      expect(loader.getManifest()).toBeUndefined();
      expect(loader.isTileAvailable(10, 1, 2)).toBe(true);
    });

    test('setManifest replaces the manifest in place', async () => {
      const { loader } = makeLoader();
      await loader.setManifest(manifest);
      expect(loader.isTileAvailable(10, 1, 6)).toBe(false);

      await loader.setManifest(undefined);
      expect(loader.isTileAvailable(10, 1, 6)).toBe(true);
    });

    test('an unavailable tile fails without hitting the network', async () => {
      const fetchMock = respond(200);
      global.fetch = fetchMock as any;
      const h = makeLoader('https://tiles.test/{z}/{x}/{y}.pbf', manifest);
      await h.loader.initializeManifest();

      h.loader.fetch(tileContext('10:1:9'), coord(10, 1, 9));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(h.onSettled).toHaveBeenCalledWith('10:1:9');
      expect(h.onFailed).toHaveBeenCalled();
      expect((h.onFailed.mock.calls[0][1] as TileFailureReason).status).toBeUndefined();
    });
  });
});
