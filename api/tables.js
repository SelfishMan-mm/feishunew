const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { baseId, personalToken } = req.body;
  
  if (!baseId || !personalToken) {
    return res.status(400).json({ success: false, error: '缺少BaseId或PersonalBaseToken' });
  }

  try {
    const client = new BaseClient({
      appToken: baseId,
      personalBaseToken: personalToken
    });

    const response = await client.base.appTable.list();
    
    const tables = response.data.items.map(table => ({
      table_id: table.table_id,
      name: table.name,
      revision: table.revision
    }));

    res.json({
      success: true,
      tables
    });

  } catch (error) {
    console.error('获取表格列表失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};