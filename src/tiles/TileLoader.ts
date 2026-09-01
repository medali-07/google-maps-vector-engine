import { createLogger } from '../DebugLogger';
import { TileContext, TileCoord, TileManifest, TileAvailabilitySource } from '../types';

/** Why a tile failed, as reported to `onFailed` and the `tileerror` event. */
export interface TileFailureReason {
  /** HTTP status, when the failure was an HTTP error response. */
  status?: number;
  error?: unknown;
}

/** Carries the HTTP status through the promise chain to the failure handler. */
class TileHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TileHttpError';
  }
}

export interface TileLoaderCallbacks {
  /** A tile body arrived and should be decoded and drawn. */
  onResponse(tileContext: TileContext, body: ArrayBuffer): void;
  /** The tile settled, successfully or not. Drives tileLoaded(). */
  onSettled(tileId: string): void;
  /** The tile is unavailable or exhausted its retries. */
  /**
   * @param reason Why it failed. `status` is present only for an HTTP error;
   *   a manifest miss, a network error and a timeout all arrive without one.
   */
  onFailed(tileContext: TileContext, reason: TileFailureReason): void;
  /** True once the owning source has been disposed. */
  isDisposed(): boolean;
}

/**
 * Fetches vector tiles, with cancellation, timeout, bounded retry, and
 * availability filtering against an optional manifest.
 *
 * Extracted from MVTSource, which mixed the HTTP client in with rendering and
 * state. Keeping it separate is what makes the abort and retry paths testable
 * without a map.
 */
export class TileLoader {
  static readonly TIMEOUT_MS = 30000;
  static readonly MAX_RETRIES = 2;
  static readonly RETRY_BASE_MS = 500;

  private logger = createLogger('TileLoader');

  /** In-flight requests, so they can be aborted on release and dispose. */
  private _requests: Map<string, AbortController> = new Map();

  /** Pending retry timers by tile id, cancelled on release and dispose. A
   *  retry that only checked for disposal could re-fetch — and fully revive
   *  the state of — a tile Google Maps had already released. */
  private _retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private _manifestSource?: TileAvailabilitySource;
  private _resolvedManifest?: TileManifest;

  constructor(
    private _url: string,
    private _headers: Record<string, string>,
    private _callbacks: TileLoaderCallbacks,
    manifest?: TileAvailabilitySource,
  ) {
    this._manifestSource = manifest;
  }

  setUrl(url: string): void {
    this._url = url;
  }

  // ---------------------------------------------------------------------------
  // Manifest
  // ---------------------------------------------------------------------------

  async initializeManifest(): Promise<void> {
    if (!this._manifestSource) {
      // Clear rather than return: setManifest(undefined) is the documented way
      // to remove a manifest, and returning early left the previous one
      // resolved, so tiles stayed filtered with no way to un-filter them.
      this._resolvedManifest = undefined;
      return;
    }

    try {
      if (typeof this._manifestSource === 'function') {
        this._resolvedManifest = await this._manifestSource();
        this.logger.info('Manifest loaded from API:', Object.keys(this._resolvedManifest || {}).length, 'zoom levels');
      } else {
        this._resolvedManifest = this._manifestSource;
        this.logger.info(
          'Manifest loaded from static data:',
          Object.keys(this._resolvedManifest || {}).length,
          'zoom levels',
        );
      }
    } catch (error) {
      this.logger.warn('Failed to load tile availability manifest:', error);
      this._resolvedManifest = undefined;
    }
  }

  async setManifest(manifest?: TileAvailabilitySource): Promise<void> {
    this._manifestSource = manifest;
    await this.initializeManifest();
  }

  getManifest(): TileManifest | undefined {
    return this._resolvedManifest;
  }

  /**
   * True when the manifest says this tile exists, or when there is no manifest.
   */
  isTileAvailable(z: number, x: number, y: number): boolean {
    if (!this._resolvedManifest) {
      this.logger.log(`No manifest available yet, allowing tile: ${z}/${x}/${y}`);
      return true;
    }

    const zoomLevel = z.toString();
    const xCoordinate = x.toString();

    if (!this._resolvedManifest[zoomLevel]) {
      this.logger.log(`Zoom level ${z} not found in manifest, rejecting tile: ${z}/${x}/${y}`);
      return false;
    }

    if (!this._resolvedManifest[zoomLevel][xCoordinate]) {
      this.logger.log(`X coordinate ${x} not found in manifest for zoom ${z}, rejecting tile: ${z}/${x}/${y}`);
      return false;
    }

    const yRanges = this._resolvedManifest[zoomLevel][xCoordinate];
    const isAvailable = yRanges.some(([yStart, yEnd]) => y >= yStart && y <= yEnd);

    if (isAvailable) {
      this.logger.log(`Tile ${z}/${x}/${y} is available according to manifest`);
    } else {
      this.logger.log(`Tile ${z}/${x}/${y} not in available Y ranges: ${JSON.stringify(yRanges)}`);
    }

    return isAvailable;
  }

