/**
 * 键盘快捷键模块
 * 
 * 提供全局快捷键注册、组合键支持、快捷键帮助等功能
 * 提升专业用户的操作效率
 */

/**
 * 快捷键管理器类
 */
class ShortcutManager {
    /**
     * @param {Object} options - 配置选项
     * @param {boolean} options.enableHelp - 是否启用帮助面板，默认 true
     * @param {string} options.helpKey - 显示帮助的快捷键，默认 '?'
     * @param {boolean} options.preventDefault - 是否阻止默认行为，默认 true
     */
    constructor(options = {}) {
        this.enableHelp = options.enableHelp !== false;
        this.helpKey = options.helpKey || '?';
        this.preventDefault = options.preventDefault !== false;
        
        this.shortcuts = new Map();   // 注册的快捷键
        this.isEnabled = false;       // 是否已启用
        this.helpPanel = null;        // 帮助面板元素
        
        // 绑定方法
        this._handleKeyDown = this._handleKeyDown.bind(this);
    }
    
    /**
     * 启用快捷键
     */
    enable() {
        if (this.isEnabled) return;
        
        document.addEventListener('keydown', this._handleKeyDown);
        this.isEnabled = true;
        
        if (this.enableHelp) {
            this._createHelpPanel();
        }
        
        console.log('[ShortcutManager] ✅ 快捷键系统已启用');
    }
    
    /**
     * 禁用快捷键
     */
    disable() {
        if (!this.isEnabled) return;
        
        document.removeEventListener('keydown', this._handleKeyDown);
        this.isEnabled = false;
        
        console.log('[ShortcutManager] ❌ 快捷键系统已禁用');
    }
    
    /**
     * 注册快捷键
     * @param {string} key - 快捷键（如 'Ctrl+S', 'Escape', '/'）
     * @param {Function} handler - 处理函数
     * @param {Object} options - 选项
     * @param {string} options.description - 描述（用于帮助面板）
     * @param {string} options.group - 分组（用于帮助面板）
     * @param {boolean} options.preventDefault - 是否阻止默认行为
     */
    register(key, handler, options = {}) {
        const normalized = this._normalizeKey(key);
        
        this.shortcuts.set(normalized, {
            key: normalized,
            originalKey: key,
            handler,
            description: options.description || '',
            group: options.group || '其他',
            preventDefault: options.preventDefault !== false
        });
        
        console.log(`[ShortcutManager] 注册快捷键: ${key}`);
    }
    
    /**
     * 注销快捷键
     * @param {string} key - 快捷键
     */
    unregister(key) {
        const normalized = this._normalizeKey(key);
        this.shortcuts.delete(normalized);
        console.log(`[ShortcutManager] 注销快捷键: ${key}`);
    }
    
    /**
     * 处理按键事件
     * @private
     */
    _handleKeyDown(event) {
        // 忽略输入框中的按键（除非是特殊快捷键）
        const target = event.target;
        const isInput = target.tagName === 'INPUT' || 
                       target.tagName === 'TEXTAREA' || 
                       target.isContentEditable;
        
        if (isInput && !this._isSpecialKey(event)) {
            return;
        }
        
        const keyCombo = this._getKeyCombo(event);
        const shortcut = this.shortcuts.get(keyCombo);
        
        if (shortcut) {
            // 阻止默认行为
            if (this.preventDefault && shortcut.preventDefault) {
                event.preventDefault();
            }
            
            // 执行处理函数
            try {
                shortcut.handler(event);
            } catch (error) {
                console.error(`[ShortcutManager] 快捷键执行错误 (${keyCombo}):`, error);
                
                // 报告错误
                if (window.globalErrorMonitor) {
                    window.globalErrorMonitor.reportError(error, {
                        shortcut: keyCombo,
                        context: 'keyboard-shortcut'
                    });
                }
            }
        }
    }
    
