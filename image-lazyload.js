/**
 * 图片懒加载模块
 * 
 * 使用 Intersection Observer API 实现高效的图片懒加载
 * 支持占位图、渐进式加载、WebP 检测等功能
 */

/**
 * 图片懒加载器类
 */
class ImageLazyLoader {
    /**
     * @param {Object} options - 配置选项
     * @param {string} options.placeholder - 占位图 URL 或颜色
     * @param {string} options.loadingClass - 加载中的 CSS 类名
     * @param {string} options.loadedClass - 加载完成的 CSS 类名
     * @param {string} options.errorClass - 加载失败的 CSS 类名
     * @param {number} options.rootMargin - 观察器边距，默认 '200px'
     * @param {number} options.threshold - 触发阈值，默认 0.01
     * @param {boolean} options.enableWebP - 是否启用 WebP 检测，默认 true
     */
    constructor(options = {}) {
        this.placeholder = options.placeholder || 'data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICBAEAOw==';
        this.loadingClass = options.loadingClass || 'lazy-loading';
        this.loadedClass = options.loadedClass || 'lazy-loaded';
        this.errorClass = options.errorClass || 'lazy-error';
        this.rootMargin = options.rootMargin || '200px';
        this.threshold = options.threshold || 0.01;
        this.enableWebP = options.enableWebP !== false;
        
        this.observer = null;
        this.supportsWebP = false;
        this.images = new Set();
        
        // 检测 WebP 支持
        if (this.enableWebP) {
            this._checkWebPSupport();
        }
    }
    
    /**
     * 初始化懒加载
     */
    init() {
        if (!('IntersectionObserver' in window)) {
            console.warn('[ImageLazyLoader] IntersectionObserver 不支持，使用降级方案');
            this._fallbackLoadAll();
            return;
        }
        
        this.observer = new IntersectionObserver(
            (entries) => this._handleIntersect(entries),
            {
                root: null,
                rootMargin: this.rootMargin,
                threshold: this.threshold
            }
        );
        
        // 观察所有带 data-src 的图片
        this._observeImages();
        
        console.log('[ImageLazyLoader] ✅ 图片懒加载已初始化');
    }
    
    /**
     * 检测 WebP 支持
     * @private
     */
    _checkWebPSupport() {
        const webP = new Image();
        webP.onload = webP.onerror = () => {
            this.supportsWebP = webP.height === 2;
            console.log(`[ImageLazyLoader] WebP 支持: ${this.supportsWebP}`);
        };
        webP.src = 'data:image/webp;base64,UklGRgIAAACQAgAFAABBAAEAABAAEAACAgMAAwAEFAAAhar9jAAAAA==';
    }
    
    /**
     * 观察图片
     * @private
     */
    _observeImages() {
        const images = document.querySelectorAll('img[data-src]:not([data-loaded])');
        
        images.forEach(img => {
            this.images.add(img);
            this.observer.observe(img);
            
            // 设置占位图
            if (!img.src || img.src === window.location.href) {
                img.src = this.placeholder;
            }
            
            // 添加加载类
            img.classList.add(this.loadingClass);
        });
        
        console.log(`[ImageLazyLoader] 开始观察 ${images.length} 张图片`);
    }
    
