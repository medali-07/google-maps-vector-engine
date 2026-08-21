// The parts of DebugLogger the existing suite never reached: the debug gate,
// the per-source refcount that replaced the process-global boolean, and the
// group/time/table helpers.

import { DebugLogger, createLogger, debugLogger } from '../../src/DebugLogger';

describe('DebugLogger', () => {
  const spies: jest.SpyInstance[] = [];
  let log: jest.SpyInstance;
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let group: jest.SpyInstance;
  let groupEnd: jest.SpyInstance;

  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'group', 'groupEnd', 'time', 'timeEnd', 'table'] as const) {
      spies.push(jest.spyOn(console, method).mockImplementation());
    }
    [log, info, warn, error, group, groupEnd] = spies;
    debugLogger.setDebug(null);
  });

  afterEach(() => {
    debugLogger.setDebug(null);
    spies.forEach((spy) => spy.mockRestore());
    spies.length = 0;
  });

  describe('the debug gate', () => {
    test('log, info and warn are silent while debugging is off', () => {
      const logger = createLogger('Quiet');

      logger.log('a');
      logger.info('b');
      logger.warn('c');

      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    test('error is reported regardless', () => {
      // Deliberate: a failure the consumer has no other way of hearing about
      // should not be silent just because debugging is off.
      createLogger('Loud').error('boom');

      expect(error).toHaveBeenCalled();
    });

    test('they all speak once debugging is on', () => {
      debugLogger.setDebug(true);
      const logger = createLogger('Chatty');

      logger.log('a');
      logger.info('b');
      logger.warn('c');

      expect(log).toHaveBeenCalled();
      expect(info).toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    test('isDebugEnabled reflects the current state', () => {
      expect(debugLogger.isDebugEnabled()).toBe(false);
      debugLogger.setDebug(true);
      expect(debugLogger.isDebugEnabled()).toBe(true);
      debugLogger.setDebug(false);
      expect(debugLogger.isDebugEnabled()).toBe(false);
    });
  });

  describe('per-source debug requests', () => {
    test('debug stays on while any request is outstanding', () => {
      // The defect this replaced: a plain boolean meant constructing a second
      // source with debug: false called setDebug(false) and silenced the first.
      const releaseA = debugLogger.requestDebug();
      expect(debugLogger.isDebugEnabled()).toBe(true);

      const releaseB = debugLogger.requestDebug();
      releaseB();
      expect(debugLogger.isDebugEnabled()).toBe(true);

      releaseA();
      expect(debugLogger.isDebugEnabled()).toBe(false);
    });

    test('releasing twice does not double-decrement', () => {
      const releaseA = debugLogger.requestDebug();
      const releaseB = debugLogger.requestDebug();

      releaseA();
      releaseA();
      expect(debugLogger.isDebugEnabled()).toBe(true);

      releaseB();
      expect(debugLogger.isDebugEnabled()).toBe(false);
    });

    test('setDebug overrides the requests in both directions', () => {
      const release = debugLogger.requestDebug();

      debugLogger.setDebug(false);
      expect(debugLogger.isDebugEnabled()).toBe(false);

      debugLogger.setDebug(null);
      expect(debugLogger.isDebugEnabled()).toBe(true);

      release();
      debugLogger.setDebug(true);
      expect(debugLogger.isDebugEnabled()).toBe(true);
    });

    test('announces itself when it turns on, not on every request', () => {
      group.mockClear();
      const releaseA = debugLogger.requestDebug();
      const releaseB = debugLogger.requestDebug();

      expect(group).toHaveBeenCalledTimes(1);

      releaseA();
      releaseB();
    });
  });

  describe('output format', () => {
    test('emits no raw ANSI escapes in a browser-like console', () => {
      // They rendered as literal `[36m` garbage in DevTools. jsdom defines
      // window, so this is the browser branch.
      debugLogger.setDebug(true);
      createLogger('MVTSource').log('hello');

      const rendered = log.mock.calls[0].filter((a: unknown) => typeof a === 'string').join(' ');
      // eslint-disable-next-line no-control-regex
      expect(rendered).not.toMatch(/\x1b\[/);
    });

    test('uses %c plus a CSS string so the console colours it', () => {
      debugLogger.setDebug(true);
      createLogger('MVTSource').log('hello');

      expect(log.mock.calls[0][0]).toMatch(/^%c/);
      expect(typeof log.mock.calls[0][1]).toBe('string');
    });

    test('passes every extra argument through untouched', () => {
      debugLogger.setDebug(true);
      const payload = { a: 1 };

      createLogger('X').log('message', payload, 42);

      expect(log.mock.calls[0]).toEqual([expect.any(String), expect.any(String), 'message', payload, 42]);
    });

    test('gives known components distinct colours and unknown ones a default', () => {
      debugLogger.setDebug(true);

      createLogger('MVTSource').log('a');
      createLogger('MVTLayer').log('b');
      createLogger('Unknown').log('c');

      const [first, second, third] = log.mock.calls.map((c) => c[1]);
      expect(first).not.toBe(second);
      expect(third).toBe('');
    });
  });

  describe('helpers', () => {
    test('group runs its callback and closes the group', () => {
      debugLogger.setDebug(true);
      const body = jest.fn();

      debugLogger.group('label', body);

      expect(body).toHaveBeenCalled();
      expect(groupEnd).toHaveBeenCalled();
    });

    test('group closes even when the callback throws', () => {
      debugLogger.setDebug(true);

      expect(() =>
        debugLogger.group('label', () => {
          throw new Error('inner');
        }),
      ).toThrow('inner');
      expect(groupEnd).toHaveBeenCalled();
    });

    test('group, time and table are silent while debugging is off', () => {
      const body = jest.fn();

      debugLogger.group('label', body);
      debugLogger.groupEnd();
      debugLogger.time('t');
      debugLogger.timeEnd('t');
      debugLogger.table([{ a: 1 }]);

      expect(body).not.toHaveBeenCalled();
      expect(group).not.toHaveBeenCalled();
      expect(console.time).not.toHaveBeenCalled();
      expect(console.table).not.toHaveBeenCalled();
    });

    test('time and timeEnd use the same plain label, so they pair up', () => {
      // A %c format string here would make the two disagree and the timing
      // would never resolve.
      debugLogger.setDebug(true);

      debugLogger.time('work');
      debugLogger.timeEnd('work');

      expect(console.time).toHaveBeenCalledWith('work');
      expect(console.timeEnd).toHaveBeenCalledWith('work');
    });

    test('the prefixed logger namespaces group, time and table', () => {
      debugLogger.setDebug(true);
      const logger = createLogger('Comp');

      logger.group('phase', jest.fn());
      logger.time('t');
      logger.timeEnd('t');
      logger.table([{ a: 1 }]);

      expect(console.time).toHaveBeenCalledWith('Comp: t');
      expect(console.table).toHaveBeenCalledWith([{ a: 1 }], undefined);
    });

    test('the performance helpers return a stop function', () => {
      debugLogger.setDebug(true);
      const logger = createLogger('Comp');

      logger.performance.measureTileLoad('10:1:2')();
      logger.performance.measureFeatureRender(12)();

      expect(console.timeEnd).toHaveBeenCalledWith('Tile Load: 10:1:2');
      expect(console.timeEnd).toHaveBeenCalledWith('Feature Render: 12 features');
    });
  });

  test('getInstance always returns the same logger', () => {
    expect(DebugLogger.getInstance()).toBe(debugLogger);
    expect(DebugLogger.getInstance()).toBe(DebugLogger.getInstance());
  });
});
