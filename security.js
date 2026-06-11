/**
 * 安全工具模块
 * 
 * 提供输入验证、XSS 防护、数据清理等安全功能
 */

/**
 * HTML 转义 - 防止 XSS 攻击
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return String(str);
    
    const htmlEntities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };
    
    return str.replace(/[&<>"'`=\/]/g, char => htmlEntities[char]);
}

/**
 * HTML 反转义 - 将转义后的字符串还原
 * @param {string} str - 转义后的字符串
 * @returns {string} 原始字符串
 */
function unescapeHtml(str) {
    if (typeof str !== 'string') return String(str);
    
    const htmlEntities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': "'",
        '&#x2F;': '/',
        '&#x60;': '`',
        '&#x3D;': '='
    };
    
    return str.replace(/&(?:amp|lt|gt|quot|#039|#x2F|#x60|#x3D);/g, entity => htmlEntities[entity]);
}

/**
 * 验证用户输入 - 严格的输入验证
 * @param {string} input - 用户输入
 * @param {Object} options - 验证选项
 * @returns {Object} { valid: boolean, error?: string, sanitized?: string }
 */
function validateInput(input, options = {}) {
    const defaults = {
        maxLength: 5000,
        minLength: 0,
        allowHtml: false,
        forbiddenPatterns: [
            /<script/i,
            /javascript:/i,
            /on\w+\s*=/i,  // onclick=, onerror= 等
            /eval\s*\(/i,
            /document\./i,
            /window\./i,
            /alert\s*\(/i,
            /prompt\s*\(/i,
            /confirm\s*\(/i
        ],
        allowedChars: null  // null 表示允许所有可见字符
    };
    
    const config = { ...defaults, ...options };
    
    // 类型检查
    if (typeof input !== 'string') {
        return { valid: false, error: '输入必须是字符串' };
    }
    
    // 长度检查
    if (input.length > config.maxLength) {
        return { valid: false, error: `输入超过最大长度 ${config.maxLength}` };
    }
    
    if (input.length < config.minLength) {
        return { valid: false, error: `输入少于最小长度 ${config.minLength}` };
    }
    
    // 禁止模式检查
    for (const pattern of config.forbiddenPatterns) {
        if (pattern.test(input)) {
            return { valid: false, error: '包含不安全内容' };
        }
    }
    
    // 允许的字符检查
    if (config.allowedChars && !config.allowedChars.test(input)) {
        return { valid: false, error: '包含不允许的字符' };
    }
    
    // HTML 处理
    let sanitized = input;
    if (!config.allowHtml) {
        sanitized = escapeHtml(input);
    } else {
        // 即使允许 HTML，也要进行 sanitization
        sanitized = sanitizeHtml(input);
    }
    
    return { valid: true, sanitized };
}

/**
 * HTML Sanitization - 清理危险的 HTML 标签和属性
 * @param {string} html - HTML 字符串
 * @returns {string} 清理后的 HTML
 */
function sanitizeHtml(html) {
    if (typeof html !== 'string') return '';
    
    // 移除 script 标签及其内容
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // 移除危险的事件处理器属性
    html = html.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
    html = html.replace(/\son\w+\s*=\s*[^\s>]*/gi, '');
    
    // 移除 javascript: 协议
    html = html.replace(/javascript\s*:/gi, '');
    
    // 移除 data: 协议（可能用于 XSS）
    html = html.replace(/data\s*:\s*text\/html/gi, '');
    
    // 只允许安全的标签
    const allowedTags = ['b', 'i', 'u', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span'];
    const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
    
    html = html.replace(tagRegex, (match, tagName) => {
        if (allowedTags.includes(tagName.toLowerCase())) {
            return match;
        }
        return '';
    });
    
    // 清理 a 标签的 href
    html = html.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
        // 只允许 http, https, mailto 协议
        const cleanAttrs = attrs.replace(/href\s*=\s*["']([^"']*)["']/gi, (hrefMatch, url) => {
            if (/^(https?:|mailto:)/i.test(url)) {
                return hrefMatch;
            }
            return '';
        });
        return `<a${cleanAttrs}>`;
    });
    
    return html;
}

/**
 * 验证邮箱格式
 * @param {string} email - 邮箱地址
 * @returns {boolean} 是否有效
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * 验证 URL 格式
 * @param {string} url - URL 地址
 * @returns {boolean} 是否有效
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * 生成 CSRF Token
 * @returns {string} CSRF Token
 */
function generateCsrfToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 验证 CSRF Token
 * @param {string} token - Token
 * @param {string} expected - 期望的 Token
 * @returns {boolean} 是否匹配
 */
function verifyCsrfToken(token, expected) {
    if (!token || !expected) return false;
    return token === expected;
}

/**
 * 速率限制器
 */
class RateLimiter {
    /**
     * @param {number} maxRequests - 最大请求数
     * @param {number} windowMs - 时间窗口（毫秒）
     */
    constructor(maxRequests = 10, windowMs = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = new Map();
    }
    
    /**
     * 检查是否可以执行操作
     * @param {string} key - 标识符（如用户ID、IP等）
     * @returns {Object} { allowed: boolean, retryAfter?: number }
     */
    canProceed(key = 'default') {
        const now = Date.now();
        
        if (!this.requests.has(key)) {
            this.requests.set(key, []);
        }
        
        const timestamps = this.requests.get(key);
        
        // 清理过期记录
        const validTimestamps = timestamps.filter(t => now - t < this.windowMs);
        this.requests.set(key, validTimestamps);
        
        if (validTimestamps.length >= this.maxRequests) {
            const oldest = validTimestamps[0];
            const retryAfter = Math.ceil((this.windowMs - (now - oldest)) / 1000);
            return { allowed: false, retryAfter };
        }
        
        validTimestamps.push(now);
        return { allowed: true };
    }
    
    /**
     * 重置指定 key 的限制
     * @param {string} key - 标识符
     */
    reset(key = 'default') {
        this.requests.delete(key);
    }
    
    /**
     * 重置所有限制
     */
    resetAll() {
        this.requests.clear();
    }
}

/**
 * 防抖函数
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(fn, delay = 300) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * 节流函数
 * @param {Function} fn - 要节流的函数
 * @param {number} interval - 间隔时间（毫秒）
 * @returns {Function} 节流后的函数
 */
function throttle(fn, interval = 300) {
    let lastTime = 0;
    return function(...args) {
        const now = Date.now();
        if (now - lastTime >= interval) {
            lastTime = now;
            fn.apply(this, args);
        }
    };
}

// 导出工具函数
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        unescapeHtml,
        validateInput,
        sanitizeHtml,
        isValidEmail,
        isValidUrl,
        generateCsrfToken,
        verifyCsrfToken,
        RateLimiter,
        debounce,
        throttle
    };
} else {
    window.SecurityUtils = {
        escapeHtml,
        unescapeHtml,
        validateInput,
        sanitizeHtml,
        isValidEmail,
        isValidUrl,
        generateCsrfToken,
        verifyCsrfToken,
        RateLimiter,
        debounce,
        throttle
    };
}
