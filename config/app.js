// 应用配置
const config = {
  // 飞书应用配置
  feishu: {
    baseId: process.env.FEISHU_BASE_ID || 'KnX9bIOTKaE3trspPCycfFMjnkg',
    personalBaseToken: process.env.FEISHU_PERSONAL_BASE_TOKEN || 'pt-bOGOfkA-lYy4LMm3KG06xw28GPVfHleZaNRqmWiYAQAABEBE9RyAClgqPlmY'
  },

  // API配置
  api: {
    maxPageSize: 100,
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 30000
  },

  // 数据处理配置
  processing: {
    batchSize: 50,
    maxRecords: 10000,
    enableProgressTracking: true
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: true,
    enableFile: false
  },

  // 功能开关
  features: {
    enableDiffAnalysis: true,
    enableFieldTypeValidation: true,
    enableAutoRetry: true,
    enableProgressBar: true
  }
};

module.exports = config;