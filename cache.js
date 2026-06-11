/**
 * 请求缓存模块
 * 
 * 提供智能的请求缓存、去重、重试等功能
 * 优化网络请求性能，减少重复请求
 */

/**
 * 请求缓存类
 */
class RequestCache {
    /**
     * @param {Object} options - 配置选项
     * @param {number} options.ttl - 缓存有效期（毫秒），默认 5 分钟
     * @param {number} options.maxSize - 最大缓存条目数，默认 100
     * @param {boolean} options.enableStaleWhileRevalidate - 是否启用 stale-while-revalidate，默认 true
     */
    constructor(options = {}) {
        this.ttl = options.ttl || 5 * 60 * 1000; // 5 分钟
        this.maxSize = options.maxSize || 100;
        this.enableStaleWhileRevalidate = options.enableStaleWhileRevalidate !== false;
        
        this.cache = new Map();      // 缓存数据
        this.pending = new Map();    // 进行中的请求
        this.stats = {               // 统计信息
            hits: 0,
            misses: 0,
            evictions: 0
        };
    }
    
    /**
     * 执行带缓存的请求
     * @param {string} key - 缓存键
     * @param {Function} fn - 请求函数，返回 Promise
     * @param {Object} options - 额外选项
     * @param {number} options.forceRefresh - 是否强制刷新
     * @param {number} options.staleTime - stale 时间（毫秒）
     * @returns {Promise<any>} 请求结果
     */
    async fetch(key, fn, options = {}) {
        const now = Date.now();
        const cached = this.cache.get(key);
        
        // 强制刷新
        if (options.forceRefresh) {
            this.cache.delete(key);
            return this._executeRequest(key, fn);
        }
        
        // 检查是否有进行中的请求（请求去重）
        if (this.pending.has(key)) {
            console.log(`[RequestCache] 请求去重: ${key}`);
            return this.pending.get(key);
        }
        
        // 检查缓存
        if (cached) {
            const age = now - cached.timestamp;
            
            // 缓存未过期，直接返回
            if (age < this.ttl) {
                this.stats.hits++;
                console.log(`[RequestCache] 缓存命中: ${key} (age: ${age}ms)`);
                return cached.data;
            }
            
            // stale-while-revalidate: 返回旧数据，同时后台刷新
            if (this.enableStaleWhileRevalidate && age < this.ttl * 2) {
                console.log(`[RequestCache] Stale while revalidate: ${key}`);
                this._executeRequest(key, fn).catch(() => {
                    // 后台刷新失败，静默处理
                });
                this.stats.hits++;
                return cached.data;
            }
            
            // 缓存已过期，删除
            this.cache.delete(key);
        }
        
        this.stats.misses++;
        return this._executeRequest(key, fn);
    }
    
    /**
     * 执行实际请求
     * @private
     */
    async _executeRequest(key, fn) {
        try {
            // 创建新的请求 Promise
            const promise = fn().then(data => {
                // 请求成功，存入缓存
                this._setCache(key, data);
                this.pending.delete(key);
                return data;
            }).catch(error => {
                // 请求失败，清除 pending
                this.pending.delete(key);
                throw error;
            });
            
            // 记录 pending 请求
            this.pending.set(key, promise);
            
            return await promise;
        } catch (error) {
            console.error(`[RequestCache] 请求失败: ${key}`, error);
            throw error;
        }
    }
    
    /**
     * 设置缓存
     * @private
     */
    _setCache(key, data) {
        // 如果缓存已满，删除最旧的条目
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            this.stats.evictions++;
        }
        
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }
    
    /**
     * 手动设置缓存
     * @param {string} key - 缓存键
     * @param {any} data - 数据
     */
    set(key, data) {
        this._setCache(key, data);
    }
    
    /**
     * 获取缓存
     * @param {string} key - 缓存键
     * @returns {any|null} 缓存数据，不存在返回 null
     */
    get(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        const age = Date.now() - cached.timestamp;
        if (age >= this.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }
    
    /**
     * 删除缓存
     * @param {string} key - 缓存键
     */
    delete(key) {
        this.cache.delete(key);
    }
    
    /**
     * 清空所有缓存
     */
    clear() {
        this.cache.clear();
        this.pending.clear();
    }
    
    /**
     * 获取统计信息
     * @returns {Object} 统计数据
     */
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
            : 0;
        
        return {
            ...this.stats,
            cacheSize: this.cache.size,
            pendingCount: this.pending.size,
            hitRate: `${hitRate}%`
        };
    }
    
    /**
     * 打印统计信息
     */
    printStats() {
        const stats = this.getStats();
        console.table(stats);
    }
}

