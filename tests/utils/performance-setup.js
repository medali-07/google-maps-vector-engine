/**
 * Performance test setup utilities
 */

// Store performance results globally
global.performanceResults = {
  testResults: [],
  startTime: Date.now(),
  memoryUsage: {
    initial: process.memoryUsage(),
    peak: process.memoryUsage(),
    final: null
  }
};

// Track memory usage
const originalTest = global.test;
global.test = (name, fn, timeout) => {
  return originalTest(name, async () => {
    const memBefore = process.memoryUsage();
    const timeBefore = performance.now();
    
    try {
      await fn();
    } finally {
      const timeAfter = performance.now();
      const memAfter = process.memoryUsage();
      
      // Update peak memory usage
      if (memAfter.heapUsed > global.performanceResults.memoryUsage.peak.heapUsed) {
        global.performanceResults.memoryUsage.peak = memAfter;
      }
      
      // Store test result
      global.performanceResults.testResults.push({
        name,
        duration: timeAfter - timeBefore,
        memoryDelta: memAfter.heapUsed - memBefore.heapUsed,
        timestamp: Date.now()
      });
    }
  }, timeout);
};

// Add performance utilities
global.measurePerformance = (name, fn) => {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  
  console.log(`⏱️  ${name}: ${duration.toFixed(2)}ms`);
  return { result, duration };
};

global.measureAsync = async (name, fn) => {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  
  console.log(`⏱️  ${name}: ${duration.toFixed(2)}ms`);
  return { result, duration };
};

// Memory measurement utility
global.measureMemory = (name, fn) => {
  const memBefore = process.memoryUsage();
  const result = fn();
  const memAfter = process.memoryUsage();
  
  const memoryDelta = memAfter.heapUsed - memBefore.heapUsed;
  console.log(`🧠 ${name}: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);
  
  return { result, memoryDelta };
};

// Cleanup after all tests
process.on('exit', () => {
  global.performanceResults.memoryUsage.final = process.memoryUsage();
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 PERFORMANCE SUMMARY');
  console.log('='.repeat(60));
  
  const totalTests = global.performanceResults.testResults.length;
  const totalTime = global.performanceResults.testResults.reduce((sum, test) => sum + test.duration, 0);
  const avgTime = totalTime / totalTests;
  
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Total Time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average Time: ${avgTime.toFixed(2)}ms`);
  
  // Memory summary
  const initial = global.performanceResults.memoryUsage.initial;
  const peak = global.performanceResults.memoryUsage.peak;
  const final = global.performanceResults.memoryUsage.final;
  
  console.log(`\n🧠 Memory Usage:`);
  console.log(`Initial: ${(initial.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  console.log(`Peak: ${(peak.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  console.log(`Final: ${(final.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  console.log(`Peak Delta: +${((peak.heapUsed - initial.heapUsed) / 1024 / 1024).toFixed(2)}MB`);
  
  // Top slowest tests
  const slowestTests = global.performanceResults.testResults
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5);
  
  console.log(`\n🐌 Slowest Tests:`);
  slowestTests.forEach((test, i) => {
    console.log(`${i + 1}. ${test.name}: ${test.duration.toFixed(2)}ms`);
  });
  
  console.log('='.repeat(60));
});