    /**
     * 获取按键组合字符串
     * @private
     */
    _getKeyCombo(event) {
        const parts = [];
        
        if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
        if (event.altKey) parts.push('Alt');
        if (event.shiftKey) parts.push('Shift');
        
        // 特殊键
        const specialKeys = {
            'Escape': 'Escape',
            'Enter': 'Enter',
            'Tab': 'Tab',
            ' ': 'Space',
            '/': '/',
            '?': '?',
            'ArrowUp': '↑',
            'ArrowDown': '↓',
            'ArrowLeft': '←',
            'ArrowRight': '→'
        };
        
        const key = specialKeys[event.key] || event.key.toUpperCase();
        parts.push(key);
        
        return parts.join('+');
    }
    
    /**
     * 标准化快捷键字符串
     * @private
     */
    _normalizeKey(key) {
        // 统一格式：Ctrl+S, Alt+F4, Shift+Enter 等
        return key.replace(/\s+/g, '').replace(/command/gi, 'Ctrl');
    }
    
    /**
     * 判断是否为特殊快捷键（即使在输入框中也应响应）
     * @private
     */
    _isSpecialKey(event) {
        const specialCombos = ['Escape', 'Ctrl+Enter', 'Ctrl+S'];
        const keyCombo = this._getKeyCombo(event);
        return specialCombos.includes(keyCombo);
    }
    