/**
 * 批量请求管理器
 * 用于合并多个相同类型的请求
 */
class BatchRequestManager {
    /**
     * @param {number} delay - 批量延迟（毫秒），默认 100ms
     */
    constructor(delay = 100) {
        this.delay = delay;
        this.batch = new Map();
        this.timers = new Map();
    }
    
    /**
     * 添加请求到批处理
     * @param {string} group - 批处理组名
     * @param {string} key - 请求键
     * @param {Function} fn - 请求函数
     * @returns {Promise<any>}
     */
    add(group, key, fn) {
        return new Promise((resolve, reject) => {
            if (!this.batch.has(group)) {
                this.batch.set(group, []);
            }
            
            this.batch.get(group).push({ key, fn, resolve, reject });
            
            // 如果还没有定时器，创建一个
            if (!this.timers.has(group)) {
                const timer = setTimeout(() => {
                    this._flush(group);
                }, this.delay);
                this.timers.set(group, timer);
            }
        });
    }
    
    /**
     * 执行批处理
     * @private
     */
    async _flush(group) {
        this.timers.delete(group);
        const requests = this.batch.get(group) || [];
        this.batch.delete(group);
        
        if (requests.length === 0) return;
        
        console.log(`[BatchRequest] 执行批处理: ${group} (${requests.length} 个请求)`);
        
        // 并行执行所有请求
        const results = await Promise.allSettled(
            requests.map(({ key, fn }) =>
                fn().then(data => ({ key, success: true, data }))
                    .catch(error => ({ key, success: false, error }))
            )
        );
        
        // 分发结果
        results.forEach((result, index) => {
            const { resolve, reject } = requests[index];
            if (result.status === 'fulfilled') {
                const { success, data, error } = result.value;
                if (success) {
                    resolve(data);
                } else {
                    reject(error);
                }
            } else {
                reject(result.reason);
            }
        });
    }
    
    /**
     * 取消批处理
     * @param {string} group - 批处理组名
     */
    cancel(group) {
        if (this.timers.has(group)) {
            clearTimeout(this.timers.get(group));
            this.timers.delete(group);
        }
        
        if (this.batch.has(group)) {
            const requests = this.batch.get(group);
            requests.forEach(({ reject }) => {
                reject(new Error('批处理已取消'));
            });
            this.batch.delete(group);
        }
    }
}

/**
 * 请求重试器
 */
class RequestRetry {
    /**
     * @param {Object} options - 配置选项
     * @param {number} options.maxRetries - 最大重试次数，默认 3
     * @param {number} options.baseDelay - 基础延迟（毫秒），默认 1000
     * @param {number} options.maxDelay - 最大延迟（毫秒），默认 10000
     * @param {Function} options.shouldRetry - 判断是否应该重试的函数
     */
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.baseDelay = options.baseDelay || 1000;
        this.maxDelay = options.maxDelay || 10000;
        this.shouldRetry = options.shouldRetry || ((error) => {
            // 默认：网络错误才重试
            return error instanceof TypeError || error.message.includes('network');
        });
    }
    
    /**
     * 执行带重试的请求
     * @param {Function} fn - 请求函数
     * @param {number} attempt - 当前尝试次数（内部使用）
     * @returns {Promise<any>}
     */
    async execute(fn, attempt = 1) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= this.maxRetries || !this.shouldRetry(error)) {
                throw error;
            }
            
            // 指数退避
            const delay = Math.min(
                this.baseDelay * Math.pow(2, attempt - 1),
                this.maxDelay
            );
            
            console.log(`[RequestRetry] 重试 ${attempt}/${this.maxRetries}，等待 ${delay}ms`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            return this.execute(fn, attempt + 1);
        }
    }
}

// 创建全局实例
const globalRequestCache = new RequestCache();
const globalBatchManager = new BatchRequestManager();
const globalRequestRetry = new RequestRetry();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        RequestCache,
        BatchRequestManager,
        RequestRetry,
        globalRequestCache,
        globalBatchManager,
        globalRequestRetry
    };
} else {
    window.RequestCache = RequestCache;
    window.BatchRequestManager = BatchRequestManager;
    window.RequestRetry = RequestRetry;
    window.globalRequestCache = globalRequestCache;
    window.globalBatchManager = globalBatchManager;
    window.globalRequestRetry = globalRequestRetry;
}
