import { createLogger } from '../DebugLogger';

/**
 * Batches tile redraws so a burst of state changes produces one repaint.
 *
 * Extracted from MVTSource. Holds no knowledge of tiles beyond their ids; the
 * owner supplies the flush callback.
 *
 * Scheduling is frame-aligned: work lands on `requestAnimationFrame`, so it
 * runs once per displayed frame and stops entirely while the tab is
 * backgrounded. `setTimeout` is only the fallback for environments with no
 * rAF, which is really just server-side rendering and older test runners.
 */
export class RedrawScheduler {
  /** Fallback interval when requestAnimationFrame is unavailable (~1 frame). */
  static readonly DEBOUNCE_MS = 16;

  private logger = createLogger('RedrawScheduler');
  private _pending: Set<string> = new Set();
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _frame: number | null = null;

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
    this._disarm();
    this._execute();
  }

  /** Cancel the pending frame and discard the queue. */
  dispose(): void {
    this._disarm();
    this._pending.clear();
  }

  /**
   * Arm the next flush.
   *
   * Deliberately a throttle, not a debounce: an already-armed frame is left
   * alone rather than cancelled and re-armed. Re-arming meant that a state
   * change arriving every frame - a drag, or hover over dense geometry - kept
   * pushing the flush out and starved the repaint indefinitely.
   */
  private _arm(): void {
    if (this._frame !== null || this._timer !== null) return;

    if (typeof requestAnimationFrame === 'function') {
      this._frame = requestAnimationFrame(() => {
        this._frame = null;
        this._execute();
      });
      return;
    }

    this._timer = setTimeout(() => {
      this._timer = null;
      this._execute();
    }, this._debounceMs);
  }

  private _disarm(): void {
    if (this._frame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _execute(): void {
    if (this._pending.size === 0) return;

    this.logger.log(`Executing ${this._pending.size} pending redraws`);

    const tileIds = Array.from(this._pending);
    this._pending.clear();
    this._flush(tileIds);
  }
}
