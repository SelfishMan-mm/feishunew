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

    // 2. 建立字段映射（字段名称 -> 目标字段ID）
    const fieldMapping = {};
    const targetFieldMap = new Map(targetFields.map(f => [f.field_name, f.field_id]));
    
    sourceFields.forEach(sf => {
      const targetFieldId = targetFieldMap.get(sf.field_name);
      if (targetFieldId) {
        // ✅ 参考项目的正确逻辑：源字段ID -> 目标字段ID
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
    console.log('\n🔍 源记录详细分析:');
    console.log('记录ID:', sourceRecord.record_id);
    console.log('完整fields结构:', JSON.stringify(sourceRecord.fields, null, 2));
    console.log('实际字段keys:', Object.keys(sourceRecord.fields));
    console.log('字段值详情:');
    Object.entries(sourceRecord.fields).forEach(([key, value]) => {
      console.log(`  ${key}: ${JSON.stringify(value)} (类型: ${typeof value})`);
    });

    // 4. 构建目标记录数据（根据目标字段类型转换）
    const targetData = {};
    let transferredCount = 0;
    
    console.log('\n🔄 开始字段映射和数据转换:');
    Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
      // 🔧 关键修复：通过字段名称获取数据，而不是字段ID
      const sourceField = sourceFields.find(f => f.field_id === sourceFieldId);
      const sourceFieldName = sourceField ? sourceField.field_name : null;
      
      console.log(`\n检查映射: ${sourceFieldId} (${sourceFieldName}) -> ${targetFieldId}`);
      console.log(`源记录字段keys:`, Object.keys(sourceRecord.fields));
      console.log(`查找字段名: ${sourceFieldName}`);
      console.log(`源记录中是否存在字段名:`, sourceRecord.fields.hasOwnProperty(sourceFieldName));
      
      if (sourceFieldName && sourceRecord.fields.hasOwnProperty(sourceFieldName)) {
        let rawValue = sourceRecord.fields[sourceFieldName]; // 🔧 使用字段名称获取值
        console.log(`获取到原始值: ${JSON.stringify(rawValue)}`);
        
        if (rawValue !== undefined && rawValue !== null) {
          // 🔧 根据目标字段类型进行数据转换
          const targetField = targetFields.find(f => f.field_id === targetFieldId);
          if (!targetField) {
            console.log(`⚠️ 未找到目标字段信息: ${targetFieldId}`);
            return;
          }
          
          let convertedValue;
          console.log(`目标字段类型: ${targetField.type} (${targetField.field_name})`);
          
          switch (targetField.type) {
            case 1: // 文本字段
              convertedValue = String(rawValue);
              console.log(`🔄 文本转换: ${rawValue} -> "${convertedValue}"`);
              break;
            case 2: // 数字字段  
              convertedValue = Number(rawValue);
              if (isNaN(convertedValue)) {
                console.log(`⚠️ 数字转换失败: ${rawValue} 不是有效数字，跳过`);
                return;
              }
              console.log(`🔄 数字转换: ${rawValue} -> ${convertedValue}`);
              break;
            case 3: // 单选字段
              convertedValue = String(rawValue);
              console.log(`🔄 单选转换: ${rawValue} -> "${convertedValue}"`);
              break;
            case 4: // 多选字段
              if (Array.isArray(rawValue)) {
                convertedValue = rawValue.map(v => String(v));
              } else {
                convertedValue = [String(rawValue)];
              }
              console.log(`🔄 多选转换: ${JSON.stringify(rawValue)} -> ${JSON.stringify(convertedValue)}`);
              break;
            case 5: // 日期字段
              convertedValue = rawValue; // 保持原格式
              console.log(`🔄 日期保持: ${rawValue}`);
              break;
            default: // 其他类型保持原样
              convertedValue = rawValue;
              console.log(`🔄 默认保持: ${rawValue} (类型: ${targetField.type})`);
          }
          
          targetData[targetFieldId] = convertedValue;
          transferredCount++;
          console.log(`✅ 成功映射字段 ${sourceFieldName} -> ${targetField.field_name}: ${JSON.stringify(convertedValue)} (类型: ${targetField.type})`);
        } else {
          console.log(`⚠️ 字段值为空: ${sourceFieldName}`);
        }
      } else {
        console.log(`⚠️ 字段 ${sourceFieldId} (${sourceFieldName}) 在源记录中不存在或为空`);
      }
    });
    
    console.log(`总共传输了 ${transferredCount} 个字段的数据`);
    console.log('目标记录数据:', JSON.stringify(targetData, null, 2));

    // 5. 创建记录（使用飞书官方标准格式）
    console.log('准备创建记录，数据:', JSON.stringify(targetData, null, 2));
    
    // 🔧 数据验证：只过滤 null 和 undefined，保留空字符串和其他值
    const validatedData = {};
    for (const [fieldId, value] of Object.entries(targetData)) {
      // ✅ 只过滤 null 和 undefined，保留空字符串 ''
      if (value !== null && value !== undefined) {
        validatedData[fieldId] = value;
        console.log(`✅ 保留字段值: ${fieldId} = ${JSON.stringify(value)}`);
      } else {
        console.log(`❌ 过滤字段值: ${fieldId} = ${JSON.stringify(value)} (null或undefined)`);
      }
    }
    
    console.log('验证后的数据:', JSON.stringify(validatedData, null, 2));
    
    const createResult = await client.base.appTableRecord.create({
      path: { table_id: targetTableId },
      data: { fields: validatedData }
    });

    console.log('创建API完整响应:', JSON.stringify(createResult, null, 2));

    // 安全获取目标记录ID
    const targetRecordId = createResult?.data?.record?.record_id || 
                          createResult?.data?.record_id || 
                          createResult?.record_id || 
                          '未知';

    res.json({
      success: true,
      message: '测试成功',
      sourceRecord: sourceRecord.record_id,
      targetRecord: targetRecordId,
      fieldMapping,
      dataTransferred: targetData,
      createResultStructure: typeof createResult?.data // 调试信息
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
