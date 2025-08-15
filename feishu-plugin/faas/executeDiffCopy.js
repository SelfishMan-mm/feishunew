const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function(event, context) {
  const { baseId, personalToken, sourceTableId, targetTableId, diffResults } = event.body;
  
  if (!baseId || !personalToken) {
    return {
      success: false,
      error: '缺少BaseId或PersonalBaseToken'
    };
  }
  
  if (!diffResults) {
    return {
      success: false,
      error: '缺少差异分析结果'
    };
  }

  try {
    const client = new BaseClient({
      appToken: baseId,
      personalBaseToken: personalToken
    });

    console.log('开始执行差异复制:', {
      newRecords: diffResults.new.length,
      modifiedRecords: diffResults.modified.length
    });

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // 1. 处理新增记录
    for (const newRecord of diffResults.new) {
      try {
        // 转换字段数据
        const transformedFields = {};
        
        // 从source_record中提取字段数据并转换
        if (newRecord.source_record && newRecord.source_record.fields) {
          // 这里需要重新建立字段映射
          const sourceFields = await client.base.appTableField.list({ 
            path: { table_id: sourceTableId } 
          });
          const targetFields = await client.base.appTableField.list({ 
            path: { table_id: targetTableId } 
          });
          
          const targetFieldMap = new Map(targetFields.data.items.map(f => [f.field_name, f.field_id]));
          
          sourceFields.data.items.forEach(sourceField => {
            const targetFieldId = targetFieldMap.get(sourceField.field_name);
            if (targetFieldId && newRecord.source_record.fields[sourceField.field_id] !== undefined) {
              transformedFields[targetFieldId] = newRecord.source_record.fields[sourceField.field_id];
            }
          });
        }

        // 创建新记录
        await client.base.appTableRecord.create({
          path: { table_id: targetTableId },
          data: { fields: transformedFields }
        });

        successCount++;
      } catch (error) {
        console.error('创建新记录失败:', error);
        errorCount++;
        errors.push(`新增记录失败: ${error.message}`);
      }
    }

    // 2. 处理修改记录
    for (const modifiedRecord of diffResults.modified) {
      try {
        // 转换字段数据
        const transformedFields = {};
        
        if (modifiedRecord.source_record && modifiedRecord.source_record.fields) {
          const sourceFields = await client.base.appTableField.list({ 
            path: { table_id: sourceTableId } 
          });
          const targetFields = await client.base.appTableField.list({ 
            path: { table_id: targetTableId } 
          });
          
          const targetFieldMap = new Map(targetFields.data.items.map(f => [f.field_name, f.field_id]));
          
          sourceFields.data.items.forEach(sourceField => {
            const targetFieldId = targetFieldMap.get(sourceField.field_name);
            if (targetFieldId && modifiedRecord.source_record.fields[sourceField.field_id] !== undefined) {
              transformedFields[targetFieldId] = modifiedRecord.source_record.fields[sourceField.field_id];
            }
          });
        }

        // 更新记录
        await client.base.appTableRecord.update({
          path: { table_id: targetTableId, record_id: modifiedRecord.target_record_id },
          data: { fields: transformedFields }
        });

        successCount++;
      } catch (error) {
        console.error('更新记录失败:', error);
        errorCount++;
        errors.push(`更新记录失败: ${error.message}`);
      }
    }

    console.log('差异复制完成:', { successCount, errorCount });

    return {
      success: true,
      successCount,
      errorCount,
      errors: errors.slice(0, 10), // 只返回前10个错误
      processed: diffResults.new.length + diffResults.modified.length
    };

  } catch (error) {
    console.error('执行差异复制失败:', error);
    return {
      success: false,
      error: error.message || '执行差异复制失败'
    };
  }
};