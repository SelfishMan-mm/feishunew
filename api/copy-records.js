const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, targetTableId, baseId, personalToken, records } = req.body;
  
  if (!sourceTableId || !targetTableId) {
    return res.status(400).json({ error: '缺少表ID' });
  }

  if (!baseId || !personalToken) {
    return res.status(400).json({ error: '缺少BaseId或PersonalBaseToken' });
  }

  if (!records || records.length === 0) {
    return res.status(400).json({ error: '缺少要复制的记录' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('开始复制选中记录:', { 
      sourceTableId, 
      targetTableId, 
      recordCount: records.length 
    });

    // 获取字段映射
    const [sourceFields, targetFields] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    if (!sourceFields?.data?.items || !targetFields?.data?.items) {
      throw new Error('获取字段信息失败');
    }

    // 建立字段映射
    const targetFieldMap = new Map(targetFields.data.items.map(f => [f.field_name, f.field_id]));
    const fieldMapping = {};
    
    sourceFields.data.items.forEach(sourceField => {
      const targetFieldId = targetFieldMap.get(sourceField.field_name);
      if (targetFieldId) {
        fieldMapping[sourceField.field_id] = targetFieldId;
      }
    });

    console.log(`建立了 ${Object.keys(fieldMapping).length} 个字段映射`);

    // 复制选中的记录
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const record of records) {
      try {
        const transformedFields = {};
        
        // 根据字段映射转换数据
        Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
          if (record.fields[sourceFieldId] !== undefined) {
            transformedFields[targetFieldId] = record.fields[sourceFieldId];
          }
        });

        if (Object.keys(transformedFields).length > 0) {
          await client.base.appTableRecord.create({
            path: { table_id: targetTableId },
            data: { fields: transformedFields }
          });
          successCount++;
        }
      } catch (error) {
        console.error('复制记录失败:', error);
        errorCount++;
        errors.push(`复制记录失败: ${error.message}`);
      }
    }

    console.log('选中记录复制完成:', { successCount, errorCount });

    res.json({
      success: true,
      copied: successCount,
      errors: errorCount,
      errorDetails: errors.slice(0, 10), // 只返回前10个错误详情
      total: records.length
    });

  } catch (error) {
    console.error('复制选中记录失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '复制选中记录失败'
    });
  }
};