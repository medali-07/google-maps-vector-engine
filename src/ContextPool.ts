import { FeatureStyle } from './types';

interface ContextState {
  context: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  lastStyleHash: string;
  available: boolean;
  createdAt: number;
}

/**
 * Canvas context pool for efficient context reuse and state management
 */
export class ContextPool {
  private static _instance: ContextPool | null = null;
  private _pool: ContextState[] = [];
  private _maxPoolSize: number;
  private _inUse: Set<CanvasRenderingContext2D> = new Set();

  constructor(maxPoolSize: number = 20) {
    this._maxPoolSize = maxPoolSize;
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ContextPool {
    if (!ContextPool._instance) {
      ContextPool._instance = new ContextPool();
    }
    return ContextPool._instance;
  }

  /**
   * Acquire a context for a canvas with given style
   */
  acquire(canvas: HTMLCanvasElement, style: FeatureStyle, styleHash: string): CanvasRenderingContext2D {
    // Try to find an available context for this canvas with matching style
    let contextState = this._findAvailableContext(canvas, styleHash);

    if (!contextState) {
      // Create new context if none available
      const context = canvas.getContext('2d')!;
      contextState = {
        context,
        canvas,
        lastStyleHash: styleHash,
        available: false,
        createdAt: Date.now()
      };

      this._applyStyleToContext(context, style);
      
      if (this._pool.length < this._maxPoolSize) {
        this._pool.push(contextState);
      }
    } else {
      if (contextState.lastStyleHash !== styleHash) {
        this._applyStyleToContext(contextState.context, style);
        contextState.lastStyleHash = styleHash;
      }
    }

    contextState.available = false;
    this._inUse.add(contextState.context);
    
    return contextState.context;
  }

  /**
   * Release a context back to the pool
   */
  release(context: CanvasRenderingContext2D): void {
    this._inUse.delete(context);
    
    const contextState = this._pool.find(cs => cs.context === context);
    if (contextState) {
      contextState.available = true;
    }
  }

  private _findAvailableContext(canvas: HTMLCanvasElement, styleHash: string): ContextState | null {
    let match = this._pool.find(cs => 
      cs.available && 
      cs.canvas === canvas && 
      cs.lastStyleHash === styleHash
    );

    if (match) return match;

    match = this._pool.find(cs => 
      cs.available && 
      cs.canvas === canvas
    );

    if (match) return match;

    return this._pool.find(cs => cs.available) || null;
  }

  /**
   * Apply style properties to context
   */
  private _applyStyleToContext(context: CanvasRenderingContext2D, style: FeatureStyle): void {
    if (style.fillStyle) {
      context.fillStyle = style.fillStyle;
    }

    if (style.strokeStyle) {
      context.strokeStyle = style.strokeStyle;
    }

    if (style.lineWidth !== undefined) {
      context.lineWidth = style.lineWidth;
    }

    context.lineCap = 'round';
    context.lineJoin = 'round';
  }

  /**
   * Create style hash for context state tracking
   */
  static createStyleHash(style: FeatureStyle): string {
    return [
      style.fillStyle ?? '',
      style.fillOpacity?.toString() ?? '',
      style.strokeStyle ?? '',
      style.lineWidth?.toString() ?? '',
      style.radius?.toString() ?? '',
    ].join('|');
  }

  /**
   * Clean up old contexts and optimize pool
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000;

    this._pool = this._pool.filter(cs => {
      if (cs.available && (now - cs.createdAt) > maxAge) {
        return false;
      }
      return true;
    });

    if (this._pool.length > this._maxPoolSize) {
      const availableContexts = this._pool.filter(cs => cs.available);
      const toRemove = availableContexts.slice(0, availableContexts.length - Math.floor(this._maxPoolSize * 0.7));
      
      toRemove.forEach(cs => {
        const index = this._pool.indexOf(cs);
        if (index > -1) {
          this._pool.splice(index, 1);
        }
      });
    }
  }

  /**
   * Get pool statistics for debugging
   */
  getStats(): { total: number; available: number; inUse: number } {
    const available = this._pool.filter(cs => cs.available).length;
    return {
      total: this._pool.length,
      available,
      inUse: this._inUse.size,
    };
  }

  /**
   * Clear the entire pool
   */
  clear(): void {
    this._pool.length = 0;
    this._inUse.clear();
  }
}
