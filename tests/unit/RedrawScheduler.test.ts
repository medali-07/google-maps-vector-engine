import { RedrawScheduler } from '../../src/render/RedrawScheduler';

describe('RedrawScheduler', () => {
  let flush: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    flush = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('coalesces a burst into a single flush', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.schedule('a');
    scheduler.schedule('b');
    scheduler.schedule('a');

    expect(flush).not.toHaveBeenCalled();
    jest.advanceTimersByTime(16);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0].sort()).toEqual(['a', 'b']);
  });

  test('does not flush before the frame lands', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.schedule('a');
    jest.advanceTimersByTime(15);
    expect(flush).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  test('keeps flushing under continuous scheduling instead of starving', () => {
    // This is why it is a throttle and not a debounce: the old version
    // cancelled and re-armed its timer on every schedule, so a state change
    // arriving every frame - a drag, or hover across dense geometry - pushed
    // the repaint out indefinitely and the map stopped updating.
    const scheduler = new RedrawScheduler(flush, 16);

    for (let i = 0; i < 10; i++) {
      scheduler.schedule(`tile-${i}`);
      jest.advanceTimersByTime(16);
    }

    expect(flush.mock.calls.length).toBeGreaterThan(1);
  });

  test('an already-armed frame is not pushed back by further scheduling', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.schedule('a');
    jest.advanceTimersByTime(10);
    scheduler.schedule('b');
    jest.advanceTimersByTime(6);

    // Both tiles land in the frame that was armed by the *first* schedule.
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0][0].sort()).toEqual(['a', 'b']);
  });

  test('clears the queue after flushing, so a second frame is a no-op', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.schedule('a');
    jest.advanceTimersByTime(16);
    jest.advanceTimersByTime(100);

    expect(flush).toHaveBeenCalledTimes(1);
  });

  test('cancel removes a tile before the flush', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.scheduleMany(['a', 'b']);
    scheduler.cancel('a');
    jest.advanceTimersByTime(16);

    expect(flush).toHaveBeenCalledWith(['b']);
  });

  test('cancelling every queued tile skips the flush entirely', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.schedule('a');
    scheduler.cancel('a');
    jest.advanceTimersByTime(16);

    expect(flush).not.toHaveBeenCalled();
  });

  test('flushNow runs immediately without waiting', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.schedule('a');
    scheduler.flushNow();

    expect(flush).toHaveBeenCalledWith(['a']);

    // The pending timer must not fire a second time.
    jest.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  test('dispose cancels the pending frame and drops the queue', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    scheduler.schedule('a');
    scheduler.dispose();
    jest.advanceTimersByTime(1000);

    expect(flush).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(0);
  });

  test('reports how many tiles are queued', () => {
    const scheduler = new RedrawScheduler(flush, 16);

    expect(scheduler.pendingCount).toBe(0);
    scheduler.scheduleMany(['a', 'b', 'a']);
    expect(scheduler.pendingCount).toBe(2);
  });
});
