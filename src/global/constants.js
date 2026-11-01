/**
 * @fileoverview 应用常量配置
 * @description 集中管理应用中的常量、默认值和配置项，便于维护和修改
 */

/**
 * 存储相关常量
 */
export const STORAGE_CONSTANTS = {
    /** IndexedDB 数据库名称 */
    IDB_DB_NAME: 'CaretStore',
    /** IndexedDB 数据库版本 */
    IDB_VERSION: 8,
    /** IndexedDB Object Store 名称 */
    OBJECT_STORES: {
        FILE_HANDLES: 'fileHandles',
        CONFIG: 'config',
        TABS: 'tabs',
        PROJECTS: 'projects',
        SESSIONS: 'sessions',
        SESSION_DATA: 'sessionData'
    },
    /** 主题和语言保存在 localStorage，首屏渲染前就要读取 */
    PREFERENCES_KEY: 'caret_preferences'
};

/**
 * 默认配置值
 */
export const DEFAULT_CONFIG = {
    /** 默认字体大小 */
    FONT_SIZE: 14,
    /** 默认模型服务 */
    PROVIDER: 'deepseek'
};

/**
 * 文件树相关常量
 */
export const UI_CONSTANTS = {
    /** 文件树懒加载阈值（超过此数量启用懒加载） */
    FILE_TREE_LAZY_LOAD_THRESHOLD: 50,
    /** 文件树初始渲染数量 */
    FILE_TREE_INITIAL_RENDER_COUNT: 10,
    /** 文件树最大节点数 */
    FILE_TREE_MAX_NODES: 1000,
    /** 文件树双击检测时间窗口（毫秒） */
    FILE_TREE_DOUBLE_CLICK_TIMEOUT: 400
};

/**
 * 文件系统相关常量
 */
export const FS_CONSTANTS = {
    /** 文件内容缓存最大大小 */
    FILE_CACHE_MAX_SIZE: 200,
    /** 大文件阈值（字节），超过后关闭编辑器的部分功能 */
    LARGE_FILE_THRESHOLD: 10 * 1024 * 1024,
    /** Agent 能读取的最大文件（字节） */
    AGENT_FILE_LIMIT: 2 * 1000 * 1000
};

/**
 * Agent 相关常量
 */
export const AGENT_CONSTANTS = {
    /** 单次运行最多调用模型的轮数 */
    MAX_STEPS: 40,
    /** read 一次返回的最大行数 */
    READ_LINES: 2000,
    /** read 一次返回的最大字符数 */
    READ_CHARS: 60000,
    /** grep 最多返回的匹配行 */
    GREP_HITS: 100,
    /** grep 结果每行保留的字符数 */
    GREP_LINE_CHARS: 200,
    /** grep 同时读取的文件数 */
    GREP_CONCURRENCY: 16,
    /** 目录概览的最大行数 */
    OUTLINE_LINES: 300,
    /** 项目说明文件保留的字符数 */
    RULES_CHARS: 8000
};

/**
 * 会话历史相关常量
 */
export const HISTORY_CONSTANTS = {
    /** 每个项目保留的会话数量，超出时删除最旧的 */
    MAX_SESSIONS: 100,
    /** 会话标题的最大字符数 */
    TITLE_CHARS: 60,
    /** 保存间隔（毫秒），连续变化时合并 */
    SAVE_DELAY: 300
};

/**
 * 模型服务。只列出实测允许网页直连的服务，其他服务用「自定义」
 */
export const PROVIDERS = {
    deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com', keyPage: 'https://platform.deepseek.com/api_keys', prefer: /flash|chat/ },
    kimi: { name: 'Kimi', url: 'https://api.moonshot.cn/v1', keyPage: 'https://platform.moonshot.cn/console/api-keys', prefer: /k2/ },
    qwen: { name: 'Qwen', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyPage: 'https://bailian.console.aliyun.com/', prefer: /coder|max/ },
    openai: { name: 'OpenAI', url: 'https://api.openai.com/v1', keyPage: 'https://platform.openai.com/api-keys', prefer: /^gpt-5/ },
    openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', keyPage: 'https://openrouter.ai/keys', prefer: /deepseek|qwen/ },
    custom: { name: '', url: '', keyPage: '', prefer: null }
};

/** 当前版本 */
export const VERSION = '0.4.1';
