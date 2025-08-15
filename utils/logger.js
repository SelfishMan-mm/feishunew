// 简单的日志工具
class Logger {
  static log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };
    
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || '');
    return logEntry;
  }

  static info(message, data) {
    return this.log('info', message, data);
  }

  static warn(message, data) {
    return this.log('warn', message, data);
  }

  static error(message, data) {
    return this.log('error', message, data);
  }

  static debug(message, data) {
    return this.log('debug', message, data);
  }
}

module.exports = Logger;