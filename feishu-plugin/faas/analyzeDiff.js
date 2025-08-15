const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function(event, context) {
  const { baseId, personalToken, sourceTableId, targetTableId, primaryKeyField } = event.body;
  
  if (!baseId || !personalToken) {
    return {
      success: false,
      error: '缺少BaseId或PersonalBaseToken'
    };
  }
  
  if (!sourceTableId || !targetTableId) {
    return {
      success: false,
      error: '缺少源表格ID或目标表格ID'
    };
  }

  try {
    const client = new BaseClient({
      appToken: baseId,
      personalBaseToken: personalToken
    });

    console.log('开始差异分析:', { sourceTableId, targetTableId, primaryKeyField });

    // 1. 获取字段信息
    const [sourceFieldsRes, targetFieldsRes] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    if (!sourceFieldsRes?.data?.items || !targetFieldsRes?.data?.items) {
      throw new Error('获取字段信息失败，请检查表格ID是否正确');
    }

    const sourceFields = sourceFieldsRes.data.items;
    const targetFields = targetFieldsRes.data.items;

    // 2. 建立字段映射
    const targetFieldMap = new Map(targetFields.map(f => [f.field_name, f.field_id]));
    const fieldMapping = {};
    
    sourceFields.forEach(sourceField => {
      const targetFieldId = targetFieldMap.get(sourceField.field_name);
      if (targetFieldId) {
        fieldMapping[sourceField.field_id] = targetFieldId;
      }
    });

    // 3. 确定主键字段
    let primaryKey = primaryKeyField;
    if (!primaryKey) {
      // 自动检测主键：优先选择包含ID的字段，否则选择第一个字段
      const idField = sourceFields.find(f => 
        f.field_name.toLowerCase().includes('id') || 
        f.field_name.toLowerCase().includes('编号') ||
        f.field_name.toLowerCase().includes('序号')
      );
      primaryKey = idField ? idField.field_id : sourceFields[0]?.field_id;
    }

    if (!primaryKey) {
      throw new Error('无法确定主键字段');
    }

    console.log('主键字段:', primaryKey);

    // 4. 获取源表格和目标表格的所有记录
    const [sourceRecords, targetRecords] = await Promise.all([
      getAllRecords(client, sourceTableId),
      getAllRecords(client, targetTableId)
    ]);

    console.log('记录数量:', { 
      sourceRecords: sourceRecords.length, 
      targetRecords: targetRecords.length 
    });

    // 5. 执行差异分析
    const diffResults = performDiffAnalysis(
      sourceRecords, 
      targetRecords, 
      fieldMapping, 
      primaryKey,
      sourceFields,
      targetFields
    );

    console.log('差异分析完成:', {
      new: diffResults.new.length,
      deleted: diffResults.deleted.length,
      modified: diffResults.modified.length,
      same: diffResults.same.length
    });

    return {
      success: true,
      results: diffResults,
      fieldMapping,
      primaryKeyField: primaryKey
    };

  } catch (error) {
    console.error('差异分析失败:', error);
    return {
      success: false,
      error: error.message || '差异分析失败'
    };
  }
};

// 获取表格所有记录
async function getAllRecords(client, tableId) {
  let pageToken;
  const records = [];
  
  do {
    const recordsRes = await client.base.appTableRecord.list({
      path: { table_id: tableId },
      params: { 
        page_size: 100, 
        page_token: pageToken 
      }
    });
    
    if (recordsRes?.data?.items) {
      records.push(...recordsRes.data.items);
    }
    
    pageToken = recordsRes?.data?.page_token;
  } while (pageToken);

  return records;
}

