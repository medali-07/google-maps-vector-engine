import { EventEmitter } from '../../src/events/EventEmitter';

interface TestEvents {
  ping: { value: number };
  pong: void;
}

describe('EventEmitter', () => {
  let emitter: EventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEvents>();
  });

  test('delivers a payload to a listener', () => {
    const listener = jest.fn();
    emitter.on('ping', listener);

    emitter.emit('ping', { value: 1 });

    expect(listener).toHaveBeenCalledWith({ value: 1 });
  });

  test('supports more than one listener for the same event', () => {
    // The whole point of the emitter: constructor callbacks allowed exactly
    // one handler, which could never be added to, removed, or replaced.
    const first = jest.fn();
    const second = jest.fn();
    emitter.on('ping', first);
    emitter.on('ping', second);

    emitter.emit('ping', { value: 2 });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('does not deliver events to other event names', () => {
    const listener = jest.fn();
    emitter.on('ping', listener);

    emitter.emit('pong', undefined);

    expect(listener).not.toHaveBeenCalled();
  });

  describe('unsubscribing', () => {
    test('on returns a function that removes the listener', () => {
      const listener = jest.fn();
      const stop = emitter.on('ping', listener);

      stop();
      emitter.emit('ping', { value: 1 });

      expect(listener).not.toHaveBeenCalled();
    });

    test('off removes a specific listener and leaves the rest', () => {
      const kept = jest.fn();
      const dropped = jest.fn();
      emitter.on('ping', kept);
      emitter.on('ping', dropped);

      emitter.off('ping', dropped);
      emitter.emit('ping', { value: 1 });

      expect(kept).toHaveBeenCalled();
      expect(dropped).not.toHaveBeenCalled();
    });

    test('off with just an event removes every listener for it', () => {
      const a = jest.fn();
      const b = jest.fn();
      emitter.on('ping', a);
      emitter.on('ping', b);

      emitter.off('ping');
      emitter.emit('ping', { value: 1 });

      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
    });

    test('off with no arguments removes everything', () => {
      const ping = jest.fn();
      const pong = jest.fn();
      emitter.on('ping', ping);
      emitter.on('pong', pong);

      emitter.off();
      emitter.emit('ping', { value: 1 });
      emitter.emit('pong', undefined);

      expect(ping).not.toHaveBeenCalled();
      expect(pong).not.toHaveBeenCalled();
    });

    test('removing an unknown listener is a no-op', () => {
      expect(() => emitter.off('ping', jest.fn())).not.toThrow();
    });
  });

  describe('once', () => {
    test('fires exactly once', () => {
      const listener = jest.fn();
      emitter.once('ping', listener);

      emitter.emit('ping', { value: 1 });
      emitter.emit('ping', { value: 2 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ value: 1 });
    });

    test('can be cancelled before it fires', () => {
      const listener = jest.fn();
      const stop = emitter.once('ping', listener);

      stop();
      emitter.emit('ping', { value: 1 });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('robustness', () => {
    test('a listener that throws does not stop the others', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      const after = jest.fn();
      emitter.on('ping', () => {
        throw new Error('handler blew up');
      });
      emitter.on('ping', after);

      expect(() => emitter.emit('ping', { value: 1 })).not.toThrow();
      expect(after).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    test('a listener may unsubscribe itself mid-dispatch', () => {
      const second = jest.fn();
      const stop = emitter.on('ping', () => stop());
      emitter.on('ping', second);

      expect(() => emitter.emit('ping', { value: 1 })).not.toThrow();
      expect(second).toHaveBeenCalled();
    });

    test('a listener added during dispatch does not fire in that dispatch', () => {
      const late = jest.fn();
      emitter.on('ping', () => emitter.on('ping', late));

      emitter.emit('ping', { value: 1 });

      expect(late).not.toHaveBeenCalled();
    });
  });

  test('reports how many listeners an event has', () => {
    expect(emitter.listenerCount('ping')).toBe(0);
    const stop = emitter.on('ping', jest.fn());
    expect(emitter.listenerCount('ping')).toBe(1);
    stop();
    expect(emitter.listenerCount('ping')).toBe(0);
  });

  test('dispose drops every listener', () => {
    const listener = jest.fn();
    emitter.on('ping', listener);

    emitter.dispose();
    emitter.emit('ping', { value: 1 });

    expect(listener).not.toHaveBeenCalled();
  });
});
