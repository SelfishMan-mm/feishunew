const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, baseId, personalToken, filters } = req.body;
  
  if (!sourceTableId) {
    return res.status(400).json({ error: '缺少源表格ID' });
  }

  if (!baseId || !personalToken) {
    return res.status(400).json({ error: '缺少BaseId或PersonalBaseToken' });
  }

  if (!filters || filters.length === 0) {
    return res.status(400).json({ error: '缺少筛选条件' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('开始筛选预览:', { sourceTableId, filtersCount: filters.length });

    // 获取所有记录
    const records = await getAllRecords(client, sourceTableId);
    console.log(`获取到 ${records.length} 条记录`);

    // 应用筛选条件
    const matchedRecords = records.filter(record => applyFilters(record, filters));
    
    console.log(`筛选后匹配 ${matchedRecords.length} 条记录`);

    res.json({
      success: true,
      totalCount: records.length,
      matchedCount: matchedRecords.length,
      filters: filters
    });

  } catch (error) {
    console.error('筛选预览失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '筛选预览失败'
    });
  }
};

// 获取表格所有记录
async function getAllRecords(client, tableId) {
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

  return records;
}

// 应用筛选条件
function applyFilters(record, filters) {
  return filters.every(filter => applyFilter(record, filter));
}

// 应用单个筛选条件
function applyFilter(record, filter) {
  const fieldValue = record.fields[filter.field];
  
  // 处理空值情况
  if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
    return filter.operator === 'isEmpty';
  }
  
  if (filter.operator === 'notEmpty') {
    return true;
  }
  
  if (filter.operator === 'isEmpty') {
    return false;
  }
  
  // 转换为字符串进行比较
  const valueStr = String(fieldValue).toLowerCase();
  const filterValueStr = String(filter.value).toLowerCase();
  
  switch (filter.operator) {
    case 'equals':
      return valueStr === filterValueStr;
    case 'contains':
      return valueStr.includes(filterValueStr);
    case 'startsWith':
      return valueStr.startsWith(filterValueStr);
    case 'endsWith':
      return valueStr.endsWith(filterValueStr);
    default:
      return false;
  }
}