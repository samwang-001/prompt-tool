/**
 * 错误监控模块
 * 
 * 提供全局错误捕获、错误上报、用户行为追踪等功能
 * 帮助快速定位和修复线上问题
 */

/**
 * 错误监控器类
 */
class ErrorMonitor {
    /**
     * @param {Object} options - 配置选项
     * @param {string} options.appName - 应用名称
     * @param {string} options.appVersion - 应用版本
     * @param {boolean} options.enableConsole - 是否输出到控制台，默认 true
     * @param {Function} options.onError - 错误回调函数
     * @param {number} options.maxErrors - 最大错误记录数，默认 100
     */
    constructor(options = {}) {
        this.appName = options.appName || 'PromptTool';
        this.appVersion = options.appVersion || '1.0.0';
        this.enableConsole = options.enableConsole !== false;
        this.onError = options.onError || null;
        this.maxErrors = options.maxErrors || 100;
        
        this.errors = [];           // 错误记录
        this.context = {};          // 上下文信息
        this.userActions = [];      // 用户行为记录
        this.isEnabled = false;     // 是否已启用
        
        // 绑定方法
        this._handleError = this._handleError.bind(this);
        this._handleUnhandledRejection = this._handleUnhandledRejection.bind(this);
    }
    
    /**
     * 启用错误监控
     */
    enable() {
        if (this.isEnabled) return;
        
        // 捕获全局错误
        window.addEventListener('error', this._handleError);
        
        // 捕获未处理的 Promise 拒绝
        window.addEventListener('unhandledrejection', this._handleUnhandledRejection);
        
        // 记录页面信息
        this.context = {
            url: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
        };
        
        this.isEnabled = true;
        console.log(`[ErrorMonitor] ✅ 错误监控已启用 (${this.appName} v${this.appVersion})`);
    }
    
    /**
     * 禁用错误监控
     */
    disable() {
        if (!this.isEnabled) return;
        
        window.removeEventListener('error', this._handleError);
        window.removeEventListener('unhandledrejection', this._handleUnhandledRejection);
        
        this.isEnabled = false;
        console.log('[ErrorMonitor] ❌ 错误监控已禁用');
    }
    
    /**
     * 处理全局错误
     * @private
     */
    _handleError(event) {
        const error = {
            type: 'error',
            message: event.message || 'Unknown error',
            filename: event.filename || '',
            lineno: event.lineno || 0,
            colno: event.colno || 0,
            stack: event.error?.stack || '',
            timestamp: new Date().toISOString(),
            context: { ...this.context },
            userActions: [...this.userActions.slice(-10)] // 最近10个操作
        };
        
        this._recordError(error);
        
        if (this.enableConsole) {
            console.error('[ErrorMonitor] 捕获错误:', error.message, error);
        }
        
        if (this.onError) {
            this.onError(error);
        }
    }
    
    /**
     * 处理未处理的 Promise 拒绝
     * @private
     */
    _handleUnhandledRejection(event) {
        const error = {
            type: 'unhandledrejection',
            message: event.reason?.message || String(event.reason) || 'Unknown rejection',
            stack: event.reason?.stack || '',
            timestamp: new Date().toISOString(),
            context: { ...this.context },
            userActions: [...this.userActions.slice(-10)]
        };
        
        this._recordError(error);
        
        if (this.enableConsole) {
            console.warn('[ErrorMonitor] 捕获未处理的 Promise 拒绝:', error.message);
        }
        
        if (this.onError) {
            this.onError(error);
        }
        
        // 阻止默认的未处理警告
        event.preventDefault();
    }
    
    /**
     * 记录错误
     * @private
     */
    _recordError(error) {
        this.errors.push(error);
        
        // 限制错误记录数量
        if (this.errors.length > this.maxErrors) {
            this.errors.shift();
        }
        
        // 自动保存到 localStorage（可选）
        this._saveToStorage();
    }
    
    /**
     * 手动报告错误
     * @param {Error|string} error - 错误对象或消息
     * @param {Object} context - 额外上下文
     */
    reportError(error, context = {}) {
        const errorObj = {
            type: 'manual',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : '',
            context: { ...this.context, ...context },
            timestamp: new Date().toISOString(),
            userActions: [...this.userActions.slice(-10)]
        };
        
        this._recordError(errorObj);
        
        if (this.enableConsole) {
            console.error('[ErrorMonitor] 手动报告错误:', errorObj.message);
        }
        
        if (this.onError) {
            this.onError(errorObj);
        }
    }
    
    /**
     * 记录用户行为
     * @param {string} action - 行为描述
     * @param {Object} data - 行为数据
     */
    trackAction(action, data = {}) {
        this.userActions.push({
            action,
            data,
            timestamp: new Date().toISOString()
        });
        
        // 限制行为记录数量
        if (this.userActions.length > 50) {
            this.userActions.shift();
        }
    }
    
    /**
     * 设置上下文信息
     * @param {string} key - 键名
     * @param {any} value - 值
     */
    setContext(key, value) {
        this.context[key] = value;
    }
    
    /**
     * 获取错误统计
     * @returns {Object} 统计信息
     */
    getStats() {
        const errorTypes = {};
        this.errors.forEach(err => {
            errorTypes[err.type] = (errorTypes[err.type] || 0) + 1;
        });
        
        return {
            totalErrors: this.errors.length,
            errorTypes,
            recentActions: this.userActions.length,
            isEnabled: this.isEnabled
        };
    }
    
    /**
     * 获取所有错误
     * @returns {Array} 错误列表
     */
    getErrors() {
        return [...this.errors];
    }
    
    /**
     * 清空错误记录
     */
    clearErrors() {
        this.errors = [];
        this.userActions = [];
        localStorage.removeItem('error_monitor_errors');
    }
    
