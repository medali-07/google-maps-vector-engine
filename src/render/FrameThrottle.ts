/**
 * Leading-edge throttle with a trailing flush, frame-aligned by default.
 *
 * Replaces the trailing-only debounce that used to gate hover. A debounce
 * re-arms its timer on every call, so under continuous mouse movement at 60 to
 * 120Hz it never fires at all: hover only appeared once the pointer came to a
 * complete stop. A throttle fires immediately on the first event and then at
 * most once per interval, so hover tracks the pointer while it is moving.
 *
 * With `intervalMs` at 0 the interval is one animation frame, which both
 * bounds the work to the display's refresh rate and stops it entirely while
 * the tab is backgrounded.
 */
export class FrameThrottle<T> {
  private _pending: T | null = null;
  private _hasPending = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _frame: number | null = null;
  /** -Infinity rather than 0: "never run yet" has to be independent of where
   *  the injected clock's origin happens to be, or the very first event misses
   *  the leading edge whenever that clock starts near zero. */
  private _lastRun = Number.NEGATIVE_INFINITY;

  /**
   * @param _run       Invoked with the most recent value.
   * @param _intervalMs Minimum gap between runs; 0 means one frame.
   * @param _now       Clock, injectable so tests need not stub globals.
   */
  constructor(
    private _run: (value: T) => void,
    private _intervalMs = 0,
    private _now: () => number = () => Date.now(),
  ) {}

  /** True while a trailing run is still owed. */
  get hasPending(): boolean {
    return this._hasPending;
  }

  /**
   * Submit a value. Runs it immediately when the interval has elapsed,
   * otherwise holds it for the trailing run, replacing any value already held.
   */
  submit(value: T): void {
    if (this._intervalMs <= 0) {
      this._pending = value;
      this._hasPending = true;
      this._armFrame();
      return;
    }

    const elapsed = this._now() - this._lastRun;
    if (elapsed >= this._intervalMs && !this._hasPending) {
      this._lastRun = this._now();
      this._run(value);
      return;
    }

    this._pending = value;
    this._hasPending = true;
    this._armTimer(Math.max(0, this._intervalMs - elapsed));
  }

  /** Run any held value now, without waiting for the interval. */
  flush(): void {
    this._disarm();
    this._fire();
  }

  /** Drop any held value and cancel the pending run. */
  cancel(): void {
    this._disarm();
    this._pending = null;
    this._hasPending = false;
  }

  private _armFrame(): void {
    if (this._frame !== null) return;

    if (typeof requestAnimationFrame !== 'function') {
      this._armTimer(0);
      return;
    }

    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this._fire();
    });
  }

  private _armTimer(delay: number): void {
    if (this._timer !== null) return;

    this._timer = setTimeout(() => {
      this._timer = null;
      this._fire();
    }, delay);
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

  private _fire(): void {
    if (!this._hasPending) return;

    const value = this._pending as T;
    this._pending = null;
    this._hasPending = false;
    this._lastRun = this._now();
    this._run(value);
  }
}
