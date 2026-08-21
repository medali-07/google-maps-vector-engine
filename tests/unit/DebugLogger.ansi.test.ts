/**
 * @jest-environment node
 */

// The terminal branch of the logger's formatting. Every other suite runs under
// jsdom, where `window` exists and the CSS `%c` path is taken, so this is the
// only place the ANSI branch is reachable.

import { createLogger, debugLogger } from '../../src/DebugLogger';

describe('DebugLogger outside a browser', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation();
    debugLogger.setDebug(true);
  });

  afterEach(() => {
    debugLogger.setDebug(null);
    log.mockRestore();
  });

  test('uses ANSI escapes rather than a %c format string', () => {
    createLogger('MVTSource').log('hello');

    const [first, ...rest] = log.mock.calls[0];
    expect(first).not.toMatch(/^%c/);
    // eslint-disable-next-line no-control-regex
    expect(first).toMatch(/\x1b\[\d+m/);
    expect(rest).toEqual(['hello']);
  });

  test('closes the escape sequence, so the terminal is not left coloured', () => {
    createLogger('MVTSource').log('hello');

    // eslint-disable-next-line no-control-regex
    expect(log.mock.calls[0][0]).toMatch(/\x1b\[0m$/);
  });

  test('passes extra arguments through unchanged', () => {
    const payload = { a: 1 };

    createLogger('X').log('message', payload);

    expect(log.mock.calls[0]).toEqual([expect.any(String), 'message', payload]);
  });
});
