const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { operation } = req.body;

  switch (operation) {
    case 'get-table-data':
      return await getTableData(req, res);
    case 'copy-records':
      return await copyRecords(req, res);
    case 'preview-filter':
      return await previewFilter(req, res);
    case 'filter-copy':
      return await filterCopy(req, res);
    default:
      return res.status(400).json({ error: '不支持的操作类型' });
  }
};

// 获取表格数据
async function getTableData(req, res) {
  const { baseId, personalToken, tableId } = req.body;
  
  if (!baseId || !personalToken || !tableId) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
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
}

// 复制选中记录
async function copyRecords(req, res) {
  const { sourceTableId, targetTableId, baseId, personalToken, records } = req.body;
  
  if (!sourceTableId || !targetTableId || !baseId || !personalToken || !records) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    // 获取字段映射
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

    // 复制记录
    let successCount = 0;
    let errorCount = 0;

    for (const record of records) {
      try {
        const transformedFields = {};
        
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
        errorCount++;
      }
    }

    res.json({
      success: true,
      copied: successCount,
      errors: errorCount,
      total: records.length
    });

  } catch (error) {
    console.error('复制记录失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '复制记录失败'
    });
  }
}

// 预览筛选结果
async function previewFilter(req, res) {
  const { sourceTableId, baseId, personalToken, filters } = req.body;
  
  if (!sourceTableId || !baseId || !personalToken || !filters) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    const records = await getAllRecords(client, sourceTableId);
    const matchedRecords = records.filter(record => applyFilters(record, filters));
    
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
}

// 筛选复制
async function filterCopy(req, res) {
  const { sourceTableId, targetTableId, baseId, personalToken, filters } = req.body;
  
  if (!sourceTableId || !targetTableId || !baseId || !personalToken || !filters) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    // 获取字段映射
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

    // 获取并筛选记录
    const allRecords = await getAllRecords(client, sourceTableId);
    const filteredRecords = allRecords.filter(record => applyFilters(record, filters));
    
    // 复制筛选后的记录
    let successCount = 0;
    let errorCount = 0;

    for (const record of filteredRecords) {
      try {
        const transformedFields = {};
        
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
        errorCount++;
      }
    }

    res.json({
      success: true,
      processed: successCount,
      errors: errorCount,
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
}

// 辅助函数
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

function applyFilters(record, filters) {
  return filters.every(filter => applyFilter(record, filter));
}

function applyFilter(record, filter) {
  const fieldValue = record.fields[filter.field];
  
  if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
    return filter.operator === 'isEmpty';
  }
  
  if (filter.operator === 'notEmpty') {
    return true;
  }
  
  if (filter.operator === 'isEmpty') {
    return false;
  }
  
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