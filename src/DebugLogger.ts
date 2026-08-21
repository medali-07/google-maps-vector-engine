/**
 * Enhanced debug logger with colors, groups, and performance monitoring
 */
export class DebugLogger {
  private static instance: DebugLogger;

  /**
   * How many live sources have asked for debug output.
   *
   * A plain boolean meant that constructing a second source with
   * `debug: false` called `setDebug(false)` and silently turned debugging off
   * for the first one. Counting requests instead means debug stays on for as
   * long as anything still wants it.
   */
  private _debugRequests = 0;

  /** Set by `setDebug`, which remains available for direct callers. */
  private _forced: boolean | null = null;

  /**
   * Browser consoles do not interpret ANSI escapes; they print them as
   * literal `[36m` garbage in front of every message. They do understand
   * `%c` with a CSS string, so colour is expressed that way there and with
   * ANSI only in a real terminal.
   */
  private readonly _useAnsi = typeof window === 'undefined' && typeof document === 'undefined';

  private readonly CSS = {
    RED: 'color:#D55E00',
    GREEN: 'color:#009E73',
    YELLOW: 'color:#E69F00',
    BLUE: 'color:#0072B2',
    MAGENTA: 'color:#CC79A7;font-weight:bold',
    CYAN: 'color:#56B4E9',
    WHITE: '',
  };

  private readonly ANSI = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    WHITE: '\x1b[37m',
  };

  private constructor() {}

  private get debugEnabled(): boolean {
    return this._forced ?? this._debugRequests > 0;
  }

  /**
   * Format a label so it colours correctly in whichever console is listening.
   *
   * Returns the arguments to spread into a console call: either one
   * ANSI-wrapped string, or a `%c` format string plus its CSS.
   */
  private _label(text: string, key: keyof typeof this.CSS): string[] {
    if (this._useAnsi) {
      return [`${this.ANSI[key]}${text}${this.ANSI.RESET}`];
    }
    return [`%c${text}`, this.CSS[key]];
  }

  public static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger();
    }
    return DebugLogger.instance;
  }

  /**
   * Force debug output on or off, overriding what any source has requested.
   *
   * Pass `null` to hand control back to the per-source requests.
   */
  public setDebug(enabled: boolean | null): void {
    this._forced = enabled;
    if (this.debugEnabled) this._announce();
  }

  /**
   * Register a source's interest in debug output.
   *
   * @returns A function that withdraws it again, called on dispose.
   */
  public requestDebug(): () => void {
    const wasEnabled = this.debugEnabled;
    this._debugRequests++;
    if (!wasEnabled && this.debugEnabled) this._announce();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._debugRequests = Math.max(0, this._debugRequests - 1);
    };
  }

  private _announce(): void {
    this.group('MVT debug mode enabled', () => {
      this.info('Available methods: log, info, warn, error, group, time, table');
    });
  }

  public isDebugEnabled(): boolean {
    return this.debugEnabled;
  }

  private _write(
    method: 'log' | 'info' | 'warn' | 'error',
    level: string,
    key: 'CYAN' | 'BLUE' | 'YELLOW' | 'RED',
    ...args: unknown[]
  ): void {
    const timestamp = new Date().toLocaleTimeString();
    console[method](...this._label(`[${timestamp}] ${level}`, key), ...args);
  }

  public log(...args: unknown[]): void {
    if (!this.debugEnabled) return;
    this._write('log', 'DEBUG', 'CYAN', ...args);
  }

  public info(...args: unknown[]): void {
    if (!this.debugEnabled) return;
    this._write('info', 'INFO', 'BLUE', ...args);
  }

  public warn(...args: unknown[]): void {
    if (!this.debugEnabled) return;
    this._write('warn', 'WARN', 'YELLOW', ...args);
  }

  /**
   * Report an error.
   *
   * Deliberately not gated on the debug flag: a failure a consumer has no
   * other way of hearing about should not be silent just because debugging is
   * off. Recoverable, expected conditions go through `warn` instead, and tile
   * failures are also delivered as a `tileerror` event that can be handled
   * rather than merely read in a console.
   */
  public error(...args: unknown[]): void {
    this._write('error', 'ERROR', 'RED', ...args);
  }

  /**
   * Create a collapsible group for related log messages
   */
  public group(label: string, callback?: () => void): void {
    if (!this.debugEnabled) return;

    console.group(...this._label(label, 'MAGENTA'));
    if (callback) {
      try {
        callback();
      } finally {
        console.groupEnd();
      }
    }
  }

  public groupEnd(): void {
    if (!this.debugEnabled) return;
    console.groupEnd();
  }

  /**
   * Performance timing utilities
   */
  public time(label: string): void {
    if (!this.debugEnabled) return;
    // console.time keys on the exact label, so it gets a plain one: a %c
    // format string would make time and timeEnd disagree.
    console.time(label);
  }

  public timeEnd(label: string): void {
    if (!this.debugEnabled) return;
    console.timeEnd(label);
  }

  /**
   * Display data in table format
   */
  public table(data: unknown, columns?: string[]): void {
    if (!this.debugEnabled) return;
    console.table(data, columns);
  }

  /**
   * Create an enhanced prefixed logger with performance monitoring
   */
  public createPrefixedLogger(prefix: string) {
    const key = this.getComponentColor(prefix);
    const label = (): string[] => this._label(`[${prefix}]`, key);

    return {
      log: (...args: unknown[]) => {
        if (this.debugEnabled) console.log(...label(), ...args);
      },
      info: (...args: unknown[]) => {
        if (this.debugEnabled) console.info(...label(), ...args);
      },
      warn: (...args: unknown[]) => {
        if (this.debugEnabled) console.warn(...label(), ...args);
      },
      error: (...args: unknown[]) => {
        console.error(...label(), ...args);
      },
      group: (groupLabel: string, callback?: () => void) => {
        this.group(`${prefix}: ${groupLabel}`, callback);
      },
      time: (timeLabel: string) => this.time(`${prefix}: ${timeLabel}`),
      timeEnd: (timeLabel: string) => this.timeEnd(`${prefix}: ${timeLabel}`),
      table: (data: unknown, columns?: string[]) => this.table(data, columns),
      performance: {
        measureTileLoad: (tileId: string) => {
          this.time(`Tile Load: ${tileId}`);
          return () => this.timeEnd(`Tile Load: ${tileId}`);
        },
        measureFeatureRender: (count: number) => {
          this.time(`Feature Render: ${count} features`);
          return () => this.timeEnd(`Feature Render: ${count} features`);
        },
      },
    };
  }

  /**
   * Assign consistent colors to different components
   */
  private getComponentColor(prefix: string): keyof typeof this.CSS {
    const colorMap: Record<string, keyof typeof this.CSS> = {
      MVTSource: 'CYAN',
      MVTLayer: 'GREEN',
      MVTFeature: 'YELLOW',
      Mercator: 'BLUE',
      ColorUtils: 'MAGENTA',
    };

    return colorMap[prefix] || 'WHITE';
  }
}

/**
 * Convenience function to get the debug logger instance
 */
export const debugLogger = DebugLogger.getInstance();

/**
 * Create a prefixed logger for a specific component
 */
export const createLogger = (prefix: string) => debugLogger.createPrefixedLogger(prefix);
