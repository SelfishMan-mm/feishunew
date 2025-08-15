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
    console.log('获取表格数据:', { tableId });

    // 获取表格所有记录
    let pageToken;
    const records = [];
    
    do {
      const recordsRes = await client.base.appTableRecord.list({
        path: { table_id: tableId },
        params: { 
          page_size: 100, 
          page_token: pageToken 
        }
      });
      
      if (recordsRes?.data?.items) {
        records.push(...recordsRes.data.items);
      }
      
      pageToken = recordsRes?.data?.page_token;
    } while (pageToken);

    console.log(`获取到 ${records.length} 条记录`);

    res.json({
      success: true,
      records: records
    });

  } catch (error) {
    console.error('获取表格数据失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取表格数据失败'
    });
  }
};