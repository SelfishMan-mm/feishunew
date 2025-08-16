const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { sourceTableId, targetTableId } = req.body;
  const baseId = 'KnX9bIOTKaE3trspPCycfFMjnkg';
  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: 'pt-bOGOfkA-lYy4LMm3KG06xw28GPVfHleZaNRqmWiYAQAABEBE9RyAClgqPlmY'
  });

  try {
    // 1. 字段 & 记录（分页）
    const [sf, tf] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);
    const sFields = sf.data.items;
    const tFields = tf.data.items;

    const map = new Map(tFields.map(f => [f.field_name, f.field_id]));
    const fieldMap = {};
    sFields.forEach(f => { const id = map.get(f.field_name); if (id) fieldMap[f.field_id] = id; });

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
    res.status(500).json({ success: false, error: err.message });
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