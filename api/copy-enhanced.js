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
    enableDiff,
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

  let processed = 0;
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

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

    // 获取字段信息
    const [sourceFieldsRes, targetFieldsRes] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    const sourceFields = sourceFieldsRes.data.items;
    const targetFields = targetFieldsRes.data.items;

    // 建立字段映射
    let finalFieldMapping = {};
    if (mappingStrategy === 'auto') {
      const targetFieldMap = new Map(targetFields.map(f => [f.field_name, f.field_id]));
      sourceFields.forEach(sf => {
        const targetFieldId = targetFieldMap.get(sf.field_name);
        if (targetFieldId) {
          finalFieldMapping[sf.field_id] = targetFieldId;
        }
      });
    } else {
      finalFieldMapping = fieldMapping;
    }

    // 获取源表数据
    let sourceRecords = [];
    if (copyMode === 'range' && recordIds.length > 0) {
      for (const recordId of recordIds) {
        try {
          const record = await client.base.appTableRecord.get({
            path: { table_id: sourceTableId, record_id: recordId }
          });
          sourceRecords.push(record.data.record);
        } catch (error) {
          console.warn(`获取记录 ${recordId} 失败:`, error.message);
          errors.push(`获取记录 ${recordId} 失败: ${error.message}`);
        }
      }
    } else {
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

    let diffResults = null;

    // 如果启用差异对比，先执行对比
    if (enableDiff) {
      // 获取目标表数据进行对比
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
        const idField = sourceFields.find(f => 
          f.field_name.toLowerCase().includes('id') || 
          f.field_name.toLowerCase().includes('编号')
        );
        primaryKeyField = idField ? idField.field_id : sourceFields[0]?.field_id;
      }

      // 执行差异分析
      diffResults = performDiff(
        sourceRecords, 
        targetRecords, 
        finalFieldMapping, 
        primaryKeyField,
        sourceFields,
        targetFields
      );

      // 根据差异结果决定要处理的记录
      const recordsToProcess = [
        ...diffResults.new,
        ...diffResults.modified
      ];

      // 处理新增记录
      for (const record of diffResults.new) {
        processed++;
        try {
          const transformedFields = {};
          Object.entries(finalFieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
            if (record.source_record.fields[sourceFieldId] !== undefined) {
              transformedFields[targetFieldId] = record.source_record.fields[sourceFieldId];
            }
          });

          await client.base.appTableRecord.create({
            path: { table_id: targetTableId },
            data: { fields: transformedFields }
          });
          
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push(`创建记录失败: ${error.message}`);
        }
      }

      // 处理修改记录
      for (const record of diffResults.modified) {
        processed++;
        try {
          const transformedFields = {};
          Object.entries(finalFieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
            if (record.source_record.fields[sourceFieldId] !== undefined) {
              transformedFields[targetFieldId] = record.source_record.fields[sourceFieldId];
            }
          });

          await client.base.appTableRecord.update({
            path: { table_id: targetTableId, record_id: record.target_record_id },
            data: { fields: transformedFields }
          });
          
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push(`更新记录 ${record.target_record_id} 失败: ${error.message}`);
        }
      }

    } else {
      // 不启用差异对比，直接复制所有记录
      for (const record of sourceRecords) {
        processed++;
        try {
          const transformedFields = {};
          Object.entries(finalFieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
            if (record.fields[sourceFieldId] !== undefined) {
              transformedFields[targetFieldId] = record.fields[sourceFieldId];
            }
          });

          await client.base.appTableRecord.create({
            path: { table_id: targetTableId },
            data: { fields: transformedFields }
          });
          
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push(`创建记录失败: ${error.message}`);
        }
      }
    }

    res.json({
      success: true,
      processed,
      success_count: successCount,
      error_count: errorCount,
      errors: errors.slice(0, 10), // 只返回前10个错误
      results: diffResults,
      field_mapping: finalFieldMapping
    });

  } catch (error) {
    console.error('复制操作失败:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      processed,
      success_count: successCount,
      error_count: errorCount
    });
  }
};

// 复用差异分析函数
function performDiff(sourceRecords, targetRecords, fieldMapping, primaryKeyField, sourceFields, targetFields) {
  const results = {
    new: [],
    deleted: [],
    modified: [],
    same: []
  };

  const targetMap = new Map();
  const reversedFieldMapping = {};
  
  Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
    reversedFieldMapping[targetFieldId] = sourceFieldId;
  });

  const targetPrimaryKeyField = fieldMapping[primaryKeyField];

  targetRecords.forEach(record => {
    if (targetPrimaryKeyField && record.fields[targetPrimaryKeyField]) {
      targetMap.set(record.fields[targetPrimaryKeyField], record);
    }
  });

  sourceRecords.forEach(sourceRecord => {
    const primaryKeyValue = sourceRecord.fields[primaryKeyField];
    if (!primaryKeyValue) return;

    const targetRecord = targetMap.get(primaryKeyValue);
    
    if (!targetRecord) {
      results.new.push({
        record_id: sourceRecord.record_id,
        fields: transformFields(sourceRecord.fields, fieldMapping, sourceFields, targetFields),
        source_record: sourceRecord
      });
    } else {
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
          target_record: targetRecord
        });
      } else {
        results.same.push({
          record_id: sourceRecord.record_id,
          target_record_id: targetRecord.record_id,
          fields: transformFields(sourceRecord.fields, fieldMapping, sourceFields, targetFields)
        });
      }
      
      targetMap.delete(primaryKeyValue);
    }
  });

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
    
    if (JSON.stringify(sourceValue) !== JSON.stringify(targetValue)) {
      return true;
    }
  }
  return false;
}