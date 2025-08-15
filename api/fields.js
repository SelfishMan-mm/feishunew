const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { baseId, personalToken, tableId } = req.body;
  
  if (!baseId || !personalToken) {
    return res.status(400).json({ error: '缺少BaseId或PersonalBaseToken' });
  }

  if (!tableId) {
    return res.status(400).json({ error: '缺少表格ID' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('获取字段信息:', { tableId });

    const fieldsResponse = await client.base.appTableField.list({
      path: { table_id: tableId }
    });

    if (!fieldsResponse?.data?.items) {
      throw new Error('获取字段信息失败，请检查表格ID是否正确');
    }

    const fields = fieldsResponse.data.items.map(field => ({
      field_id: field.field_id,
      field_name: field.field_name,
      type: field.type,
      description: field.description || ''
    }));

    console.log(`获取到 ${fields.length} 个字段`);

    res.json({
      success: true,
      fields: fields
    });

  } catch (error) {
    console.error('获取字段信息失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取字段信息失败'
    });
  }
};