  // ---------------------------------------------------------------------------
  // Fetching
  // ---------------------------------------------------------------------------

  /** Abort an in-flight request for a tile, if any, and cancel its retry. */
  abort(tileId: string): void {
    const controller = this._requests.get(tileId);
    if (controller) {
      controller.abort();
      this._requests.delete(tileId);
    }
    const retryTimer = this._retryTimers.get(tileId);
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      this._retryTimers.delete(tileId);
    }
  }

  /** Abort every in-flight request and cancel pending retries. */
  abortAll(): void {
    this._requests.forEach((controller) => controller.abort());
    this._requests.clear();
    this._retryTimers.forEach(clearTimeout);
    this._retryTimers.clear();
  }

  /** Tile requests currently in flight. */
  get pendingCount(): number {
    return this._requests.size;
  }

  /**
   * Fetch a tile. `tileCoord` is the coordinate to request, which is the parent
   * tile when overzooming.
   */
  fetch(tileContext: TileContext, tileCoord: TileCoord, attempt = 0): void {
    const { z, x, y } = tileCoord;

    if (!this.isTileAvailable(z, x, y)) {
      this.logger.log(`Tile not available according to manifest: ${z}/${x}/${y}`);
      this._callbacks.onSettled(tileContext.id);
      this._callbacks.onFailed(tileContext, { error: new Error(`Tile ${z}/${x}/${y} is absent from the manifest`) });
      return;
    }

    const src = this._url.replace('{z}', z.toString()).replace('{x}', x.toString()).replace('{y}', y.toString());

    this.logger.log(`Requesting tile: ${src}`);

    this.abort(tileContext.id);
    const controller = new AbortController();
    this._requests.set(tileContext.id, controller);

    const timeoutId = setTimeout(() => controller.abort(), TileLoader.TIMEOUT_MS);

    fetch(src, { headers: this._headers, signal: controller.signal })
      .then(async (response) => {
        clearTimeout(timeoutId);
        this.logger.log(`Tile response: ${response.status} for ${src}`);

        // 204/304 are the conventional "nothing here" responses and are not
        // failures; previously anything but 200 was silently blank.
        if (response.status === 204 || response.status === 304) {
          this._settle(tileContext.id, controller);
          return;
        }

        if (!response.ok) {
          throw new TileHttpError(response.status, `HTTP ${response.status} ${response.statusText}`);
        }

        const body = await response.arrayBuffer();
        if (this._isStale(tileContext.id, controller)) return;

        this._callbacks.onResponse(tileContext, body);
        this._settle(tileContext.id, controller);
      })
      .catch((error: unknown) => {
        clearTimeout(timeoutId);

        // A deliberate cancellation is not an error. A timeout also aborts, but
        // leaves this controller registered, which is how the two are told apart.
        if (controller.signal.aborted && !this._callbacks.isDisposed()) {
          const timedOut = this._requests.get(tileContext.id) === controller;
          if (!timedOut) return;
        }
        if (this._callbacks.isDisposed()) return;

        if (attempt < TileLoader.MAX_RETRIES) {
          const backoff = TileLoader.RETRY_BASE_MS * Math.pow(2, attempt);
          this.logger.warn(`Tile ${src} failed (attempt ${attempt + 1}), retrying in ${backoff}ms`);
          const retryTimer = setTimeout(() => {
            this._retryTimers.delete(tileContext.id);
            if (!this._callbacks.isDisposed()) this.fetch(tileContext, tileCoord, attempt + 1);
          }, backoff);
          this._retryTimers.set(tileContext.id, retryTimer);
          return;
        }

        // Previously every non-200 was completely silent in production: the
        // only failure path was debug drawing, which no-ops when debug is off.
        this.logger.error(`Failed to load tile ${src}:`, error);
        this._settle(tileContext.id, controller);
        this._callbacks.onFailed(tileContext, {
          status: error instanceof TileHttpError ? error.status : undefined,
          error,
        });
      });
  }

  /**
   * True when a response should be discarded because the source was disposed,
   * or the tile was released or re-requested while this request was in flight.
   */
  private _isStale(tileId: string, controller: AbortController): boolean {
    if (this._callbacks.isDisposed()) return true;
    return this._requests.get(tileId) !== controller;
  }

  private _settle(tileId: string, controller: AbortController): void {
    if (this._requests.get(tileId) === controller) {
      this._requests.delete(tileId);
    }
    this._callbacks.onSettled(tileId);
  }
}
