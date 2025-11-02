// -------- PERFORMANCE MONITORING UTILITIES --------

class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.startTimes = new Map();
    }

    startTimer(operation) {
        this.startTimes.set(operation, process.hrtime.bigint());
    }

    endTimer(operation) {
        const startTime = this.startTimes.get(operation);
        if (!startTime) return null;

        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

        this.startTimes.delete(operation);
        this.recordMetric(operation, duration);

        return duration;
    }

    recordMetric(operation, value) {
        if (!this.metrics.has(operation)) {
            this.metrics.set(operation, {
                count: 0,
                total: 0,
                min: Infinity,
                max: 0,
                avg: 0
            });
        }

        const metric = this.metrics.get(operation);
        metric.count++;
        metric.total += value;
        metric.min = Math.min(metric.min, value);
        metric.max = Math.max(metric.max, value);
        metric.avg = metric.total / metric.count;
    }

    getMetrics(operation) {
        return this.metrics.get(operation) || null;
    }

    getAllMetrics() {
        const result = {};
        for (const [operation, metrics] of this.metrics) {
            result[operation] = {
                ...metrics,
                avg: Math.round(metrics.avg * 100) / 100,
                min: Math.round(metrics.min * 100) / 100,
                max: Math.round(metrics.max * 100) / 100
            };
        }
        return result;
    }

    logSummary() {
        console.log('\n📊 Performance Summary:');
        console.log('========================');
        
        for (const [operation, metrics] of this.metrics) {
            console.log(`${operation}:`);
            console.log(`  Count: ${metrics.count}`);
            console.log(`  Avg: ${Math.round(metrics.avg)}ms`);
            console.log(`  Min: ${Math.round(metrics.min)}ms`);
            console.log(`  Max: ${Math.round(metrics.max)}ms`);
            console.log('');
        }
    }

    reset() {
        this.metrics.clear();
        this.startTimes.clear();
    }
}

// Global performance monitor instance
const performanceMonitor = new PerformanceMonitor();

// Utility functions for common operations
function measureAsync(operation, asyncFunction) {
    return async (...args) => {
        performanceMonitor.startTimer(operation);
        try {
            const result = await asyncFunction(...args);
            const duration = performanceMonitor.endTimer(operation);
            
            if (duration > 5000) { // Log slow operations (>5s)
                console.warn(`⚠️ Slow operation detected: ${operation} took ${Math.round(duration)}ms`);
            }
            
            return result;
        } catch (error) {
            performanceMonitor.endTimer(operation);
            throw error;
        }
    };
}

function measureSync(operation, syncFunction) {
    return (...args) => {
        performanceMonitor.startTimer(operation);
        try {
            const result = syncFunction(...args);
            const duration = performanceMonitor.endTimer(operation);
            
            if (duration > 1000) { // Log slow sync operations (>1s)
                console.warn(`⚠️ Slow sync operation detected: ${operation} took ${Math.round(duration)}ms`);
            }
            
            return result;
        } catch (error) {
            performanceMonitor.endTimer(operation);
            throw error;
        }
    };
}

// Memory usage tracking
function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
        external: Math.round(usage.external / 1024 / 1024), // MB
        rss: Math.round(usage.rss / 1024 / 1024) // MB
    };
}

// Log performance summary every 30 minutes
setInterval(() => {
    performanceMonitor.logSummary();
    console.log('💾 Memory Usage:', getMemoryUsage());
}, 30 * 60 * 1000);

module.exports = {
    performanceMonitor,
    measureAsync,
    measureSync,
    getMemoryUsage
};