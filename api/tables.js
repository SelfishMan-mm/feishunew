const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { baseId, personalToken } = req.body;
  
  if (!baseId || !personalToken) {
    return res.status(400).json({ error: '缺少BaseId或PersonalBaseToken' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('获取表格列表:', { baseId });

    const tablesResponse = await client.base.appTable.list();

    if (!tablesResponse?.data?.items) {
      throw new Error('获取表格列表失败，请检查授权信息');
    }

    const tables = tablesResponse.data.items.map(table => ({
      table_id: table.table_id,
      name: table.name,
      revision: table.revision
    }));

    console.log(`获取到 ${tables.length} 个表格`);

    res.json({
      success: true,
      tables: tables
    });

  } catch (error) {
    console.error('获取表格列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取表格列表失败'
    });
  }
};