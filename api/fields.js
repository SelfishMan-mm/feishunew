const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { sourceTable, targetTable, baseId, personalToken } = req.body;
  
  if (!sourceTable || !targetTable) {
    return res.status(400).json({ success: false, error: '缺少表格信息' });
  }

  if (!baseId || !personalToken) {
    return res.status(400).json({ success: false, error: '缺少BaseId或PersonalBaseToken' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    // 获取字段信息
    const [sourceFieldsRes, targetFieldsRes] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTable } }),
      client.base.appTableField.list({ path: { table_id: targetTable } })
    ]);

    const sourceFields = sourceFieldsRes.data.items.map(field => ({
      field_id: field.field_id,
      field_name: field.field_name,
      type: field.type,
      property: field.property
    }));

    const targetFields = targetFieldsRes.data.items.map(field => ({
      field_id: field.field_id,
      field_name: field.field_name,
      type: field.type,
      property: field.property
    }));

    res.json({
      success: true,
      sourceTableId: sourceTable,
      targetTableId: targetTable,
      sourceFields,
      targetFields
    });

  } catch (error) {
    console.error('获取字段信息失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};