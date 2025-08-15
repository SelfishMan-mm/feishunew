const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, targetTableId, baseId, personalToken, filters } = req.body;
  
  if (!sourceTableId || !targetTableId) {
    return res.status(400).json({ error: '缺少表ID' });
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
    console.log('开始筛选复制:', { sourceTableId, targetTableId, filtersCount: filters.length });

    // 1. 获取字段映射
    const [sourceFields, targetFields] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    const targetFieldMap = new Map(targetFields.data.items.map(f => [f.field_name, f.field_id]));
    const fieldMapping = {};
    
    sourceFields.data.items.forEach(sourceField => {
      const targetFieldId = targetFieldMap.get(sourceField.field_name);
      if (targetFieldId) {
        fieldMapping[sourceField.field_id] = targetFieldId;
      }
    });

    console.log(`建立了 ${Object.keys(fieldMapping).length} 个字段映射`);

    // 2. 获取所有记录并应用筛选
    const allRecords = await getAllRecords(client, sourceTableId);
    const filteredRecords = allRecords.filter(record => applyFilters(record, filters));
    
    console.log(`筛选后得到 ${filteredRecords.length} 条记录，原始记录 ${allRecords.length} 条`);

    // 3. 复制筛选后的记录
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const record of filteredRecords) {
      try {
        const transformedFields = {};
        
        // 根据字段映射转换数据
        Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
          if (record.fields[sourceFieldId] !== undefined) {
            transformedFields[targetFieldId] = record.fields[sourceFieldId];
          }
        });

        if (Object.keys(transformedFields).length > 0) {
          await client.base.appTableRecord.create({
            path: { table_id: targetTableId },
            data: { fields: transformedFields }
          });
          successCount++;
        }
      } catch (error) {
        console.error('复制记录失败:', error);
        errorCount++;
        errors.push(`复制记录失败: ${error.message}`);
      }
    }

    console.log('筛选复制完成:', { successCount, errorCount });

    res.json({
      success: true,
      processed: successCount,
      errors: errorCount,
      errorDetails: errors.slice(0, 10),
      totalFiltered: filteredRecords.length,
      totalOriginal: allRecords.length
    });

  } catch (error) {
    console.error('筛选复制失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '筛选复制失败'
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