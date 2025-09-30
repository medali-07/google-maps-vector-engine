module.exports = {
  // Use the base Jest configuration
  ...require('./jest.config.js'),
  
  // Override specific settings for performance tests
  displayName: 'Performance Tests',
  testMatch: ['<rootDir>/tests/performance/**/*.test.ts'],
  testTimeout: 60000, // 60 seconds for performance tests (increased for integration tests)
  
  // Performance-specific settings
  verbose: true,
  detectOpenHandles: true,
  forceExit: true,
  
  // Collect performance metrics
  collectCoverage: false, // Disable coverage for performance tests
  
  // Custom reporter for performance results
  reporters: [
    'default',
    ['<rootDir>/tests/utils/performance-reporter.js', {}]
  ],
  
  // Setup files for performance tests
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.ts',
    '<rootDir>/tests/utils/performance-setup.js'
  ],
  
  // Environment variables for performance tests
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    resources: 'usable'
  }
};