    /**
     * 导出错误报告
     * @returns {Object} 完整的错误报告
     */
    exportReport() {
        return {
            appName: this.appName,
            appVersion: this.appVersion,
            generatedAt: new Date().toISOString(),
            context: this.context,
            stats: this.getStats(),
            errors: this.errors,
            recentActions: this.userActions
        };
    }
    
    /**
     * 保存到 localStorage
     * @private
     */
    _saveToStorage() {
        try {
            const data = {
                errors: this.errors,
                userActions: this.userActions,
                savedAt: new Date().toISOString()
            };
            localStorage.setItem('error_monitor_errors', JSON.stringify(data));
        } catch (e) {
            // localStorage 可能已满或被禁用
            console.warn('[ErrorMonitor] 无法保存到 localStorage:', e.message);
        }
    }
    
    /**
     * 从 localStorage 恢复
     */
    restoreFromStorage() {
        try {
            const data = localStorage.getItem('error_monitor_errors');
            if (data) {
                const parsed = JSON.parse(data);
                this.errors = parsed.errors || [];
                this.userActions = parsed.userActions || [];
                console.log(`[ErrorMonitor] 已从存储恢复 ${this.errors.length} 个错误`);
            }
        } catch (e) {
            console.warn('[ErrorMonitor] 无法从存储恢复:', e.message);
        }
    }
    
    /**
     * 打印错误摘要
     */
    printSummary() {
        const stats = this.getStats();
        console.group('[ErrorMonitor] 错误摘要');
        console.log('总错误数:', stats.totalErrors);
        console.log('错误类型:', stats.errorTypes);
        console.log('最近操作:', stats.recentActions);
        console.groupEnd();
    }
}

/**
 * 性能监控器
 */
class PerformanceMonitor {
    constructor() {
        this.metrics = {};
        this.marks = new Map();
    }
    
    /**
     * 开始计时
     * @param {string} name - 计时名称
     */
    start(name) {
        this.marks.set(name, performance.now());
    }
    
    /**
     * 结束计时
     * @param {string} name - 计时名称
     * @returns {number} 耗时（毫秒）
     */
    end(name) {
        const start = this.marks.get(name);
        if (!start) {
            console.warn(`[PerformanceMonitor] 未找到计时起点: ${name}`);
            return 0;
        }
        
        const duration = performance.now() - start;
        this.metrics[name] = duration;
        this.marks.delete(name);
        
        console.log(`[PerformanceMonitor] ${name}: ${duration.toFixed(2)}ms`);
        return duration;
    }
    
    /**
     * 记录页面加载性能
     * 使用 Navigation Timing Level 2 API（替代已废弃的 performance.timing）
     */
    recordPageLoad() {
        if (!window.performance) {
            console.warn('[PerformanceMonitor] Performance API 不可用');
            return;
        }

        // 优先使用 Navigation Timing Level 2 API
        const navEntry = performance.getEntriesByType('navigation')[0];
        if (navEntry) {
            const metrics = {
                dnsLookup: Math.round(navEntry.domainLookupEnd - navEntry.domainLookupStart),
                tcpConnection: Math.round(navEntry.connectEnd - navEntry.connectStart),
                requestTime: Math.round(navEntry.responseEnd - navEntry.requestStart),
                domParsing: Math.round(navEntry.domInteractive - navEntry.responseEnd),
                domContentLoaded: Math.round(navEntry.domContentLoadedEventEnd - navEntry.fetchStart),
                pageLoad: Math.round(navEntry.loadEventEnd - navEntry.fetchStart),
                ttfb: Math.round(navEntry.responseStart - navEntry.fetchStart),
            };
            this.metrics.pageLoad = metrics;
            console.log('[PerformanceMonitor] 页面加载性能:', metrics);
            return metrics;
        }

        // 降级到旧的 timing API
        const timing = performance.timing;
        if (timing && timing.navigationStart) {
            const metrics = {
                dnsLookup: timing.domainLookupEnd - timing.domainLookupStart,
                tcpConnection: timing.connectEnd - timing.connectStart,
                requestTime: timing.responseEnd - timing.requestStart,
                domParsing: timing.domInteractive - timing.responseEnd,
                domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
                pageLoad: timing.loadEventEnd - timing.navigationStart,
            };
            this.metrics.pageLoad = metrics;
            console.log('[PerformanceMonitor] 页面加载性能 (legacy):', metrics);
            return metrics;
        }

        console.warn('[PerformanceMonitor] 无法获取页面加载指标');
    }
    
    /**
     * 获取所有性能指标
     */
    getMetrics() {
        return { ...this.metrics };
    }
    
    /**
     * 清空性能指标
     */
    clear() {
        this.metrics = {};
        this.marks.clear();
    }
}

// 创建全局实例
const globalErrorMonitor = new ErrorMonitor({
    appName: 'PromptTool',
    appVersion: '1.0.0',
    enableConsole: true
});

const globalPerformanceMonitor = new PerformanceMonitor();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ErrorMonitor,
        PerformanceMonitor,
        globalErrorMonitor,
        globalPerformanceMonitor
    };
} else {
    window.ErrorMonitor = ErrorMonitor;
    window.PerformanceMonitor = PerformanceMonitor;
    window.globalErrorMonitor = globalErrorMonitor;
    window.globalPerformanceMonitor = globalPerformanceMonitor;
    
    // 自动启用（生产环境也启用，静默模式不发 console）
    const isDev = typeof isDevelopment !== 'undefined' && isDevelopment();
    if (isDev) {
        globalErrorMonitor.enable();
    } else {
        // 生产环境启用监控，但关闭控制台输出
        globalErrorMonitor.enableConsole = false;
        globalErrorMonitor.enable();
        console.log('[ErrorMonitor] 生产环境静默监控已启用');
    }
}
