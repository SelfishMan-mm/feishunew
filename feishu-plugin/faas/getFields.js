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
      error: '缺少表格ID'
    };
  }

  try {
    const client = new BaseClient({
      appToken: baseId,
      personalBaseToken: personalToken
    });

    // 获取字段信息
    const [sourceFieldsRes, targetFieldsRes] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    if (!sourceFieldsRes?.data?.items || !targetFieldsRes?.data?.items) {
      throw new Error('获取字段信息失败，请检查表格ID是否正确');
    }

    const sourceFields = sourceFieldsRes.data.items.map(field => ({
      field_id: field.field_id,
      field_name: field.field_name,
      type: field.type
    }));

    const targetFields = targetFieldsRes.data.items.map(field => ({
      field_id: field.field_id,
      field_name: field.field_name,
      type: field.type
    }));

    // 自动匹配字段
    const matches = [];
    sourceFields.forEach(sourceField => {
      const matchedTarget = targetFields.find(tf => tf.field_name === sourceField.field_name);
      if (matchedTarget) {
        matches.push({
          source: sourceField,
          target: matchedTarget
        });
      }
    });

    return {
      success: true,
      sourceFields,
      targetFields,
      matches,
      matchCount: matches.length
    };

  } catch (error) {
    console.error('获取字段信息失败:', error);
    return {
      success: false,
      error: error.message || '获取字段信息失败'
    };
  }
};