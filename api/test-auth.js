const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { baseId, personalToken } = req.body;
  
  if (!baseId || !personalToken) {
    return res.status(400).json({ success: false, error: '缺少BaseId或PersonalBaseToken' });
  }

  try {
    const client = new BaseClient({
      appToken: baseId,
      personalBaseToken: personalToken
    });

    // 测试授权：尝试获取表格列表
    const tablesResponse = await client.base.appTable.list();
    const tableCount = tablesResponse.data.items.length;

    res.json({ 
      success: true, 
      tableCount,
      message: `授权成功，可访问 ${tableCount} 个表格`
    });

  } catch (error) {
    console.error('授权测试失败:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || '授权失败，请检查BaseId和PersonalBaseToken是否正确'
    });
  }
};