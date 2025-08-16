const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, targetTableId, baseId, personalToken } = req.body;
  
  if (!baseId || !personalToken || !sourceTableId || !targetTableId) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('=== 开始测试单条记录复制 ===');
    
    // 1. 获取字段信息
    const [sourceFieldsRes, targetFieldsRes] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    const sourceFields = sourceFieldsRes.data.items;
    const targetFields = targetFieldsRes.data.items;
    
    console.log('源表字段:', sourceFields.map(f => `${f.field_name}(${f.field_id})`));
    console.log('目标表字段:', targetFields.map(f => `${f.field_name}(${f.field_id})`));

    // 2. 建立字段映射
    const fieldMapping = {};
    const targetFieldMap = new Map(targetFields.map(f => [f.field_name, f.field_id]));
    
    sourceFields.forEach(sf => {
      const targetFieldId = targetFieldMap.get(sf.field_name);
      if (targetFieldId) {
        fieldMapping[sf.field_id] = targetFieldId;
      }
    });
    
    console.log('字段映射:', fieldMapping);

    // 3. 获取第一条记录
    const recordsRes = await client.base.appTableRecord.list({
      path: { table_id: sourceTableId },
      params: { page_size: 1 }
    });

    if (!recordsRes.data.items || recordsRes.data.items.length === 0) {
      return res.json({ success: false, error: '源表没有数据' });
    }

    const sourceRecord = recordsRes.data.items[0];
    console.log('源记录完整数据:', JSON.stringify(sourceRecord, null, 2));
    console.log('源记录字段keys:', Object.keys(sourceRecord.fields));
    console.log('预期的源字段IDs:', sourceFields.map(f => f.field_id));

    // 4. 构建目标记录数据
    const targetData = {};
    let transferredCount = 0;
    
    Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
      console.log(`检查字段映射: ${sourceFieldId} -> ${targetFieldId}`);
      console.log(`源记录中是否存在 ${sourceFieldId}:`, sourceRecord.fields.hasOwnProperty(sourceFieldId));
      console.log(`源记录中的值:`, sourceRecord.fields[sourceFieldId]);
      
      if (sourceRecord.fields.hasOwnProperty(sourceFieldId) && 
          sourceRecord.fields[sourceFieldId] !== undefined && 
          sourceRecord.fields[sourceFieldId] !== null) {
        targetData[targetFieldId] = sourceRecord.fields[sourceFieldId];
        transferredCount++;
        console.log(`✅ 成功映射字段 ${sourceFieldId} -> ${targetFieldId}: ${sourceRecord.fields[sourceFieldId]}`);
      } else {
        console.log(`⚠️ 字段 ${sourceFieldId} 在源记录中不存在或为空`);
      }
    });
    
    console.log(`总共传输了 ${transferredCount} 个字段的数据`);
    console.log('目标记录数据:', JSON.stringify(targetData, null, 2));

    // 5. 创建记录
    const createResult = await client.base.appTableRecord.create({
      path: { table_id: targetTableId },
      data: { fields: targetData }
    });

    console.log('创建结果:', JSON.stringify(createResult, null, 2));

    res.json({
      success: true,
      message: '测试成功',
      sourceRecord: sourceRecord.record_id,
      targetRecord: createResult.data.record.record_id,
      fieldMapping,
      dataTransferred: targetData
    });

  } catch (error) {
    console.error('测试失败:', error);
    console.error('错误响应:', error.response?.data);
    
    let errorMessage = error.message;
    if (error.response?.data) {
      const apiError = error.response.data;
      if (apiError.sc === 30) {
        errorMessage = '字段操作失败，可能原因：字段类型不匹配、字段不存在或权限不足';
      }
      console.error('完整API错误:', JSON.stringify(apiError, null, 2));
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      apiError: error.response?.data,
      stack: error.stack
    });
  }
};
