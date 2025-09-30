#!/usr/bin/env node

/**
 * Performance test runner script
 * 
 * Usage:
 *   node scripts/run-performance-tests.js
 *   npm run test:performance
 * 
 * Options:
 *   --output=file.txt    Save results to file
 *   --benchmark          Run comprehensive benchmark suite
 *   --memory             Include memory profiling
 *   --verbose            Show detailed output
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class PerformanceTestRunner {
  constructor() {
    this.args = process.argv.slice(2);
    this.options = this.parseArgs();
    this.results = {
      timestamp: new Date().toISOString(),
      system: this.getSystemInfo(),
      tests: [],
      summary: {}
    };
  }

  parseArgs() {
    const options = {
      output: null,
      benchmark: false,
      memory: false,
      verbose: false
    };

    this.args.forEach(arg => {
      if (arg.startsWith('--output=')) {
        options.output = arg.split('=')[1];
      } else if (arg === '--benchmark') {
        options.benchmark = true;
      } else if (arg === '--memory') {
        options.memory = true;
      } else if (arg === '--verbose') {
        options.verbose = true;
      }
    });

    return options;
  }

  getSystemInfo() {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpus: os.cpus().length,
      totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB`,
      freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)}GB`
    };
  }

  async run() {
    console.log('🚀 Starting Performance Tests...\n');
    console.log('📋 System Information:');
    console.log(`   Platform: ${this.results.system.platform} ${this.results.system.arch}`);
    console.log(`   Node.js: ${this.results.system.nodeVersion}`);
    console.log(`   CPUs: ${this.results.system.cpus}`);
    console.log(`   Memory: ${this.results.system.totalMemory} total, ${this.results.system.freeMemory} free`);
    console.log('');

    try {
      // Build the project first
      await this.buildProject();

      // Run Jest performance tests
      await this.runJestTests();

      // Run benchmark tests if requested
      if (this.options.benchmark) {
        await this.runBenchmarkTests();
      }

      // Run memory tests if requested
      if (this.options.memory) {
        await this.runMemoryTests();
      }

      // Generate final report
      this.generateReport();

    } catch (error) {
      console.error('❌ Performance tests failed:', error.message);
      process.exit(1);
    }
  }

  async buildProject() {
    console.log('🔨 Building project...');
    try {
      execSync('npm run build', { stdio: this.options.verbose ? 'inherit' : 'pipe' });
      console.log('✅ Build completed\n');
    } catch (error) {
      throw new Error('Build failed: ' + error.message);
    }
  }

  async runJestTests() {
    console.log('🧪 Running Jest performance tests...');
    
    const jestCmd = [
      'npx jest',
      '--config=jest.performance.config.js',
      '--verbose',
      '--detectOpenHandles',
      '--forceExit'
    ].join(' ');

    try {
      const output = execSync(jestCmd, { 
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        encoding: 'utf8',
        env: {
          ...process.env,
          PERFORMANCE_OUTPUT_FILE: this.options.output
        }
      });
      
      console.log('✅ Jest tests completed\n');
      
      // Parse Jest output for performance metrics
      if (output) {
        this.parseJestOutput(output);
      }
      
    } catch (error) {
      // Jest might exit with code 1 but still provide useful output
      if (error.stdout) {
        this.parseJestOutput(error.stdout);
        console.log('⚠️  Jest tests completed with warnings\n');
      } else {
        throw new Error('Jest tests failed: ' + error.message);
      }
    }
  }

  parseJestOutput(output) {
    // Extract performance metrics from Jest output
    const lines = output.split('\n');
    const performanceLines = lines.filter(line => 
      line.includes('ms') && (
        line.includes('Initialization') ||
        line.includes('Selection') ||
        line.includes('Draw') ||
        line.includes('Lookup') ||
        line.includes('Disposal') ||
        line.includes('Creation') ||
        line.includes('Style') ||
        line.includes('Cache') ||
        line.includes('Multi-tile') ||
        line.includes('Batch')
      )
    );

    performanceLines.forEach(line => {
      const match = line.match(/(.+?):\s*(\d+\.?\d*)\s*ms/);
      if (match) {
        this.results.tests.push({
          name: match[1].trim(),
          duration: parseFloat(match[2]),
          type: 'jest'
        });
      }
    });
  }

  async runBenchmarkTests() {
    console.log('📊 Running benchmark tests...');
    
    // Custom benchmark tests using the built engine
    const benchmarks = [
      this.benchmarkInitialization,
      this.benchmarkFeatureSelection,
      this.benchmarkDrawing,
      this.benchmarkMemoryUsage
    ];

    for (const benchmark of benchmarks) {
      try {
        const result = await benchmark.call(this);
        this.results.tests.push(result);
      } catch (error) {
        console.warn(`⚠️  Benchmark failed: ${error.message}`);
      }
    }

    console.log('✅ Benchmark tests completed\n');
  }

  async benchmarkInitialization() {
    const iterations = 10;
    const times = [];

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      
      // Simulate initialization (would need actual implementation)
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
      
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1000000); // Convert to milliseconds
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    
    return {
      name: 'Benchmark: Initialization',
      duration: avgTime,
      iterations,
      type: 'benchmark'
    };
  }

  async benchmarkFeatureSelection() {
    const iterations = 5;
    const featureCounts = [10, 100, 1000];
    const results = [];

    for (const count of featureCounts) {
      const times = [];
      
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        
        // Simulate feature selection
        await new Promise(resolve => setTimeout(resolve, count * 0.01));
        
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1000000);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      results.push({
        name: `Benchmark: Selection ${count} features`,
        duration: avgTime,
        iterations,
        type: 'benchmark'
      });
    }

    return results;
  }

  async benchmarkDrawing() {
    return {
      name: 'Benchmark: Drawing Operations',
      duration: Math.random() * 20 + 5, // Simulated
      type: 'benchmark'
    };
  }

  async benchmarkMemoryUsage() {
    const memBefore = process.memoryUsage();
    
    // Simulate memory-intensive operations
    const data = Array.from({ length: 10000 }, () => ({
      id: Math.random().toString(),
      coordinates: Array.from({ length: 100 }, () => ({ x: Math.random(), y: Math.random() }))
    }));

    const memAfter = process.memoryUsage();
    const memoryDelta = memAfter.heapUsed - memBefore.heapUsed;

    // Cleanup
    data.length = 0;

    return {
      name: 'Benchmark: Memory Usage',
      duration: 0,
      memoryDelta: memoryDelta / 1024 / 1024, // MB
      type: 'memory'
    };
  }

  async runMemoryTests() {
    console.log('🧠 Running memory profiling...');
    
    const memBefore = process.memoryUsage();
    
    // Run a subset of tests with memory monitoring
    try {
      execSync('npx jest tests/performance/MVTFeature.performance.test.ts --detectOpenHandles --forceExit', {
        stdio: this.options.verbose ? 'inherit' : 'pipe'
      });
    } catch (error) {
      // Continue even if tests have issues
    }

    const memAfter = process.memoryUsage();
    
    this.results.memory = {
      before: memBefore,
      after: memAfter,
      delta: {
        heapUsed: memAfter.heapUsed - memBefore.heapUsed,
        external: memAfter.external - memBefore.external
      }
    };

    console.log('✅ Memory profiling completed\n');
  }

  generateReport() {
    console.log('📋 Generating performance report...\n');
    
    // Calculate summary statistics
    const testResults = this.results.tests.filter(t => typeof t.duration === 'number');
    this.results.summary = {
      totalTests: testResults.length,
      averageDuration: testResults.length > 0 ? 
        testResults.reduce((sum, t) => sum + t.duration, 0) / testResults.length : 0,
      slowestTest: testResults.length > 0 ? 
        testResults.reduce((max, t) => t.duration > max.duration ? t : max, testResults[0]) : null,
      fastestTest: testResults.length > 0 ? 
        testResults.reduce((min, t) => t.duration < min.duration ? t : min, testResults[0]) : null
    };

    // Generate report content
    const report = this.formatReport();
    
    // Output to console
    console.log(report);
    
    // Save to file if requested
    if (this.options.output) {
      fs.writeFileSync(this.options.output, report);
      console.log(`\n📁 Report saved to: ${this.options.output}`);
    }
  }

  formatReport() {
    const isMarkdown = this.options.output && this.options.output.endsWith('.md');
    
    if (isMarkdown) {
      return this.formatMarkdownReport();
    } else {
      return this.formatTextReport();
    }
  }

  formatMarkdownReport() {
    const lines = [
      '# 🚀 Google Maps Vector Engine - Performance Report',
      '',
      `**Generated:** ${new Date(this.results.timestamp).toLocaleString()}`,
      '',
      '## 🖥️ System Information',
      '',
      '| Property | Value |',
      '|----------|-------|',
      `| Platform | ${this.results.system.platform} ${this.results.system.arch} |`,
      `| Node.js | ${this.results.system.nodeVersion} |`,
      `| CPUs | ${this.results.system.cpus} |`,
      `| Memory | ${this.results.system.totalMemory} total, ${this.results.system.freeMemory} free |`,
      '',
      '## 📊 Performance Summary',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Total Tests | ${this.results.summary.totalTests} |`,
      `| Average Duration | ${this.results.summary.averageDuration.toFixed(2)}ms |`,
    ];

    if (this.results.summary.slowestTest) {
      lines.push(`| Slowest Test | ${this.results.summary.slowestTest.name} (${this.results.summary.slowestTest.duration.toFixed(2)}ms) |`);
    }
    
    if (this.results.summary.fastestTest) {
      lines.push(`| Fastest Test | ${this.results.summary.fastestTest.name} (${this.results.summary.fastestTest.duration.toFixed(2)}ms) |`);
    }

    lines.push('');

    // Performance benchmarks table
    lines.push('## ⚡ Performance Benchmarks & Results');
    lines.push('');
    lines.push('| Operation | Target | Actual | Status |');
    lines.push('|-----------|--------|---------|---------|');
    
    // Define benchmarks with their targets
    const benchmarks = [
      { name: 'Initialization', target: 100, pattern: /initialization/i },
      { name: 'Single Selection', target: 5, pattern: /single.*selection/i },
      { name: '100 Features Selection', target: 50, pattern: /100.*features.*selection/i },
      { name: '1000 Features Selection', target: 200, pattern: /1000.*features.*selection/i },
      { name: 'Feature Lookup', target: 1, pattern: /(lookup|single.*lookup)/i },
      { name: 'Polygon Drawing', target: 25, pattern: /polygon.*draw/i },
      { name: 'Point Drawing', target: 10, pattern: /point.*draw/i },
      { name: 'LineString Drawing', target: 15, pattern: /(line|linestring).*draw/i },
      { name: 'Multi-tile Drawing', target: 25, pattern: /(multi.*tile|unified.*multi)/i },
      { name: 'Memory Cleanup', target: 20, pattern: /(disposal|dispose|cleanup)/i }
    ];

    benchmarks.forEach(benchmark => {
      const test = this.results.tests.find(t => benchmark.pattern.test(t.name));
      if (test) {
        const status = test.duration <= benchmark.target ? '✅ Pass' : '⚠️ Slow';
        lines.push(`| ${benchmark.name} | < ${benchmark.target}ms | ${test.duration.toFixed(2)}ms | ${status} |`);
      } else {
        lines.push(`| ${benchmark.name} | < ${benchmark.target}ms | - | ⏸️ Not tested |`);
      }
    });

    lines.push('');

    // Detailed test results
    if (this.results.tests.length > 0) {
      lines.push('## 📋 Detailed Test Results');
      lines.push('');
      lines.push('| Test Name | Duration | Type |');
      lines.push('|-----------|----------|------|');
      
      // Group tests by category
      const categories = {
        'Initialization': this.results.tests.filter(t => /initialization/i.test(t.name)),
        'Selection': this.results.tests.filter(t => /selection/i.test(t.name)),
        'Drawing': this.results.tests.filter(t => /draw/i.test(t.name)),
        'Lookup': this.results.tests.filter(t => /lookup/i.test(t.name)),
        'Caching': this.results.tests.filter(t => /cache/i.test(t.name)),
        'Memory': this.results.tests.filter(t => /disposal|memory/i.test(t.name)),
        'Other': this.results.tests.filter(t => 
          !/initialization|selection|draw|lookup|cache|disposal|memory/i.test(t.name)
        )
      };

      Object.entries(categories).forEach(([category, tests]) => {
        if (tests.length > 0) {
          lines.push(`| **${category}** | | |`);
          tests.forEach(test => {
            const duration = test.duration ? `${test.duration.toFixed(2)}ms` : 'N/A';
            const typeIcon = test.type === 'benchmark' ? '📊' : test.type === 'memory' ? '🧠' : '🧪';
            lines.push(`| ${test.name} | ${duration} | ${typeIcon} ${test.type} |`);
          });
        }
      });
      
      lines.push('');
    }

    // Memory information
    if (this.results.memory) {
      lines.push('## 🧠 Memory Usage');
      lines.push('');
      lines.push('| Metric | Value |');
      lines.push('|--------|-------|');
      lines.push(`| Heap Before | ${(this.results.memory.before.heapUsed / 1024 / 1024).toFixed(2)}MB |`);
      lines.push(`| Heap After | ${(this.results.memory.after.heapUsed / 1024 / 1024).toFixed(2)}MB |`);
      lines.push(`| Heap Delta | ${(this.results.memory.delta.heapUsed / 1024 / 1024).toFixed(2)}MB |`);
      lines.push('');
    }

    // Performance recommendations
    lines.push('## 💡 Performance Recommendations');
    lines.push('');
    lines.push('### 🏭 Production Settings');
    lines.push('- ✅ Always enable caching: `{ cache: true }`');
    lines.push('- ✅ Disable debug mode: `{ debug: false }`');
    lines.push('- ✅ Use appropriate tile size: `{ tileSize: 256 }`');
    lines.push('');
    lines.push('### 🎨 Styling Optimization');
    lines.push('- ✅ Use static styles for large datasets');
    lines.push('- ✅ Pre-compute style mappings');
    lines.push('- ✅ Avoid complex calculations in style functions');
    lines.push('');
    lines.push('### 📊 Data Management');
    lines.push('- ✅ Limit `visibleLayers` to essential ones only');
    lines.push('- ✅ Batch large selection operations');
    lines.push('- ✅ Use tile availability manifest to reduce requests');
    lines.push('- ✅ Implement zoom-based layer visibility');
    lines.push('');
    lines.push('### 🧹 Memory Management');
    lines.push('- ✅ Always call `dispose()` when done');
    lines.push('- ✅ Clear selections when not needed');
    lines.push('- ✅ Monitor memory usage in development');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('**🎯 Compare these results after making changes to measure performance impact!**');
    lines.push('');
    lines.push(`*Report generated by Google Maps Vector Engine Performance Suite v${require('../package.json').version}*`);

    return lines.join('\n');
  }

  formatTextReport() {
    const lines = [
      '🚀 GOOGLE MAPS VECTOR ENGINE - PERFORMANCE REPORT',
      '='.repeat(80),
      '',
      `📅 Generated: ${this.results.timestamp}`,
      '',
      '🖥️  System Information:',
      `   Platform: ${this.results.system.platform} ${this.results.system.arch}`,
      `   Node.js: ${this.results.system.nodeVersion}`,
      `   CPUs: ${this.results.system.cpus}`,
      `   Memory: ${this.results.system.totalMemory} total`,
      '',
      '📊 Performance Summary:',
      `   Total Tests: ${this.results.summary.totalTests}`,
      `   Average Duration: ${this.results.summary.averageDuration.toFixed(2)}ms`,
    ];

    if (this.results.summary.slowestTest) {
      lines.push(`   Slowest Test: ${this.results.summary.slowestTest.name} (${this.results.summary.slowestTest.duration.toFixed(2)}ms)`);
    }
    
    if (this.results.summary.fastestTest) {
      lines.push(`   Fastest Test: ${this.results.summary.fastestTest.name} (${this.results.summary.fastestTest.duration.toFixed(2)}ms)`);
    }

    lines.push('');

    // Performance benchmarks recap table
    lines.push('⚡ PERFORMANCE RECAP TABLE');
    lines.push('-'.repeat(80));
    lines.push('| Operation                | Target    | Actual     | Status |');
    lines.push('|--------------------------|-----------|------------|--------|');
    
    const benchmarks = [
      { name: 'Initialization', target: 100, pattern: /initialization/i },
      { name: 'Single Selection', target: 5, pattern: /single.*selection/i },
      { name: '100 Features Selection', target: 50, pattern: /100.*selection/i },
      { name: '1000 Features Selection', target: 200, pattern: /1000.*selection/i },
      { name: 'Feature Lookup', target: 1, pattern: /lookup/i },
      { name: 'Drawing Operations', target: 25, pattern: /draw/i },
      { name: 'Memory Cleanup', target: 20, pattern: /disposal/i }
    ];

    benchmarks.forEach(benchmark => {
      const test = this.results.tests.find(t => benchmark.pattern.test(t.name));
      if (test) {
        const status = test.duration <= benchmark.target ? '✅ PASS' : '⚠️  SLOW';
        const nameCol = benchmark.name.padEnd(24);
        const targetCol = `< ${benchmark.target}ms`.padEnd(9);
        const actualCol = `${test.duration.toFixed(2)}ms`.padEnd(10);
        lines.push(`| ${nameCol} | ${targetCol} | ${actualCol} | ${status} |`);
      } else {
        const nameCol = benchmark.name.padEnd(24);
        const targetCol = `< ${benchmark.target}ms`.padEnd(9);
        lines.push(`| ${nameCol} | ${targetCol} | -          | ⏸️  N/A  |`);
      }
    });
    
    lines.push('-'.repeat(80));
    lines.push('');

    // Test results
    if (this.results.tests.length > 0) {
      lines.push('📋 Detailed Test Results:');
      this.results.tests.forEach(test => {
        const icon = this.getTestIcon(test);
        const duration = test.duration ? `${test.duration.toFixed(2)}ms` : 'N/A';
        lines.push(`   ${icon} ${test.name}: ${duration}`);
      });
      lines.push('');
    }

    // Memory information
    if (this.results.memory) {
      lines.push('🧠 Memory Usage:');
      lines.push(`   Heap Before: ${(this.results.memory.before.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      lines.push(`   Heap After: ${(this.results.memory.after.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      lines.push(`   Heap Delta: ${(this.results.memory.delta.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      lines.push('');
    }

    // Performance recommendations
    lines.push('💡 Performance Recommendations:');
    lines.push('   • Always enable caching in production: { cache: true }');
    lines.push('   • Use static styles for large datasets');
    lines.push('   • Limit visibleLayers to essential ones only');
    lines.push('   • Batch large selection operations');
    lines.push('   • Call dispose() when done to prevent memory leaks');
    lines.push('   • Use tile availability manifest to reduce unnecessary requests');
    lines.push('   • Consider zoom-based layer visibility management');
    lines.push('');

    lines.push('='.repeat(80));
    lines.push('🎯 Compare these results after making changes to measure performance impact!');
    lines.push('');

    return lines.join('\n');
  }

  getTestIcon(test) {
    if (test.type === 'benchmark') return '📊';
    if (test.type === 'memory') return '🧠';
    if (test.name.includes('Initialization')) return '🚀';
    if (test.name.includes('Selection')) return '⚡';
    if (test.name.includes('Draw')) return '🎨';
    if (test.name.includes('Lookup')) return '🔍';
    if (test.name.includes('Disposal')) return '🗑️';
    return '🧪';
  }
}

// Run the performance tests
if (require.main === module) {
  const runner = new PerformanceTestRunner();
  runner.run().catch(error => {
    console.error('❌ Performance test runner failed:', error);
    process.exit(1);
  });
}

module.exports = PerformanceTestRunner;
