import { FrameThrottle } from '../../src/render/FrameThrottle';

describe('FrameThrottle', () => {
  let run: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    run = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('frame-aligned mode (interval 0)', () => {
    test('coalesces a burst into one run with the newest value', () => {
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      throttle.submit('b');
      throttle.submit('c');
      expect(run).not.toHaveBeenCalled();

      jest.advanceTimersByTime(16);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith('c');
    });

    test('runs again on the next frame after the first fires', () => {
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      jest.advanceTimersByTime(16);
      throttle.submit('b');
      jest.advanceTimersByTime(16);

      expect(run).toHaveBeenCalledTimes(2);
      expect(run).toHaveBeenLastCalledWith('b');
    });

    test('does not run again when nothing new was submitted', () => {
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      jest.advanceTimersByTime(160);

      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe('interval mode', () => {
    test('runs on the leading edge, without waiting', () => {
      const throttle = new FrameThrottle<string>(run, 50, () => Date.now());

      throttle.submit('a');

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith('a');
    });

    test('keeps firing under continuous input instead of starving', () => {
      // The behaviour that regressed hover: a trailing-only debounce re-armed
      // on every event, so a pointer moving at 60Hz never let it fire at all.
      let clock = 0;
      const throttle = new FrameThrottle<number>(run, 50, () => clock);

      for (let i = 0; i < 20; i++) {
        clock += 16;
        throttle.submit(i);
        jest.advanceTimersByTime(16);
      }

      // 20 events across 320ms at a 50ms interval: several runs, not zero.
      expect(run.mock.calls.length).toBeGreaterThan(3);
    });

    test('holds the newest value for the trailing run', () => {
      let clock = 0;
      const throttle = new FrameThrottle<string>(run, 50, () => clock);

      throttle.submit('first');
      expect(run).toHaveBeenCalledWith('first');

      clock = 10;
      throttle.submit('second');
      clock = 20;
      throttle.submit('third');
      expect(run).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(50);

      expect(run).toHaveBeenCalledTimes(2);
      expect(run).toHaveBeenLastCalledWith('third');
    });
  });

  describe('flush and cancel', () => {
    test('flush runs the held value immediately', () => {
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      throttle.flush();

      expect(run).toHaveBeenCalledWith('a');

      // The frame that was already armed must not fire a second time.
      jest.advanceTimersByTime(100);
      expect(run).toHaveBeenCalledTimes(1);
    });

    test('flush with nothing held is a no-op', () => {
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.flush();

      expect(run).not.toHaveBeenCalled();
    });

    test('cancel drops the held value', () => {
      const throttle = new FrameThrottle<string>(run, 0);

      throttle.submit('a');
      throttle.cancel();
      jest.advanceTimersByTime(1000);

      expect(run).not.toHaveBeenCalled();
      expect(throttle.hasPending).toBe(false);
    });

    test('reports whether a run is owed', () => {
      const throttle = new FrameThrottle<string>(run, 0);

      expect(throttle.hasPending).toBe(false);
      throttle.submit('a');
      expect(throttle.hasPending).toBe(true);

      jest.advanceTimersByTime(16);
      expect(throttle.hasPending).toBe(false);
    });
  });
});
