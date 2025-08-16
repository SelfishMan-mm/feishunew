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
        throw new Error(`源表格字段获取失败，响应结构异常: ${JSON.stringify(sf)}`);
      }
      if (!tf?.data?.items) {
        throw new Error(`目标表格字段获取失败，响应结构异常: ${JSON.stringify(tf)}`);
      }
      
      const sFields = sf.data.items;
      const tFields = tf.data.items;
      
      console.log('字段信息:', { sourceFields: sFields.length, targetFields: tFields.length });

      const map = new Map(tFields.map(f => [f.field_name, f.field_id]));
      sFields.forEach(f => { const id = map.get(f.field_name); if (id) fieldMap[f.field_id] = id; });
      console.log('✅ 整表复制使用自动字段映射:', Object.keys(fieldMap).length, '个字段');
    }

    let pageToken;
    const records = [];
    do {
      const r = await client.base.appTableRecord.list({
        path: { table_id: sourceTableId },
        params: { page_size: 100, page_token: pageToken }
      });
      records.push(...r.data.items);
      pageToken = r.data.page_token;
    } while (pageToken);

    // 2. 写入目标表
    for (const rec of records) {
      const payload = {};
      for (const [s, t] of Object.entries(fieldMap)) payload[t] = rec.fields[s];
      await client.base.appTableRecord.create({
        path: { table_id: targetTableId },
        data: { fields: payload }
      });
    }

    res.json({ success: true, copied: records.length });
  } catch (err) {
    console.error('复制操作失败:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      details: err.stack
    });
  }
}
console.log('写入字段:', transformedFields);
await client.base.appTableRecord.create({
  path: { table_id: targetTableId },
  data: { fields: transformedFields }
}).catch(err => {
  console.error('写入失败字段:', transformedFields, err.message);
  throw err;   // 继续抛出去让前端看到
});