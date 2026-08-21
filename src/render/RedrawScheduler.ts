import { createLogger } from '../DebugLogger';

/**
 * Batches tile redraws so a burst of state changes produces one repaint.
 *
 * Extracted from MVTSource. Holds no knowledge of tiles beyond their ids; the
 * owner supplies the flush callback.
 */
export class RedrawScheduler {
  /** ~1 frame at 60fps. */
  static readonly DEBOUNCE_MS = 16;

  private logger = createLogger('RedrawScheduler');
  private _pending: Set<string> = new Set();
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private _flush: (tileIds: string[]) => void,
    private _debounceMs: number = RedrawScheduler.DEBOUNCE_MS,
  ) {}

  /** Tile ids awaiting a redraw. */
  get pendingCount(): number {
    return this._pending.size;
  }

  /** Queue a single tile. */
  schedule(tileId: string): void {
    this._pending.add(tileId);
    this._arm();
  }

  /** Queue several tiles at once. */
  scheduleMany(tileIds: Iterable<string>): void {
    for (const tileId of tileIds) {
      this._pending.add(tileId);
    }
    this._arm();
  }

  /** Drop a tile from the queue, e.g. when it is released. */
  cancel(tileId: string): void {
    this._pending.delete(tileId);
  }

  /** Run any queued redraws immediately. */
  flushNow(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._execute();
  }

  /** Cancel the timer and discard the queue. */
  dispose(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pending.clear();
  }

  private _arm(): void {
    if (this._timer) {
      clearTimeout(this._timer);
    }

    this._timer = setTimeout(() => {
      this._timer = null;
      this._execute();
    }, this._debounceMs);
  }

  private _execute(): void {
    if (this._pending.size === 0) return;

    this.logger.log(`Executing ${this._pending.size} pending redraws`);

    const tileIds = Array.from(this._pending);
    this._pending.clear();
    this._flush(tileIds);
  }
}
