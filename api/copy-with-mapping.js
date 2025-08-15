const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, targetTableId, baseId, personalToken, fieldMapping } = req.body;
  
  if (!sourceTableId || !targetTableId) {
    return res.status(400).json({ error: '缺少表ID' });
  }

  if (!baseId || !personalToken) {
    return res.status(400).json({ error: '缺少BaseId或PersonalBaseToken' });
  }

  if (!fieldMapping || Object.keys(fieldMapping).length === 0) {
    return res.status(400).json({ error: '缺少字段映射配置' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('开始使用自定义映射复制数据...', { 
      sourceTableId, 
      targetTableId, 
      fieldMappingCount: Object.keys(fieldMapping).length 
    });

    // 获取源表格的所有记录
    let pageToken;
    const records = [];
    
    do {
      const recordsRes = await client.base.appTableRecord.list({
        path: { table_id: sourceTableId },
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

    console.log(`获取到 ${records.length} 条源记录`);

    // 使用自定义映射复制记录
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const record of records) {
      try {
        const transformedFields = {};
        
        // 根据自定义映射转换字段
        Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
          if (record.fields[sourceFieldId] !== undefined) {
            transformedFields[targetFieldId] = record.fields[sourceFieldId];
          }
        });

        // 只有当有字段需要复制时才创建记录
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

    console.log('映射复制完成:', { successCount, errorCount });

    res.json({
      success: true,
      copied: successCount,
      errors: errorCount,
      errorDetails: errors.slice(0, 10), // 只返回前10个错误详情
      fieldMappingUsed: fieldMapping
    });

  } catch (error) {
    console.error('映射复制失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '映射复制失败'
    });
  }
};