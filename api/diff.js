const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { 
    sourceTable, 
    targetTable, 
    mappingStrategy, 
    fieldMapping, 
    copyMode, 
    recordIds, 
    primaryKey,
    baseId,
    personalToken
  } = req.body;

  if (!baseId || !personalToken) {
    return res.status(400).json({ success: false, error: '缺少BaseId或PersonalBaseToken' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    // 获取表ID
    let sourceTableId = sourceTable;
    let targetTableId = targetTable;

    if (!sourceTable.startsWith('tbl')) {
      const tables = await client.base.appTable.list();
      const sourceTableInfo = tables.data.items.find(t => t.name === sourceTable);
      if (!sourceTableInfo) {
        return res.status(400).json({ success: false, error: `找不到源表格: ${sourceTable}` });
      }
      sourceTableId = sourceTableInfo.table_id;
    }

    if (!targetTable.startsWith('tbl')) {
      const tables = await client.base.appTable.list();
      const targetTableInfo = tables.data.items.find(t => t.name === targetTable);
      if (!targetTableInfo) {
        return res.status(400).json({ success: false, error: `找不到目标表格: ${targetTable}` });
      }
      targetTableId = targetTableInfo.table_id;
    }

    // 获取字段映射
    const [sourceFieldsRes, targetFieldsRes] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    const sourceFields = sourceFieldsRes.data.items;
    const targetFields = targetFieldsRes.data.items;

    // 建立字段映射
    let finalFieldMapping = {};
    if (mappingStrategy === 'auto') {
      // 自动映射：字段名相同
      const targetFieldMap = new Map(targetFields.map(f => [f.field_name, f.field_id]));
      sourceFields.forEach(sf => {
        const targetFieldId = targetFieldMap.get(sf.field_name);
        if (targetFieldId) {
          finalFieldMapping[sf.field_id] = targetFieldId;
        }
      });
    } else {
      // 手动映射
      finalFieldMapping = fieldMapping;
    }

    // 获取源表数据
    let sourceRecords = [];
    if (copyMode === 'range' && recordIds.length > 0) {
      // 指定记录ID
      for (const recordId of recordIds) {
        try {
          const record = await client.base.appTableRecord.get({
            path: { table_id: sourceTableId, record_id: recordId }
          });
          sourceRecords.push(record.data.record);
        } catch (error) {
          console.warn(`获取记录 ${recordId} 失败:`, error.message);
        }
      }
    } else {
      // 获取所有记录
      let pageToken;
      do {
        const response = await client.base.appTableRecord.list({
          path: { table_id: sourceTableId },
          params: { page_size: 100, page_token: pageToken }
        });
        sourceRecords.push(...response.data.items);
        pageToken = response.data.page_token;
      } while (pageToken);
    }

    // 获取目标表数据
    let targetRecords = [];
    let pageToken;
    do {
      const response = await client.base.appTableRecord.list({
        path: { table_id: targetTableId },
        params: { page_size: 100, page_token: pageToken }
      });
      targetRecords.push(...response.data.items);
      pageToken = response.data.page_token;
    } while (pageToken);

    // 确定主键字段
    let primaryKeyField = primaryKey;
    if (!primaryKeyField) {
      // 自动检测主键：优先选择第一个字段或名称包含ID的字段
      const idField = sourceFields.find(f => 
        f.field_name.toLowerCase().includes('id') || 
        f.field_name.toLowerCase().includes('编号')
      );
      primaryKeyField = idField ? idField.field_id : sourceFields[0]?.field_id;
    }

    // 执行差异对比
    const results = performDiff(
      sourceRecords, 
      targetRecords, 
      finalFieldMapping, 
      primaryKeyField,
      sourceFields,
      targetFields
    );

    res.json({
      success: true,
      results,
      fieldMapping: finalFieldMapping,
      primaryKeyField,
      sourceTableId,
      targetTableId
    });

  } catch (error) {
    console.error('差异分析失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

function performDiff(sourceRecords, targetRecords, fieldMapping, primaryKeyField, sourceFields, targetFields) {
  const results = {
    new: [],      // 源有目标无
    deleted: [],  // 源无目标有
    modified: [], // 主键相同但内容不同
    same: []      // 完全相同
  };

  // 创建目标记录的主键映射
  const targetMap = new Map();
  const reversedFieldMapping = {};
  
  // 建立反向字段映射（目标字段ID -> 源字段ID）
  Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
    reversedFieldMapping[targetFieldId] = sourceFieldId;
  });

  // 找到目标表中对应的主键字段
  const targetPrimaryKeyField = fieldMapping[primaryKeyField];

  targetRecords.forEach(record => {
    if (targetPrimaryKeyField && record.fields[targetPrimaryKeyField]) {
      targetMap.set(record.fields[targetPrimaryKeyField], record);
    }
  });

  // 分析源记录
  sourceRecords.forEach(sourceRecord => {
    const primaryKeyValue = sourceRecord.fields[primaryKeyField];
    if (!primaryKeyValue) return;

    const targetRecord = targetMap.get(primaryKeyValue);
    
    if (!targetRecord) {
      // 新增：源有目标无
      results.new.push({
        record_id: sourceRecord.record_id,
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
          fields: transformFields(sourceRecord.fields, fieldMapping, sourceFields, targetFields),
          source_record: sourceRecord,
          target_record: targetRecord,
          differences: getFieldDifferences(sourceRecord.fields, targetRecord.fields, fieldMapping)
        });
      } else {
        results.same.push({
          record_id: sourceRecord.record_id,
          target_record_id: targetRecord.record_id,
          fields: transformFields(sourceRecord.fields, fieldMapping, sourceFields, targetFields)
        });
      }
      
      // 从目标映射中移除已处理的记录
      targetMap.delete(primaryKeyValue);
    }
  });

  // 剩余的目标记录为删除项
  targetMap.forEach(targetRecord => {
    results.deleted.push({
      record_id: targetRecord.record_id,
      fields: targetRecord.fields,
      target_record: targetRecord
    });
  });

  return results;
}

function transformFields(sourceFields, fieldMapping, sourceFieldsInfo, targetFieldsInfo) {
  const transformed = {};
  
  Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
    if (sourceFields[sourceFieldId] !== undefined) {
      // 获取字段信息用于显示
      const sourceFieldInfo = sourceFieldsInfo.find(f => f.field_id === sourceFieldId);
      const targetFieldInfo = targetFieldsInfo.find(f => f.field_id === targetFieldId);
      
      const fieldName = targetFieldInfo ? targetFieldInfo.field_name : sourceFieldInfo?.field_name || targetFieldId;
      transformed[fieldName] = sourceFields[sourceFieldId];
    }
  });
  
  return transformed;
}

function compareRecords(sourceFields, targetFields, fieldMapping) {
  for (const [sourceFieldId, targetFieldId] of Object.entries(fieldMapping)) {
    const sourceValue = sourceFields[sourceFieldId];
    const targetValue = targetFields[targetFieldId];
    
    // 简单的值比较（可以根据字段类型进行更复杂的比较）
    if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
      return true;
    }
  }
  return false;
}

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