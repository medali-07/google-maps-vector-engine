module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.ts',
    'jest-canvas-mock/lib/index.js'
  ],
  // Transform ES modules from node_modules
  transformIgnorePatterns: [
    'node_modules/(?!(@mapbox|@turf)/)'
  ],
  // Module name mapping for ES modules
  moduleNameMapper: {
    '^@mapbox/vector-tile$': '<rootDir>/node_modules/@mapbox/vector-tile/index.js',
    '^@mapbox/point-geometry$': '<rootDir>/node_modules/@mapbox/point-geometry/index.js'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.spec.ts'
  ],
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  testTimeout: 10000,
  verbose: true
};
