/**
 * Enhanced debug logger with colors, groups, and performance monitoring
 */
export class DebugLogger {
  private static instance: DebugLogger;
  private debugEnabled: boolean = false;
  private readonly COLORS = {
    RESET: '\x1b[0m',
    BRIGHT: '\x1b[1m',
    DIM: '\x1b[2m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    WHITE: '\x1b[37m',
    GRAY: '\x1b[90m'
  };

  private constructor() {}

  public static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger();
    }
    return DebugLogger.instance;
  }

  public setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
    if (enabled) {
      this.group('🚀 MVT Debug Mode Enabled', () => {
        this.info('Logger initialized with enhanced debugging features');
        this.info('Available methods: log, info, warn, error, group, time, table');
      });
    }
  }

  public isDebugEnabled(): boolean {
    return this.debugEnabled;
  }

  private formatMessage(level: string, color: string, ...args: any[]): any[] {
    if (!this.debugEnabled && level !== 'error') return [];
    
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `${color}[${timestamp}] ${level}${this.COLORS.RESET}`;
    
    return [prefix, ...args];
  }

  public log(...args: any[]): void {
    if (!this.debugEnabled) return;
    const formatted = this.formatMessage('DEBUG', this.COLORS.CYAN, ...args);
    if (formatted.length) console.log(...formatted);
  }

  public info(...args: any[]): void {
    if (!this.debugEnabled) return;
    const formatted = this.formatMessage('INFO', this.COLORS.BLUE, ...args);
    if (formatted.length) console.info(...formatted);
  }

  public warn(...args: any[]): void {
    if (!this.debugEnabled) return;
    const formatted = this.formatMessage('WARN', this.COLORS.YELLOW, ...args);
    if (formatted.length) console.warn(...formatted);
  }

  public error(...args: any[]): void {
    const formatted = this.formatMessage('ERROR', this.COLORS.RED, ...args);
    console.error(...formatted);
  }

  /**
   * Create a collapsible group for related log messages
   */
  public group(label: string, callback?: () => void): void {
    if (!this.debugEnabled) return;
    
    console.group(`${this.COLORS.BRIGHT}${this.COLORS.MAGENTA}📁 ${label}${this.COLORS.RESET}`);
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
    console.time(`${this.COLORS.GREEN}⏱️  ${label}${this.COLORS.RESET}`);
  }

  public timeEnd(label: string): void {
    if (!this.debugEnabled) return;
    console.timeEnd(`${this.COLORS.GREEN}⏱️  ${label}${this.COLORS.RESET}`);
  }

  /**
   * Display data in table format
   */
  public table(data: any, columns?: string[]): void {
    if (!this.debugEnabled) return;
    console.table(data, columns);
  }

  /**
   * Create an enhanced prefixed logger with performance monitoring
   */
  public createPrefixedLogger(prefix: string) {
    const prefixColor = this.getComponentColor(prefix);
    const coloredPrefix = `${prefixColor}[${prefix}]${this.COLORS.RESET}`;
    
    return {
      log: (...args: any[]) => {
        if (this.debugEnabled) {
          console.log(coloredPrefix, ...args);
        }
      },
      info: (...args: any[]) => {
        if (this.debugEnabled) {
          console.info(coloredPrefix, ...args);
        }
      },
      warn: (...args: any[]) => {
        if (this.debugEnabled) {
          console.warn(coloredPrefix, ...args);
        }
      },
      error: (...args: any[]) => {
        console.error(coloredPrefix, ...args);
      },
      group: (label: string, callback?: () => void) => {
        this.group(`${prefix}: ${label}`, callback);
      },
      time: (label: string) => this.time(`${prefix}: ${label}`),
      timeEnd: (label: string) => this.timeEnd(`${prefix}: ${label}`),
      table: (data: any, columns?: string[]) => this.table(data, columns),
      performance: {
        measureTileLoad: (tileId: string) => {
          this.time(`Tile Load: ${tileId}`);
          return () => this.timeEnd(`Tile Load: ${tileId}`);
        },
        measureFeatureRender: (count: number) => {
          this.time(`Feature Render: ${count} features`);
          return () => this.timeEnd(`Feature Render: ${count} features`);
        }
      }
    };
  }

  /**
   * Assign consistent colors to different components
   */
  private getComponentColor(prefix: string): string {
    const colorMap: { [key: string]: string } = {
      'MVTSource': this.COLORS.CYAN,
      'MVTLayer': this.COLORS.GREEN,
      'MVTFeature': this.COLORS.YELLOW,
      'Mercator': this.COLORS.BLUE,
      'ColorUtils': this.COLORS.MAGENTA,
    };
    
    return colorMap[prefix] || this.COLORS.WHITE;
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
