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
    IDB_VERSION: 7,
    /** IndexedDB Object Store 名称 */
    OBJECT_STORES: {
        FILE_HANDLES: 'fileHandles',
        CONFIG: 'config',
        TABS: 'tabs',
        CHAT_DATA: 'chatData',
        CHAT_HISTORY: 'chatHistory'
    },
    /** IndexedDB 存储键名 */
    STORAGE_KEYS: {
        API_KEY: 'caret_api_key',
        BASE_URL: 'caret_base_url',
        MODEL: 'caret_model',
        TOKEN_BUDGET: 'caret_token_budget',
        COMPRESSION_STRATEGY: 'caret_compression_strategy',
        FONT_SIZE: 'caret_font_size'
    }
};

/**
 * 默认配置值
 */
export const DEFAULT_CONFIG = {
    /** 默认 Token 预算 */
    TOKEN_BUDGET: 4000,
    /** 默认压缩策略 */
    COMPRESSION_STRATEGY: 'smart',
    /** 默认字体大小 */
    FONT_SIZE: 14
};

/**
 * UI 相关常量
 */
export const UI_CONSTANTS = {
    /** 聊天模式 */
    MODE_CHAT: 'chat',
    /** Composer 模式 */
    MODE_COMPOSER: 'composer',
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
 * AI 相关常量
 */
export const AI_CONSTANTS = {
    /** 文件识别温度 */
    IDENTIFY_TEMPERATURE: 0.1,
    /** 修复补丁温度 */
    FIX_TEMPERATURE: 0.1,
    /** 自动修复最大重试次数 */
    AUTO_REPAIR_MAX_RETRIES: 2
};

/**
 * 文件系统相关常量
 */
export const FS_CONSTANTS = {
    /** 文件内容缓存最大大小 */
    FILE_CACHE_MAX_SIZE: 50,
    /** Repo Map 删除文件阈值（超过此数量触发全量重建） */
    REPO_MAP_DELETE_THRESHOLD: 10,
    /** 大文件阈值（字节），超过此大小启用分块处理 */
    LARGE_FILE_THRESHOLD: 10 * 1024 * 1024, // 10MB
    /** 大文件分块大小（字节） */
    LARGE_FILE_CHUNK_SIZE: 1024 * 1024, // 1MB
    /** 虚拟滚动可见行数 */
    VIRTUAL_SCROLL_VISIBLE_LINES: 50
};

/**
 * 补丁引擎相关常量
 */
export const PATCH_CONSTANTS = {
    /** DMP 匹配阈值 */
    DMP_MATCH_THRESHOLD: 0.2,
    /** DMP 删除阈值 */
    DMP_DELETE_THRESHOLD: 0.5
};

/**
 * 上下文管理器相关常量
 */
export const CONTEXT_CONSTANTS = {
    /** Token 估算：每字符 Token 数（代码） */
    CHARS_PER_TOKEN: 3.5,
    /** Token 估算：标识符每字符 Token 数 */
    IDENTIFIER_CHARS_PER_TOKEN: 4,
    /** Token 估算：最小剩余预算（低于此值跳过文件） */
    MIN_REMAINING_BUDGET: 100,
    /** 文件重要性权重：被引用次数 */
    IMPORTANCE_WEIGHT_IMPORT_COUNT: 0.4,
    /** 文件重要性权重：导出数量 */
    IMPORTANCE_WEIGHT_EXPORT: 0.3,
    /** 文件重要性权重：目录深度 */
    IMPORTANCE_WEIGHT_DEPTH: 0.2,
    /** 文件重要性权重：文件大小 */
    IMPORTANCE_WEIGHT_SIZE: 0.1
};

/**
 * 编辑器相关常量
 */
export const EDITOR_CONSTANTS = {
    /** 大文件处理：启用虚拟滚动的最小行数 */
    VIRTUAL_SCROLL_MIN_LINES: 10000,
    /** 大文件处理：分块加载大小（行数） */
    CHUNK_LOAD_LINES: 5000
};
