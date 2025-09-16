import { DebugLogger, createLogger, debugLogger } from '../../src/DebugLogger';

describe('DebugLogger', () => {
  let consoleSpy: jest.SpyInstance;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    originalNodeEnv = process.env.NODE_ENV;
    // Enable debug mode for testing
    debugLogger.setDebug(true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    // Reset debug mode
    debugLogger.setDebug(false);
  });

  describe('Basic Logging', () => {
    test('should log messages with component name', () => {
      const logger = createLogger('TestComponent');
      logger.log('Test message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TestComponent'),
        expect.stringContaining('Test message')
      );
    });

    test('should support data objects in logging', () => {
      const logger = createLogger('TestComponent');
      const testData = { key: 'value', number: 42 };
      
      logger.log('Test message', testData);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TestComponent'),
        expect.stringContaining('Test message'),
        testData
      );
    });
  });

  describe('Color Support', () => {
    test('should include color codes in messages', () => {
      const logger = createLogger('TestComponent');
      logger.log('Test message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*TestComponent.*\]/),
        expect.stringContaining('Test message')
      );
    });

    test('should assign different colors to different components', () => {
      const logger1 = createLogger('Component1');
      const logger2 = createLogger('Component2');
      
      logger1.log('Message 1');
      logger2.log('Message 2');

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Component1'),
        expect.stringContaining('Message 1')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Component2'),
        expect.stringContaining('Message 2')
      );
    });
  });

  describe('Environment Detection', () => {
    test('should work in different environments', () => {
      const logger = createLogger('TestComponent');
      
      // Test in production environment
      process.env.NODE_ENV = 'production';
      logger.log('Production message');
      
      // Test in development environment
      process.env.NODE_ENV = 'development';
      logger.log('Development message');

      // Should still log in test environment since debug is enabled
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should work in test environment', () => {
      process.env.NODE_ENV = 'test';
      const logger = createLogger('TestComponent');
      logger.log('Test environment message');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TestComponent'),
        expect.stringContaining('Test environment message')
      );
    });
  });

  describe('Performance', () => {
    test('should handle rapid logging efficiently', () => {
      const logger = createLogger('PerformanceTest');
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        logger.log(`Message ${i}`);
      }
      
      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
    });

    test('should not leak memory with many components', () => {
      const loggers = [];
      for (let i = 0; i < 100; i++) {
        loggers.push(createLogger(`Component${i}`));
      }
      
      loggers.forEach((logger, index) => {
        logger.log(`Message from component ${index}`);
      });
      
      expect(consoleSpy).toHaveBeenCalledTimes(100);
    });
  });

  describe('Component Management', () => {
    test('should create different loggers for different component names', () => {
      const logger1 = createLogger('Component1');
      const logger2 = createLogger('Component2');
      
      expect(logger1).not.toBe(logger2);
    });

    test('should handle empty component names gracefully', () => {
      const logger = createLogger('');
      logger.log('Empty component name');

      expect(consoleSpy).toHaveBeenCalled();
    });

    test('should handle special characters in component names', () => {
      const logger = createLogger('Component@#$%');
      logger.log('Special characters test');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Component@#$%'),
        expect.stringContaining('Special characters test')
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle circular references in data objects', () => {
      const logger = createLogger('TestComponent');
      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;

      expect(() => {
        logger.log('Circular reference test', circularObj);
      }).not.toThrow();
    });

    test('should handle null and undefined data', () => {
      const logger = createLogger('TestComponent');

      expect(() => {
        logger.log('Null test', null);
        logger.log('Undefined test', undefined);
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    test('should handle very long messages', () => {
      const logger = createLogger('TestComponent');
      const longMessage = 'A'.repeat(10000);

      expect(() => {
        logger.log(longMessage);
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TestComponent'),
        longMessage
      );
    });

    test('should handle multiple data arguments', () => {
      const logger = createLogger('TestComponent');
      const data1 = { key1: 'value1' };
      const data2 = { key2: 'value2' };
      const data3 = { key3: 'value3' };

      logger.log('Multiple data test', data1, data2, data3);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TestComponent'),
        expect.stringContaining('Multiple data test'),
        data1,
        data2,
        data3
      );
    });

    test('should handle concurrent logging from multiple components', () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            setTimeout(() => {
              const logger = createLogger(`ConcurrentComponent${i}`);
              logger.log(`Concurrent message ${i}`);
              resolve();
            }, Math.random() * 10);
          })
        );
      }

      return Promise.all(promises).then(() => {
        expect(consoleSpy).toHaveBeenCalledTimes(10);
      });
    });
  });
});