// 执行差异分析
function performDiffAnalysis(sourceRecords, targetRecords, fieldMapping, primaryKey, sourceFields, targetFields) {
  const results = {
    new: [],      // 源有目标无
    deleted: [],  // 源无目标有
    modified: [], // 主键相同但内容不同
    same: []      // 完全相同
  };

  // 创建目标记录的主键映射
  const targetPrimaryKeyField = fieldMapping[primaryKey];
  const targetMap = new Map();

  if (targetPrimaryKeyField) {
    targetRecords.forEach(record => {
      const primaryKeyValue = record.fields[targetPrimaryKeyField];
      if (primaryKeyValue !== undefined && primaryKeyValue !== null) {
        targetMap.set(String(primaryKeyValue), record);
      }
    });
  }

  // 分析源记录
  sourceRecords.forEach(sourceRecord => {
    const primaryKeyValue = sourceRecord.fields[primaryKey];
    if (primaryKeyValue === undefined || primaryKeyValue === null) {
      return; // 跳过没有主键值的记录
    }

    const targetRecord = targetMap.get(String(primaryKeyValue));
    
    if (!targetRecord) {
      // 新增：源有目标无
      results.new.push({
        record_id: sourceRecord.record_id,
        primary_key: primaryKeyValue,
        fields: transformFields(sourceRecord.fields, fieldMapping, sourceFields, targetFields),
        source_record: sourceRecord
      });
    } else {
      // 比较记录内容
      const isModified = compareRecords(
        sourceRecord.fields, 
        targetRecord.fields, 
        fieldMapping
      );
      
      if (isModified) {
        results.modified.push({
          record_id: sourceRecord.record_id,
          target_record_id: targetRecord.record_id,
          primary_key: primaryKeyValue,
          fields: transformFields(sourceRecord.fields, fieldMapping, sourceFields, targetFields),
          source_record: sourceRecord,
          target_record: targetRecord,
          differences: getFieldDifferences(sourceRecord.fields, targetRecord.fields, fieldMapping)
        });
      } else {
        results.same.push({
          record_id: sourceRecord.record_id,
          target_record_id: targetRecord.record_id,
          primary_key: primaryKeyValue,
          fields: transformFields(sourceRecord.fields, fieldMapping, sourceFields, targetFields)
        });
      }
      
      // 从目标映射中移除已处理的记录
      targetMap.delete(String(primaryKeyValue));
    }
  });

  // 剩余的目标记录为删除项
  targetMap.forEach(targetRecord => {
    const primaryKeyValue = targetRecord.fields[targetPrimaryKeyField];
    results.deleted.push({
      record_id: targetRecord.record_id,
      primary_key: primaryKeyValue,
      fields: targetRecord.fields,
      target_record: targetRecord
    });
  });

  return results;
}

// 转换字段数据
function transformFields(sourceFields, fieldMapping, sourceFieldsInfo, targetFieldsInfo) {
  const transformed = {};
  
  Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
    if (sourceFields[sourceFieldId] !== undefined) {
      const targetFieldInfo = targetFieldsInfo.find(f => f.field_id === targetFieldId);
      const fieldName = targetFieldInfo ? targetFieldInfo.field_name : targetFieldId;
      transformed[fieldName] = sourceFields[sourceFieldId];
    }
  });
  
  return transformed;
}

// 比较记录内容
function compareRecords(sourceFields, targetFields, fieldMapping) {
  for (const [sourceFieldId, targetFieldId] of Object.entries(fieldMapping)) {
    const sourceValue = sourceFields[sourceFieldId];
    const targetValue = targetFields[targetFieldId];
    
    // 简单的值比较
    if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
      return true;
    }
  }
  return false;
}

// 获取字段差异详情
function getFieldDifferences(sourceFields, targetFields, fieldMapping) {
  const differences = [];
  
  Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
    const sourceValue = sourceFields[sourceFieldId];
    const targetValue = targetFields[targetFieldId];
    
    if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
      differences.push({
        field_id: sourceFieldId,
        target_field_id: targetFieldId,
        source_value: sourceValue,
        target_value: targetValue
      });
    }
  });
  
  return differences;
}