    /**
     * 处理交叉观察
     * @private
     */
    _handleIntersect(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                this._loadImage(img);
                this.observer.unobserve(img);
            }
        });
    }
    
    /**
     * 加载图片
     * @private
     */
    _loadImage(img) {
        const src = img.dataset.src;
        if (!src) return;
        
        // 检查是否需要 WebP 版本
        let finalSrc = src;
        if (this.supportsWebP && img.dataset.webp) {
            finalSrc = img.dataset.webp;
        }
        
        // 创建新图片预加载
        const tempImg = new Image();
        
        tempImg.onload = () => {
            img.src = finalSrc;
            img.classList.remove(this.loadingClass);
            img.classList.add(this.loadedClass);
            img.dataset.loaded = 'true';
            this.images.delete(img);
            
            // 触发自定义事件
            img.dispatchEvent(new CustomEvent('lazyloaded', { detail: { src: finalSrc } }));
        };
        
        tempImg.onerror = () => {
            img.classList.remove(this.loadingClass);
            img.classList.add(this.errorClass);
            img.alt = img.alt || '图片加载失败';
            
            // 触发自定义事件
            img.dispatchEvent(new CustomEvent('lazyerror', { detail: { src: finalSrc } }));
        };
        
        tempImg.src = finalSrc;
    }
    
    /**
     * 降级方案：加载所有图片
     * @private
     */
    _fallbackLoadAll() {
        const images = document.querySelectorAll('img[data-src]');
        images.forEach(img => {
            const src = img.dataset.src;
            if (src) {
                img.src = src;
                img.dataset.loaded = 'true';
            }
        });
        console.log(`[ImageLazyLoader] 降级方案：直接加载 ${images.length} 张图片`);
    }
    
    /**
     * 手动触发图片加载
     * @param {HTMLElement} img - 图片元素
     */
    loadImage(img) {
        if (this.observer) {
            this.observer.unobserve(img);
        }
        this._loadImage(img);
    }
    
    /**
     * 刷新观察器（动态添加图片后调用）
     */
    refresh() {
        if (this.observer) {
            this._observeImages();
        }
    }
    
    /**
     * 销毁懒加载器
     */
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.images.clear();
        console.log('[ImageLazyLoader] ❌ 懒加载器已销毁');
    }
    
    /**
     * 获取统计信息
     */
    getStats() {
        return {
            totalObserved: this.images.size,
            supportsWebP: this.supportsWebP,
            isEnabled: !!this.observer
        };
    }
}

/**
 * 响应式图片助手
 */
class ResponsiveImageHelper {
    /**
     * 根据屏幕宽度选择合适的图片尺寸
     * @param {Object} sizes - 尺寸映射 { small: 'url', medium: 'url', large: 'url' }
     * @returns {string} 合适的图片 URL
     */
    static selectSize(sizes) {
        const width = window.innerWidth;
        
        if (width < 768) return sizes.small || sizes.medium || sizes.large;
        if (width < 1200) return sizes.medium || sizes.large || sizes.small;
        return sizes.large || sizes.medium || sizes.small;
    }
    
    /**
     * 生成 srcset 属性值
     * @param {Object} sources - 源映射 { '400w': 'url-400.jpg', '800w': 'url-800.jpg' }
     * @returns {string} srcset 字符串
     */
    static generateSrcset(sources) {
        return Object.entries(sources)
            .map(([size, url]) => `${url} ${size}`)
            .join(', ');
    }
    
    /**
     * 生成 sizes 属性值
     * @param {Object} breakpoints - 断点映射 { '(max-width: 768px)': '100vw', '(max-width: 1200px)': '50vw' }
     * @returns {string} sizes 字符串
     */
    static generateSizes(breakpoints) {
        return Object.entries(breakpoints)
            .map(([query, size]) => `${query} ${size}`)
            .join(', ') + ', 33vw';
    }
}

// 创建全局实例
const globalImageLazyLoader = new ImageLazyLoader({
    placeholder: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E',
    loadingClass: 'lazy-loading',
    loadedClass: 'lazy-loaded',
    errorClass: 'lazy-error',
    rootMargin: '200px',
    enableWebP: true
});

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ImageLazyLoader,
        ResponsiveImageHelper,
        globalImageLazyLoader
    };
} else {
    window.ImageLazyLoader = ImageLazyLoader;
    window.ResponsiveImageHelper = ResponsiveImageHelper;
    window.globalImageLazyLoader = globalImageLazyLoader;
    
    // 页面加载完成后自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            globalImageLazyLoader.init();
        });
    } else {
        globalImageLazyLoader.init();
    }
}
