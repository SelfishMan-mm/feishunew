const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, targetTableId, baseId, personalToken, diffResults } = req.body;
  
  if (!sourceTableId || !targetTableId) {
    return res.status(400).json({ error: '缺少表ID' });
  }

  if (!baseId || !personalToken) {
    return res.status(400).json({ error: '缺少BaseId或PersonalBaseToken' });
  }

  if (!diffResults) {
    return res.status(400).json({ error: '缺少差异分析结果' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('开始执行差异复制:', {
      newRecords: diffResults.new.length,
      modifiedRecords: diffResults.modified.length
    });

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // 获取字段映射信息
    const [sourceFields, targetFields] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    const targetFieldMap = new Map(targetFields.data.items.map(f => [f.field_name, f.field_id]));
    const fieldMapping = {};
    
    sourceFields.data.items.forEach(sourceField => {
      const targetFieldId = targetFieldMap.get(sourceField.field_name);
      if (targetFieldId) {
        fieldMapping[sourceField.field_id] = targetFieldId;
      }
    });

    // 1. 处理新增记录
    for (const newRecord of diffResults.new) {
      try {
        const transformedFields = {};
        
        if (newRecord.source_record && newRecord.source_record.fields) {
          Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
            if (newRecord.source_record.fields[sourceFieldId] !== undefined) {
              transformedFields[targetFieldId] = newRecord.source_record.fields[sourceFieldId];
            }
          });
        }

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
        const transformedFields = {};
        
        if (modifiedRecord.source_record && modifiedRecord.source_record.fields) {
          Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
            if (modifiedRecord.source_record.fields[sourceFieldId] !== undefined) {
              transformedFields[targetFieldId] = modifiedRecord.source_record.fields[sourceFieldId];
            }
          });
        }

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

    res.json({
      success: true,
      successCount,
      errorCount,
      errors: errors.slice(0, 10), // 只返回前10个错误
      processed: diffResults.new.length + diffResults.modified.length
    });

  } catch (error) {
    console.error('执行差异复制失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '执行差异复制失败'
    });
  }
};