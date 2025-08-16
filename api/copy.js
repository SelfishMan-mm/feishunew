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

    // ✅ 优先使用自定义字段映射
    if (customFieldMapping && Object.keys(customFieldMapping).length > 0) {
      fieldMap = customFieldMapping;
      console.log('✅ 整表复制使用自定义字段映射:', Object.keys(fieldMap).length, '个字段');
    } else {
      // 1. 字段 & 记录（分页）
      const [sf, tf] = await Promise.all([
        client.base.appTableField.list({ path: { table_id: sourceTableId } }),
        client.base.appTableField.list({ path: { table_id: targetTableId } })
      ]);
      
      console.log('字段API响应:', { sf: sf?.data, tf: tf?.data });
      
      // 检查返回数据结构
      if (!sf?.data?.items) {
        console.error('源表格字段API完整响应:', JSON.stringify(sf, null, 2));
        throw new Error(`源表格字段获取失败，响应结构异常: ${JSON.stringify(sf)}`);
      }
      if (!tf?.data?.items) {
        console.error('目标表格字段API完整响应:', JSON.stringify(tf, null, 2));
        throw new Error(`目标表格字段获取失败，响应结构异常: ${JSON.stringify(tf)}`);
      }
      
      const sFields = sf.data.items;
      const tFields = tf.data.items;
      
      console.log('源表字段详情:', sFields.map(f => ({ id: f.field_id, name: f.field_name, type: f.type })));
      console.log('目标表字段详情:', tFields.map(f => ({ id: f.field_id, name: f.field_name, type: f.type })));
      
      console.log('字段信息:', { sourceFields: sFields.length, targetFields: tFields.length });

      const map = new Map(tFields.map(f => [f.field_name, f.field_id]));
      sFields.forEach(f => { 
        const id = map.get(f.field_name); 
        if (id) {
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
        
        // 构建要写入的数据，只包含映射成功的字段
        for (const [sourceFieldId, targetFieldId] of Object.entries(fieldMap)) {
          if (rec.fields[sourceFieldId] !== undefined && rec.fields[sourceFieldId] !== null) {
            payload[targetFieldId] = rec.fields[sourceFieldId];
            mappedFieldCount++;
          }
        }
        
        console.log(`第 ${i + 1} 条记录映射了 ${mappedFieldCount} 个字段:`, payload);
        
        if (Object.keys(payload).length === 0) {
          console.warn(`第 ${i + 1} 条记录没有可映射的字段，跳过`);
          continue;
        }
        
        console.log(`正在写入第 ${i + 1}/${records.length} 条记录...`);
        
        const createResult = await client.base.appTableRecord.create({
          path: { table_id: targetTableId },
          data: { fields: payload }
        });
        
        console.log(`成功写入记录 ${i + 1}:`, createResult.data?.record?.record_id);
        
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