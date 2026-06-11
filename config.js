/**
 * 应用配置管理
 * 
 * 从环境变量读取配置，提供类型安全的配置访问
 * 支持开发环境和生产环境的配置隔离
 */

// 配置接口定义
const AppConfig = {
  // Supabase 配置
  supabase: {
    url: '',
    anonKey: '',
    serviceRoleToken: ''
  },
  
  // 管理员配置
  admin: {
    email: ''
  },
  
  // 应用配置
  app: {
    url: '',
    isDev: false
  }
};

/**
 * 初始化配置
 * 根据运行环境加载相应的配置
 */
function initConfig() {
  // 检测是否为浏览器环境
  const isBrowser = typeof window !== 'undefined';
  
  if (isBrowser) {
    // 浏览器环境：从全局变量或硬编码默认值读取
    // 注意：在生产环境中，这些值应该通过构建工具注入
    AppConfig.supabase.url = window.__APP_CONFIG?.SUPABASE_URL || 
                             'https://aishmynicfrueempsbun.supabase.co';
    AppConfig.supabase.anonKey = window.__APP_CONFIG?.SUPABASE_ANON_KEY || 
                                 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpc2hteW5pY2ZydWVlbXBzYnVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MDczMTksImV4cCI6MjA5NjE4MzMxOX0.tNxiKnRADMDKJaDYaFpm6gTEg_Nv8bI8Ql05SdGsST4';
    
    AppConfig.admin.email = window.__APP_CONFIG?.ADMIN_EMAIL || 
                            'hvho1982@163.com';
    
    AppConfig.app.url = window.__APP_CONFIG?.APP_URL || 
                        'https://www.prompt-tool.dedyn.io';
    
    AppConfig.app.isDev = window.location.hostname === 'localhost' || 
                          window.location.hostname === '127.0.0.1';
  } else {
    // Node.js 环境：从 process.env 读取
    AppConfig.supabase.url = process.env.VITE_SUPABASE_URL || '';
    AppConfig.supabase.anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
    AppConfig.supabase.serviceRoleToken = process.env.SUPABASE_ACCESS_TOKEN || '';
    
    AppConfig.admin.email = process.env.ADMIN_EMAIL || '';
    AppConfig.app.url = process.env.APP_URL || 'http://localhost:8080';
    AppConfig.app.isDev = process.env.NODE_ENV !== 'production';
  }
  
  // 验证必需的配置项
  validateConfig();
  
  return AppConfig;
}

/**
 * 验证配置完整性
 */
function validateConfig() {
  const required = [
    { key: 'supabase.url', value: AppConfig.supabase.url },
    { key: 'supabase.anonKey', value: AppConfig.supabase.anonKey },
    { key: 'admin.email', value: AppConfig.admin.email }
  ];
  
  const missing = required.filter(item => !item.value);
  
  if (missing.length > 0) {
    console.warn('[Config] 缺少必需的配置项:', missing.map(m => m.key).join(', '));
    console.warn('[Config] 请检查 .env 文件或环境变量设置');
  }
}

/**
 * 获取配置值
 * @param {string} path - 配置路径，如 'supabase.url'
 * @returns {*} 配置值
 */
function getConfig(path) {
  const keys = path.split('.');
  let value = AppConfig;
  
  for (const key of keys) {
    if (value === undefined || value === null) {
      console.error(`[Config] 配置路径不存在: ${path}`);
      return undefined;
    }
    value = value[key];
  }
  
  return value;
}

/**
 * 检查是否为开发环境
 */
function isDevelopment() {
  return AppConfig.app.isDev;
}

/**
 * 检查是否为生产环境
 */
function isProduction() {
  return !AppConfig.app.isDev;
}

// 导出配置和工具函数
if (typeof module !== 'undefined' && module.exports) {
  // Node.js 环境
  module.exports = {
    AppConfig,
    initConfig,
    getConfig,
    isDevelopment,
    isProduction
  };
} else {
  // 浏览器环境：挂载到 window
  window.AppConfig = AppConfig;
  window.initConfig = initConfig;
  window.getConfig = getConfig;
  window.isDevelopment = isDevelopment;
  window.isProduction = isProduction;
}

// 自动初始化
if (typeof window !== 'undefined') {
  initConfig();
}
