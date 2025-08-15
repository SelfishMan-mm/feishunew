// 输入验证工具
class Validator {
  static validateTableInput(input) {
    if (!input || typeof input !== 'string') {
      return { valid: false, error: '表格输入不能为空' };
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: '表格输入不能为空' };
    }

    // 检查是否是有效的表格ID格式
    if (trimmed.startsWith('tbl') && trimmed.length > 10) {
      return { valid: true, type: 'id', value: trimmed };
    }

    // 否则认为是表格名称
    return { valid: true, type: 'name', value: trimmed };
  }

  static validateFieldMapping(mapping) {
    if (!mapping || typeof mapping !== 'object') {
      return { valid: false, error: '字段映射格式错误' };
    }

    const entries = Object.entries(mapping);
    if (entries.length === 0) {
      return { valid: false, error: '至少需要映射一个字段' };
    }

    for (const [sourceField, targetField] of entries) {
      if (!sourceField || !targetField) {
        return { valid: false, error: '字段映射不能包含空值' };
      }
    }

    return { valid: true };
  }

  static validateRecordIds(recordIds) {
    if (!Array.isArray(recordIds)) {
      return { valid: false, error: '记录ID必须是数组格式' };
    }

    for (const id of recordIds) {
      if (!id || typeof id !== 'string' || !id.startsWith('rec')) {
        return { valid: false, error: `无效的记录ID格式: ${id}` };
      }
    }

    return { valid: true };
  }

  static validateCopyConfig(config) {
    const {
      sourceTable,
      targetTable,
      mappingStrategy,
      fieldMapping,
      copyMode,
      recordIds
    } = config;

    // 验证表格输入
    const sourceValidation = this.validateTableInput(sourceTable);
    if (!sourceValidation.valid) {
      return { valid: false, error: `源表格${sourceValidation.error}` };
    }

    const targetValidation = this.validateTableInput(targetTable);
    if (!targetValidation.valid) {
      return { valid: false, error: `目标表格${targetValidation.error}` };
    }

    // 验证映射策略
    if (!['auto', 'manual'].includes(mappingStrategy)) {
      return { valid: false, error: '无效的映射策略' };
    }

    // 如果是手动映射，验证字段映射
    if (mappingStrategy === 'manual') {
      const mappingValidation = this.validateFieldMapping(fieldMapping);
      if (!mappingValidation.valid) {
        return mappingValidation;
      }
    }

    // 验证复制模式
    if (!['all', 'range'].includes(copyMode)) {
      return { valid: false, error: '无效的复制模式' };
    }

    // 如果是范围复制，验证记录ID
    if (copyMode === 'range') {
      const idsValidation = this.validateRecordIds(recordIds || []);
      if (!idsValidation.valid) {
        return idsValidation;
      }

      if (recordIds.length === 0) {
        return { valid: false, error: '范围复制模式下必须指定记录ID' };
      }
    }

    return { valid: true };
  }
}

module.exports = Validator;