    /**
     * 创建帮助面板
     * @private
     */
    _createHelpPanel() {
        // 注册显示帮助的快捷键
        this.register(this.helpKey, () => this.toggleHelp(), {
            description: '显示/隐藏快捷键帮助',
            group: '系统'
        });
        
        // 创建帮助面板 HTML
        this.helpPanel = document.createElement('div');
        this.helpPanel.id = 'shortcut-help-panel';
        this.helpPanel.className = 'shortcut-help-panel';
        this.helpPanel.innerHTML = `
            <div class="shortcut-help-header">
                <h3>⌨️ 键盘快捷键</h3>
                <button class="shortcut-help-close" onclick="window.shortcutManager.hideHelp()">×</button>
            </div>
            <div class="shortcut-help-content" id="shortcut-help-content"></div>
        `;
        
        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .shortcut-help-panel {
                display: none;
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: var(--surface, #1A2332);
                border: 1px solid var(--border, #2D3A4F);
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                z-index: 10000;
                min-width: 500px;
                max-width: 80vw;
                max-height: 80vh;
                overflow: hidden;
            }
            
            .shortcut-help-panel.active {
                display: block;
            }
            
            .shortcut-help-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1rem 1.5rem;
                border-bottom: 1px solid var(--border, #2D3A4F);
            }
            
            .shortcut-help-header h3 {
                margin: 0;
                font-size: 1.1rem;
                color: var(--text-primary, #F1F5F9);
            }
            
            .shortcut-help-close {
                background: none;
                border: none;
                color: var(--text-secondary, #94A3B8);
                font-size: 1.5rem;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.2s;
            }
            
            .shortcut-help-close:hover {
                background: var(--surface-hover, #243044);
                color: var(--text-primary, #F1F5F9);
            }
            
            .shortcut-help-content {
                padding: 1.5rem;
                overflow-y: auto;
                max-height: calc(80vh - 60px);
            }
            
            .shortcut-group {
                margin-bottom: 1.5rem;
            }
            
            .shortcut-group-title {
                font-size: 0.85rem;
                font-weight: 600;
                color: var(--accent, #06B6D4);
                margin-bottom: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            
            .shortcut-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.5rem 0;
                border-bottom: 1px solid rgba(45, 58, 79, 0.3);
            }
            
            .shortcut-item:last-child {
                border-bottom: none;
            }
            
            .shortcut-keys {
                display: flex;
                gap: 0.3rem;
                align-items: center;
            }
            
            .shortcut-key {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 24px;
                padding: 0.2rem 0.5rem;
                background: var(--surface-hover, #243044);
                border: 1px solid var(--border, #2D3A4F);
                border-radius: 4px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.8rem;
                color: var(--text-primary, #F1F5F9);
                box-shadow: 0 2px 0 rgba(0, 0, 0, 0.2);
            }
            
            .shortcut-description {
                font-size: 0.85rem;
                color: var(--text-secondary, #94A3B8);
            }
            
            .shortcut-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                z-index: 9999;
            }
            
            .shortcut-overlay.active {
                display: block;
            }
        `;
        document.head.appendChild(style);
        
        // 添加到页面
        const overlay = document.createElement('div');
        overlay.className = 'shortcut-overlay';
        overlay.id = 'shortcut-overlay';
        overlay.onclick = () => this.hideHelp();
        
        document.body.appendChild(overlay);
        document.body.appendChild(this.helpPanel);
    }
    
    /**
     * 显示帮助面板
     */
    showHelp() {
        if (!this.helpPanel) return;
        
        // 更新帮助内容
        this._updateHelpContent();
        
        // 显示面板
        this.helpPanel.classList.add('active');
        document.getElementById('shortcut-overlay').classList.add('active');
    }
    
    /**
     * 隐藏帮助面板
     */
    hideHelp() {
        if (!this.helpPanel) return;
        
        this.helpPanel.classList.remove('active');
        document.getElementById('shortcut-overlay').classList.remove('active');
    }
    
    /**
     * 切换帮助面板
     */
    toggleHelp() {
        if (this.helpPanel?.classList.contains('active')) {
            this.hideHelp();
        } else {
            this.showHelp();
        }
    }
    
    /**
     * 更新帮助内容
     * @private
     */
    _updateHelpContent() {
        const contentEl = document.getElementById('shortcut-help-content');
        if (!contentEl) return;
        
        // 按分组整理快捷键
        const groups = {};
        this.shortcuts.forEach(shortcut => {
            if (!groups[shortcut.group]) {
                groups[shortcut.group] = [];
            }
            groups[shortcut.group].push(shortcut);
        });
        
        // 生成 HTML
        let html = '';
        Object.entries(groups).forEach(([groupName, shortcuts]) => {
            html += `<div class="shortcut-group">`;
            html += `<div class="shortcut-group-title">${groupName}</div>`;
            
            shortcuts.forEach(shortcut => {
                const keys = shortcut.originalKey.split('+').map(k => 
                    `<kbd class="shortcut-key">${k}</kbd>`
                ).join(' + ');
                
                html += `
                    <div class="shortcut-item">
                        <div class="shortcut-keys">${keys}</div>
                        <div class="shortcut-description">${shortcut.description || ''}</div>
                    </div>
                `;
            });
            
            html += `</div>`;
        });
        
        if (html === '') {
            html = '<p style="color: var(--text-secondary); text-align: center;">暂无注册的快捷键</p>';
        }
        
        contentEl.innerHTML = html;
    }
    
    /**
     * 获取所有已注册的快捷键
     */
    getShortcuts() {
        return Array.from(this.shortcuts.values());
    }
    
    /**
     * 销毁快捷键管理器
     */
    destroy() {
        this.disable();
        
        if (this.helpPanel) {
            this.helpPanel.remove();
            document.getElementById('shortcut-overlay')?.remove();
        }
        
        this.shortcuts.clear();
        console.log('[ShortcutManager] 快捷键管理器已销毁');
    }
}

// 创建全局实例
const globalShortcutManager = new ShortcutManager({
    enableHelp: true,
    helpKey: '?',
    preventDefault: true
});

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ShortcutManager,
        globalShortcutManager
    };
} else {
    window.ShortcutManager = ShortcutManager;
    window.globalShortcutManager = globalShortcutManager;
    window.shortcutManager = globalShortcutManager; // 方便在 HTML 中调用
    
    // 页面加载完成后自动启用
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            globalShortcutManager.enable();
        });
    } else {
        globalShortcutManager.enable();
    }
}
