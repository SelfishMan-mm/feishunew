const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function(event, context) {
  const { baseId, personalToken, sourceTableId, targetTableId } = event.body;
  
  if (!baseId || !personalToken) {
    return {
      success: false,
      error: '缺少BaseId或PersonalBaseToken'
    };
  }
  
  if (!sourceTableId || !targetTableId) {
    return {
      success: false,
      error: '缺少源表格ID或目标表格ID'
    };
  }

  try {
    const client = new BaseClient({
      appToken: baseId,
      personalBaseToken: personalToken
    });

    console.log('开始复制操作:', { sourceTableId, targetTableId, baseId });

    // 1. 获取字段信息
    const [sourceFieldsRes, targetFieldsRes] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    if (!sourceFieldsRes?.data?.items || !targetFieldsRes?.data?.items) {
      throw new Error('获取字段信息失败，请检查表格ID是否正确');
    }

    const sourceFields = sourceFieldsRes.data.items;
    const targetFields = targetFieldsRes.data.items;

    console.log('字段信息:', { 
      sourceFieldsCount: sourceFields.length, 
      targetFieldsCount: targetFields.length 
    });

    // 2. 建立字段映射（按字段名匹配）
    const targetFieldMap = new Map(targetFields.map(f => [f.field_name, f.field_id]));
    const fieldMapping = {};
    
    sourceFields.forEach(sourceField => {
      const targetFieldId = targetFieldMap.get(sourceField.field_name);
      if (targetFieldId) {
        fieldMapping[sourceField.field_id] = targetFieldId;
      }
    });

    const mappedFieldsCount = Object.keys(fieldMapping).length;
    console.log('字段映射完成:', { mappedFieldsCount });

    if (mappedFieldsCount === 0) {
      return {
        success: false,
        error: '没有找到匹配的字段，请检查源表格和目标表格的字段名称是否一致'
      };
    }

    // 3. 分页获取源表格记录
    let pageToken;
    const records = [];
    
    do {
      const recordsRes = await client.base.appTableRecord.list({
        path: { table_id: sourceTableId },
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

    console.log('获取源记录完成:', { recordsCount: records.length });

    if (records.length === 0) {
      return {
        success: false,
        error: '源表格没有数据记录'
      };
    }

    // 4. 复制记录到目标表格
    let copiedCount = 0;
    const errors = [];

    for (const record of records) {
      try {
        // 转换字段数据
        const transformedFields = {};
        
        Object.entries(fieldMapping).forEach(([sourceFieldId, targetFieldId]) => {
          if (record.fields[sourceFieldId] !== undefined) {
            transformedFields[targetFieldId] = record.fields[sourceFieldId];
          }
        });

        // 创建新记录
        await client.base.appTableRecord.create({
          path: { table_id: targetTableId },
          data: { fields: transformedFields }
        });

        copiedCount++;
      } catch (error) {
        console.error('复制单条记录失败:', error);
        errors.push(`记录 ${record.record_id}: ${error.message}`);
        
        // 如果错误太多，停止复制
        if (errors.length > 10) {
          break;
        }
      }
    }

    console.log('复制操作完成:', { 
      totalRecords: records.length, 
      copiedCount, 
      errorCount: errors.length 
    });

    return {
      success: true,
      copied: copiedCount,
      total: records.length,
      errors: errors.slice(0, 5), // 只返回前5个错误
      mappedFields: mappedFieldsCount
    };

  } catch (error) {
    console.error('复制操作失败:', error);
    return {
      success: false,
      error: error.message || '复制操作失败'
    };
  }
};

console.log('写入字段:', transformedFields);
await client.base.appTableRecord.create({
  path: { table_id: targetTableId },
  data: { fields: transformedFields }
}).catch(err => {
  console.error('写入失败字段:', transformedFields, err.message);
  throw err;   // 继续抛出去让前端看到
});