// The setTimeout fallbacks both schedulers take when requestAnimationFrame is
// absent - server-side rendering, and older test runners. They are the only
// paths in the render modules the normal suite never reaches, because jsdom
// always provides rAF.

import { RedrawScheduler } from '../../src/render/RedrawScheduler';
import { FrameThrottle } from '../../src/render/FrameThrottle';

describe('scheduling without requestAnimationFrame', () => {
  const realRaf = global.requestAnimationFrame;
  const realCancel = global.cancelAnimationFrame;

  beforeEach(() => {
    jest.useFakeTimers();
    // @ts-expect-error - deliberately removing the global for this suite
    delete global.requestAnimationFrame;
    // @ts-expect-error - deliberately removing the global for this suite
    delete global.cancelAnimationFrame;
  });

  afterEach(() => {
    global.requestAnimationFrame = realRaf;
    global.cancelAnimationFrame = realCancel;
    jest.useRealTimers();
  });

  describe('RedrawScheduler', () => {
    test('falls back to a timer and still flushes', () => {
      const flush = jest.fn();
      const scheduler = new RedrawScheduler(flush, 16);

      scheduler.schedule('a');
      expect(flush).not.toHaveBeenCalled();

      jest.advanceTimersByTime(16);

      expect(flush).toHaveBeenCalledWith(['a']);
    });

    test('is still a throttle, not a debounce, on the timer path', () => {
      const flush = jest.fn();
      const scheduler = new RedrawScheduler(flush, 16);

      scheduler.schedule('a');
      jest.advanceTimersByTime(10);
      scheduler.schedule('b');
      jest.advanceTimersByTime(6);

      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush.mock.calls[0][0].sort()).toEqual(['a', 'b']);
    });

    test('flushNow clears the pending timer', () => {
      const flush = jest.fn();
      const scheduler = new RedrawScheduler(flush, 16);

      scheduler.schedule('a');
      scheduler.flushNow();
      jest.advanceTimersByTime(100);

      expect(flush).toHaveBeenCalledTimes(1);
    });

    test('dispose cancels the pending timer', () => {
      const flush = jest.fn();
      const scheduler = new RedrawScheduler(flush, 16);

      scheduler.schedule('a');
      scheduler.dispose();
      jest.advanceTimersByTime(100);

      expect(flush).not.toHaveBeenCalled();
    });
  });

  describe('FrameThrottle', () => {
    test('falls back to a zero-delay timer', () => {
      const run = jest.fn();
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      expect(run).not.toHaveBeenCalled();

      jest.advanceTimersByTime(0);

      expect(run).toHaveBeenCalledWith('a');
    });

    test('still coalesces a burst on the timer path', () => {
      const run = jest.fn();
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      throttle.submit('b');
      throttle.submit('c');
      jest.advanceTimersByTime(0);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith('c');
    });

    test('cancel clears the pending timer', () => {
      const run = jest.fn();
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      throttle.cancel();
      jest.advanceTimersByTime(100);

      expect(run).not.toHaveBeenCalled();
    });

    test('flush runs immediately and cancels the timer', () => {
      const run = jest.fn();
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      throttle.flush();
      jest.advanceTimersByTime(100);

      expect(run).toHaveBeenCalledTimes(1);
    });
  });
});

describe('scheduling with cancelAnimationFrame missing', () => {
  const realCancel = global.cancelAnimationFrame;

  beforeEach(() => {
    jest.useFakeTimers();
    // rAF present, cancel absent: an odd but real combination in some polyfills.
    // @ts-expect-error - deliberately removing the global for this suite
    delete global.cancelAnimationFrame;
  });

  afterEach(() => {
    global.cancelAnimationFrame = realCancel;
    jest.useRealTimers();
  });

  test('RedrawScheduler disposes without throwing', () => {
    const flush = jest.fn();
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.schedule('a');

    expect(() => scheduler.dispose()).not.toThrow();
  });

  test('FrameThrottle cancels without throwing', () => {
    const run = jest.fn();
    const throttle = new FrameThrottle<string>(run, 0);

    throttle.submit('a');

    expect(() => throttle.cancel()).not.toThrow();
  });
});
