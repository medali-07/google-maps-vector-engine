/**
 * Custom Jest reporter for performance test results
 */

class PerformanceReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;
    this.results = [];
  }

  onTestResult(test, testResult, _aggregatedResult) {
    // Extract performance data from test results
    testResult.testResults.forEach((result) => {
      if (result.status === 'passed') {
        // Look for console.log performance messages
        const performanceLogs = result.ancestorTitles.join(' > ') + ' > ' + result.title;

        this.results.push({
          testName: performanceLogs,
          duration: result.duration || 0,
          status: result.status,
        });
      }
    });
  }

  onRunComplete(contexts, results) {
    if (results.success) {
      this.generatePerformanceReport();
    }
  }

  generatePerformanceReport() {
    const reportLines = ['', '🚀 PERFORMANCE TEST RESULTS', '='.repeat(80), ''];

    // Summary statistics
    const totalTests = this.results.length;
    const passedTests = this.results.filter((r) => r.status === 'passed').length;
    const avgDuration = this.results.reduce((sum, r) => sum + r.duration, 0) / totalTests;

    reportLines.push(`📊 Summary:`);
    reportLines.push(`   Tests Run: ${totalTests}`);
    reportLines.push(`   Passed: ${passedTests}`);
    reportLines.push(`   Average Duration: ${avgDuration.toFixed(2)}ms`);
    reportLines.push('');

    // Performance benchmarks
    reportLines.push(`⚡ Performance Benchmarks:`);
    reportLines.push(`   🚀 Initialization: < 100ms (target)`);
    reportLines.push(`   ⚡ Single Selection: < 5ms (target)`);
    reportLines.push(`   🔍 Feature Lookup: < 1ms (target)`);
    reportLines.push(`   🎨 Drawing Operations: < 25ms (target)`);
    reportLines.push(`   🗑️  Cleanup/Disposal: < 20ms (target)`);
    reportLines.push('');

    // Tips for optimization
    reportLines.push(`💡 Optimization Tips:`);
    reportLines.push(`   • Enable caching in production (cache: true)`);
    reportLines.push(`   • Use static styles for better performance`);
    reportLines.push(`   • Limit visible layers to essential ones only`);
    reportLines.push(`   • Consider batching large selection operations`);
    reportLines.push(`   • Always call dispose() to prevent memory leaks`);
    reportLines.push('');

    reportLines.push('='.repeat(80));
    reportLines.push('');

    // Write to console
    console.log(reportLines.join('\n'));

    // Optionally write to file
    if (process.env.PERFORMANCE_OUTPUT_FILE) {
      const fs = require('fs');
      const path = require('path');

      const outputPath = path.resolve(process.env.PERFORMANCE_OUTPUT_FILE);
      fs.writeFileSync(outputPath, reportLines.join('\n'));
      console.log(`📁 Performance report saved to: ${outputPath}`);
    }
  }
}

module.exports = PerformanceReporter;
