import { createLogger } from '../DebugLogger';

/**
 * Minimal typed event emitter.
 *
 * Kept in-house rather than pulled from npm: the whole surface is `on`, `off`,
 * `once` and `emit`, and a runtime dependency for that would be larger than
 * the code it replaces.
 *
 * A listener that throws is logged and skipped rather than allowed to abort
 * the dispatch - one consumer's bad handler must not stop the others from
 * being told, and must not take down a tile-load path with it.
 */
export class EventEmitter<TEvents> {
  private logger = createLogger('EventEmitter');
  private _listeners = new Map<keyof TEvents, Set<(payload: never) => void>>();

  /**
   * Subscribe to an event.
   *
   * @returns An unsubscribe function, so a caller can drop the listener
   *   without having to keep the original reference around.
   */
  on<K extends keyof TEvents>(event: K, listener: (payload: TEvents[K]) => void): () => void {
    let handlers = this._listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this._listeners.set(event, handlers);
    }
    handlers.add(listener as (payload: never) => void);

    return () => this.off(event, listener);
  }

  /** Subscribe until the event fires once, then unsubscribe. */
  once<K extends keyof TEvents>(event: K, listener: (payload: TEvents[K]) => void): () => void {
    const wrapped = (payload: TEvents[K]): void => {
      this.off(event, wrapped);
      listener(payload);
    };

    return this.on(event, wrapped);
  }

  /**
   * Remove a listener, or every listener for an event when none is given.
   *
   * `off()` with no arguments at all removes everything.
   */
  off<K extends keyof TEvents>(event?: K, listener?: (payload: TEvents[K]) => void): void {
    if (event === undefined) {
      this._listeners.clear();
      return;
    }

    const handlers = this._listeners.get(event);
    if (!handlers) return;

    if (listener === undefined) {
      this._listeners.delete(event);
      return;
    }

    handlers.delete(listener as (payload: never) => void);
    if (handlers.size === 0) {
      this._listeners.delete(event);
    }
  }

  /** Number of listeners registered for an event. */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return this._listeners.get(event)?.size ?? 0;
  }

  /** Dispatch an event to every current listener. */
  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const handlers = this._listeners.get(event);
    if (!handlers || handlers.size === 0) return;

    // Iterate a copy: a listener is allowed to unsubscribe itself, or add
    // another, without disturbing this dispatch.
    for (const handler of Array.from(handlers)) {
      try {
        (handler as (payload: TEvents[K]) => void)(payload);
      } catch (error) {
        this.logger.error(`Listener for "${String(event)}" threw:`, error);
      }
    }
  }

  /** Drop every listener. */
  dispose(): void {
    this._listeners.clear();
  }
}
