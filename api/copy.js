const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, targetTableId, baseId, personalToken, customFieldMapping } = req.body;
  
  if (!sourceTableId || !targetTableId) {
    return res.status(400).json({ error: '缺少表ID' });
  }

  if (!baseId || !personalToken) {
    return res.status(400).json({ error: '缺少BaseId或PersonalBaseToken' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('开始获取字段信息...', { sourceTableId, targetTableId, baseId });
    
    let fieldMap = {};
    let tFields = []; // 🔧 确保目标字段信息总是可用
    let sFields = []; // 🔧 确保源字段信息总是可用

    // 🔧 无论使用哪种映射方式，都需要获取源字段和目标字段信息
    const [sf, tf] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);
    
    if (!sf?.data?.items) {
      console.error('源表格字段API完整响应:', JSON.stringify(sf, null, 2));
      throw new Error(`源表格字段获取失败，响应结构异常: ${JSON.stringify(sf)}`);
    }
    if (!tf?.data?.items) {
      console.error('目标表格字段API完整响应:', JSON.stringify(tf, null, 2));
      throw new Error(`目标表格字段获取失败，响应结构异常: ${JSON.stringify(tf)}`);
    }
    
    sFields = sf.data.items;
    tFields = tf.data.items;
    
    console.log('源表字段详情:', sFields.map(f => ({ id: f.field_id, name: f.field_name, type: f.type })));
    console.log('目标表字段详情:', tFields.map(f => ({ id: f.field_id, name: f.field_name, type: f.type })));

    // ✅ 优先使用自定义字段映射
    if (customFieldMapping && Object.keys(customFieldMapping).length > 0) {
      fieldMap = customFieldMapping;
      console.log('✅ 整表复制使用自定义字段映射:', Object.keys(fieldMap).length, '个字段');
    } else {
      // 自动字段映射逻辑
      console.log('字段API响应:', { sf: sf?.data, tf: tf?.data });
      console.log('字段信息:', { sourceFields: sFields.length, targetFields: tFields.length });

      const map = new Map(tFields.map(f => [f.field_name, f.field_id]));
      sFields.forEach(f => { 
        const id = map.get(f.field_name); 
        if (id) {
          // ✅ 参考项目的正确逻辑：源字段ID -> 目标字段ID
          fieldMap[f.field_id] = id;
          console.log(`字段映射: ${f.field_name} (${f.field_id}) -> (${id})`);
        } else {
          console.warn(`未找到匹配的目标字段: ${f.field_name}`);
        }
      });
      console.log('✅ 整表复制使用自动字段映射:', Object.keys(fieldMap).length, '个字段');
      console.log('完整字段映射:', fieldMap);
    }

    let pageToken;
    const records = [];
    do {
      console.log(`获取记录分页，pageToken: ${pageToken || 'null'}`);
      const r = await client.base.appTableRecord.list({
        path: { table_id: sourceTableId },
        params: { page_size: 100, page_token: pageToken }
      });
      
      console.log(`获取到 ${r.data.items.length} 条记录`);
      records.push(...r.data.items);
      pageToken = r.data.page_token;
    } while (pageToken);
    
    console.log(`总共获取 ${records.length} 条记录`);

    // 2. 写入目标表
    console.log(`开始写入 ${records.length} 条记录到目标表...`);
    
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      try {
        const payload = {};
        let mappedFieldCount = 0;
        
        // 打印调试信息
        console.log(`\n处理第 ${i + 1} 条记录 (${rec.record_id}):`);
        console.log('记录中的字段keys:', Object.keys(rec.fields));
        console.log('字段映射表:', fieldMap);
        
        // 构建要写入的数据，根据目标字段类型进行转换
        for (const [sourceFieldId, targetFieldId] of Object.entries(fieldMap)) {
          // 🔧 关键修复：通过字段名称获取数据，而不是字段ID
          const sourceField = sFields?.find(f => f.field_id === sourceFieldId);
          const sourceFieldName = sourceField ? sourceField.field_name : null;
          
          console.log(`检查映射: ${sourceFieldId} (${sourceFieldName}) -> ${targetFieldId}`);
          console.log(`源记录字段keys:`, Object.keys(rec.fields));
          console.log(`查找字段名: ${sourceFieldName}`);
          console.log(`源记录中是否存在字段名: ${rec.fields.hasOwnProperty(sourceFieldName)}`);
          
          if (sourceFieldName && rec.fields.hasOwnProperty(sourceFieldName)) {
            let rawValue = rec.fields[sourceFieldName]; // 🔧 使用字段名称获取值
            console.log(`原始值: ${JSON.stringify(rawValue)}`);
            
            if (rawValue !== undefined && rawValue !== null) {
              // 🔧 根据目标字段类型进行数据转换
              const targetField = tFields.find(f => f.field_id === targetFieldId);
              if (!targetField) {
                console.log(`⚠️ 未找到目标字段信息: ${targetFieldId}`);
                continue;
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
                    continue;
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
              
              payload[targetFieldId] = convertedValue;
              mappedFieldCount++;
              console.log(`✅ 成功映射: ${sourceFieldName} -> ${targetField.field_name} = ${JSON.stringify(convertedValue)} (类型: ${targetField.type})`);
            } else {
              console.log(`⚠️ 字段值为空: ${sourceFieldName}`);
            }
          } else {
            console.log(`⚠️ 跳过字段: ${sourceFieldId} (字段名: ${sourceFieldName}，未找到或为空)`);
          }
        }
        
        console.log(`第 ${i + 1} 条记录映射了 ${mappedFieldCount} 个字段`);
        console.log('最终payload:', JSON.stringify(payload, null, 2));
        
        if (Object.keys(payload).length === 0) {
          console.warn(`第 ${i + 1} 条记录没有可映射的字段，跳过`);
          continue;
        }
        
        console.log(`正在写入第 ${i + 1}/${records.length} 条记录...`);
        
        // 🔧 数据验证：只过滤 null 和 undefined，保留空字符串和其他值
        const validatedPayload = {};
        for (const [fieldId, value] of Object.entries(payload)) {
          // ✅ 只过滤 null 和 undefined，保留空字符串 ''
          if (value !== null && value !== undefined) {
            validatedPayload[fieldId] = value;
          }
        }
        
        if (Object.keys(validatedPayload).length === 0) {
          console.warn(`第 ${i + 1} 条记录没有有效数据，跳过`);
          continue;
        }
        
        console.log('验证后的payload:', JSON.stringify(validatedPayload, null, 2));
        
        const createResult = await client.base.appTableRecord.create({
          path: { table_id: targetTableId },
          data: { fields: validatedPayload }
        });
        
        const newRecordId = createResult?.data?.record?.record_id || 
                           createResult?.data?.record_id || 
                           '未知';
        
        console.log(`✅ 成功写入记录 ${i + 1}: ${newRecordId}`);
        console.log('API响应详情:', JSON.stringify({
          success: !!createResult?.data,
          recordCreated: !!newRecordId && newRecordId !== '未知',
          responseStructure: createResult?.data ? Object.keys(createResult.data) : []
        }, null, 2));
        
        // 添加延迟以避免频率限制
        if (i > 0 && i % 10 === 0) {
          console.log('暂停1秒以避免频率限制...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (recordError) {
        console.error(`写入第 ${i + 1} 条记录失败:`, {
          error: recordError.message,
          response: recordError.response?.data,
          record: rec.record_id,
          fields: Object.keys(rec.fields),
          payload: JSON.stringify(payload, null, 2)
        });
        
        // 解析具体的API错误
        const apiError = recordError.response?.data;
        if (apiError) {
          console.error('API错误详情:', JSON.stringify(apiError, null, 2));
          
          if (apiError.sc === 30) {
            console.error('错误分析：字段类型不匹配或字段不存在');
            console.error('请检查字段映射:', fieldMap);
            console.error('当前记录数据:', rec.fields);
          }
        }
        
        // 如果是单条记录错误，继续处理下一条
        if (recordError.response?.data?.sc === 30) {
          console.log('字段类型不匹配，跳过此记录继续处理...');
          continue;
        }
        
        // 如果是严重错误，抛出异常
        throw recordError;
      }
    }

    res.json({ success: true, copied: records.length });
  } catch (err) {
    console.error('复制操作失败:', err);
    
    // 解析飞书API错误响应
    let errorMessage = err.message;
    let errorDetails = null;
    
    if (err.response?.data) {
      const apiError = err.response.data;
      errorDetails = apiError;
      
      // 解析常见的飞书API错误码
      if (apiError.code) {
        switch (apiError.code) {
          case 1:
            errorMessage = '参数错误：请检查表格ID和字段映射';
            break;
          case 2:
            errorMessage = '权限不足：请检查PersonalBaseToken权限';
            break;
          case 30:
            errorMessage = '字段操作失败：可能是字段类型不匹配或字段不存在';
            break;
          case 1254:
            errorMessage = '请求频率过高：请稍后再试';
            break;
          default:
            errorMessage = `飞书API错误 (${apiError.code}): ${apiError.msg || '未知错误'}`;
        }
      } else if (apiError.sc) {
        // 处理 {"e":0,"sc":30} 格式的响应
        switch (apiError.sc) {
          case 30:
            errorMessage = '字段写入失败：请检查字段类型匹配和写入权限';
            break;
          default:
            errorMessage = `飞书服务错误 (sc:${apiError.sc})`;
        }
      }
    }
    
    console.error('详细错误信息:', {
      originalError: err.message,
      apiResponse: errorDetails,
      stack: err.stack
    });
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: errorDetails,
      timestamp: new Date().toISOString()
    });
  }
}