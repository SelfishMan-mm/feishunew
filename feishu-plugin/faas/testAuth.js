const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function(event, context) {
  const { baseId, personalToken } = event.body;
  
  if (!baseId || !personalToken) {
    return {
      success: false,
      error: '缺少BaseId或PersonalBaseToken'
    };
  }

  try {
    const client = new BaseClient({
      appToken: baseId,
      personalBaseToken: personalToken
    });

    // 测试授权：尝试获取表格列表
    const tablesResponse = await client.base.appTable.list();
    
    if (!tablesResponse?.data?.items) {
      throw new Error('获取表格列表失败，请检查授权信息');
    }
    
    const tableCount = tablesResponse.data.items.length;

    return {
      success: true,
      tableCount,
      message: `授权成功，可访问 ${tableCount} 个表格`
    };

  } catch (error) {
    console.error('授权测试失败:', error);
    return {
      success: false,
      error: error.message || '授权失败，请检查BaseId和PersonalBaseToken是否正确'
    };
  }
};