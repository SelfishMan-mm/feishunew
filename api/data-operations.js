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
  const { sourceTableId, targetTableId, baseId, personalToken, records, customFieldMapping } = req.body;
  
  if (!sourceTableId || !targetTableId || !baseId || !personalToken || !records) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    let fieldMapping = {};

    // ✅ 优先使用自定义字段映射
    if (customFieldMapping && Object.keys(customFieldMapping).length > 0) {
      fieldMapping = customFieldMapping;
      console.log('✅ 使用自定义字段映射:', Object.keys(fieldMapping).length, '个字段');
    } else {
      // 获取字段信息进行自动映射
      const [sourceFields, targetFields] = await Promise.all([
        client.base.appTableField.list({ path: { table_id: sourceTableId } }),
        client.base.appTableField.list({ path: { table_id: targetTableId } })
      ]);

      const targetFieldMap = new Map(targetFields.data.items.map(f => [f.field_name, f.field_id]));
      
      sourceFields.data.items.forEach(sourceField => {
        const targetFieldId = targetFieldMap.get(sourceField.field_name);
        if (targetFieldId) {
          // ✅ 参考项目的正确逻辑：源字段ID -> 目标字段ID
          fieldMapping[sourceField.field_id] = targetFieldId;
        }
      });
      console.log('✅ 使用自动字段映射:', Object.keys(fieldMapping).length, '个字段');
    }

    // 复制记录
    let successCount = 0;
    let errorCount = 0;
    const errorDetails = [];

    console.log(`开始复制 ${records.length} 条记录...`);

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        const transformedFields = {};
        
        Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
          if (record.fields[sourceFieldId] !== undefined && record.fields[sourceFieldId] !== null) {
            transformedFields[targetFieldId] = record.fields[sourceFieldId];
          }
        });

        if (Object.keys(transformedFields).length > 0) {
          console.log(`正在复制第 ${i + 1}/${records.length} 条记录...`);
          
          await client.base.appTableRecord.create({
            path: { table_id: targetTableId },
            data: { fields: transformedFields }
          });
          successCount++;
          
          // 添加延迟以避免频率限制
          if (i > 0 && i % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } catch (error) {
        errorCount++;
        const errorInfo = {
          recordIndex: i + 1,
          recordId: record.record_id,
          error: error.message,
          apiResponse: error.response?.data
        };
        
        console.error(`复制第 ${i + 1} 条记录失败:`, errorInfo);
        errorDetails.push(errorInfo);
        
        // 如果是字段类型错误，继续处理下一条
        if (error.response?.data?.sc === 30 || error.response?.data?.code === 30) {
          console.log('字段类型不匹配，跳过此记录继续处理...');
          continue;
        }
        
        // 如果错误太多，停止处理
        if (errorCount > 10) {
          console.log('错误数量过多，停止处理...');
          break;
        }
      }
    }

    res.json({
      success: true,
      copied: successCount,
      errors: errorCount,
      total: records.length,
      errorDetails: errorDetails.slice(0, 5), // 只返回前5个错误详情
      message: `成功复制 ${successCount}/${records.length} 条记录${errorCount > 0 ? `，${errorCount} 条失败` : ''}`
    });

  } catch (error) {
    console.error('复制记录失败:', error);
    
    // 解析飞书API错误
    let errorMessage = error.message;
    if (error.response?.data) {
      const apiError = error.response.data;
      if (apiError.sc === 30) {
        errorMessage = '字段操作失败：请检查字段类型匹配和目标表权限';
      } else if (apiError.code) {
        errorMessage = `飞书API错误 (${apiError.code}): ${apiError.msg || '未知错误'}`;
      }
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.response?.data,
      timestamp: new Date().toISOString()
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
    
    // 调试：检查字段匹配情况
    if (records.length > 0 && filters.length > 0) {
      const firstRecord = records[0];
      const filterField = filters[0].field;
      console.log(`筛选字段 ${filterField} 是否存在:`, filterField in firstRecord.fields);
    }
    
    const matchedRecords = records.filter(record => applyFilters(record, filters));
    
    res.json({
      success: true,
      totalCount: records.length,
      matchedCount: matchedRecords.length,
      records: matchedRecords, // ✅ 返回筛选后的记录
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
  const { sourceTableId, targetTableId, baseId, personalToken, filters, customFieldMapping } = req.body;
  
  if (!sourceTableId || !targetTableId || !baseId || !personalToken || !filters) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    let fieldMapping = {};

    // ✅ 优先使用自定义字段映射
    if (customFieldMapping && Object.keys(customFieldMapping).length > 0) {
      fieldMapping = customFieldMapping;
      console.log('✅ 筛选复制使用自定义字段映射:', Object.keys(fieldMapping).length, '个字段');
    } else {
      // 获取字段映射
      const [sourceFields, targetFields] = await Promise.all([
        client.base.appTableField.list({ path: { table_id: sourceTableId } }),
        client.base.appTableField.list({ path: { table_id: targetTableId } })
      ]);

      const targetFieldMap = new Map(targetFields.data.items.map(f => [f.field_name, f.field_id]));
      
      sourceFields.data.items.forEach(sourceField => {
        const targetFieldId = targetFieldMap.get(sourceField.field_name);
        if (targetFieldId) {
          fieldMapping[sourceField.field_id] = targetFieldId;
        }
      });
      console.log('✅ 筛选复制使用自动字段映射:', Object.keys(fieldMapping).length, '个字段');
    }

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
  
  // 简化调试：只在字段值为undefined时输出
  if (fieldValue === undefined) {
    console.log(`⚠️ 字段 ${filter.field} 在记录中不存在，可用字段:`, Object.keys(record.fields).slice(0, 5));
    return filter.operator === 'isEmpty';
  }
  
  if (fieldValue === null || fieldValue === '') {
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