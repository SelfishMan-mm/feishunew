const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, targetTableId, baseId, personalToken } = req.body;
  
  if (!baseId || !personalToken) {
    return res.status(400).json({ error: '缺少BaseId或PersonalBaseToken' });
  }

  if (!sourceTableId || !targetTableId) {
    return res.status(400).json({ error: '缺少表格ID' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('开始调试字段信息...', { sourceTableId, targetTableId });
    
    // 获取字段信息
    const [sourceFieldsRes, targetFieldsRes] = await Promise.all([
      client.base.appTableField.list({ path: { table_id: sourceTableId } }),
      client.base.appTableField.list({ path: { table_id: targetTableId } })
    ]);

    console.log('源表字段响应:', sourceFieldsRes);
    console.log('目标表字段响应:', targetFieldsRes);

    const sourceFields = sourceFieldsRes?.data?.items || [];
    const targetFields = targetFieldsRes?.data?.items || [];

    // 分析字段匹配情况
    const fieldAnalysis = {
      sourceFields: sourceFields.map(f => ({
        id: f.field_id,
        name: f.field_name,
        type: f.type,
        ui: f.ui
      })),
      targetFields: targetFields.map(f => ({
        id: f.field_id,
        name: f.field_name,
        type: f.type,
        ui: f.ui
      })),
      matchedFields: [],
      unmatchedSource: [],
      unmatchedTarget: [],
      typeConflicts: []
    };

    // 建立字段映射和类型检查
    const targetFieldMap = new Map(targetFields.map(f => [f.field_name, f]));
    
    sourceFields.forEach(sourceField => {
      const targetField = targetFieldMap.get(sourceField.field_name);
      
      if (targetField) {
        const isTypeCompatible = isFieldTypeCompatible(sourceField.type, targetField.type);
        
        fieldAnalysis.matchedFields.push({
          sourceName: sourceField.field_name,
          sourceId: sourceField.field_id,
          sourceType: sourceField.type,
          targetId: targetField.field_id,
          targetType: targetField.type,
          typeCompatible: isTypeCompatible
        });

        if (!isTypeCompatible) {
          fieldAnalysis.typeConflicts.push({
            fieldName: sourceField.field_name,
            sourceType: sourceField.type,
            targetType: targetField.type
          });
        }
      } else {
        fieldAnalysis.unmatchedSource.push({
          name: sourceField.field_name,
          type: sourceField.type
        });
      }
    });

    // 找出目标表中未匹配的字段
    const sourceFieldNames = new Set(sourceFields.map(f => f.field_name));
    targetFields.forEach(targetField => {
      if (!sourceFieldNames.has(targetField.field_name)) {
        fieldAnalysis.unmatchedTarget.push({
          name: targetField.field_name,
          type: targetField.type
        });
      }
    });

    // 获取少量数据样本进行验证
    let sampleData = null;
    try {
      const sampleRes = await client.base.appTableRecord.list({
        path: { table_id: sourceTableId },
        params: { page_size: 3 }
      });
      
      console.log('样本数据原始响应:', JSON.stringify(sampleRes, null, 2));
      
      sampleData = sampleRes?.data?.items?.map(record => {
        // 创建字段ID到字段信息的映射
        const fieldIdMap = new Map(sourceFields.map(f => [f.field_id, f]));
        
        return {
          recordId: record.record_id,
          fields: Object.entries(record.fields).map(([fieldId, value]) => {
            const field = fieldIdMap.get(fieldId);
            return {
              fieldId: fieldId,  // 使用真实的字段ID
              fieldName: field?.field_name || 'Unknown',
              fieldType: field?.type || 'Unknown',
              value: value,
              valueType: typeof value
            };
          }).sort((a, b) => a.fieldName.localeCompare(b.fieldName)) // 按字段名排序
        };
      });
    } catch (error) {
      console.warn('获取样本数据失败:', error.message);
      console.warn('错误详情:', error.response?.data);
    }

    res.json({
      success: true,
      analysis: fieldAnalysis,
      sampleData,
      recommendations: generateRecommendations(fieldAnalysis)
    });

  } catch (error) {
    console.error('字段调试失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      apiResponse: error.response?.data
    });
  }
};

function isFieldTypeCompatible(sourceType, targetType) {
  // 字段类型兼容性检查
  const compatibilityMap = {
    1: [1], // 文本 -> 文本
    2: [2], // 数字 -> 数字
    3: [3], // 单选 -> 单选
    4: [4], // 多选 -> 多选
    5: [5], // 日期时间 -> 日期时间
    7: [7], // 复选框 -> 复选框
    11: [11], // 人员 -> 人员
    13: [13], // 电话号码 -> 电话号码
    15: [15], // 超链接 -> 超链接
    17: [17], // 附件 -> 附件
    19: [19], // 关联 -> 关联
    20: [20], // 公式 -> 公式
    21: [21] // 双向关联 -> 双向关联
  };

  const compatible = compatibilityMap[sourceType];
  return compatible && compatible.includes(targetType);
}

function generateRecommendations(analysis) {
  const recommendations = [];

  if (analysis.typeConflicts.length > 0) {
    recommendations.push({
      type: 'error',
      message: `发现 ${analysis.typeConflicts.length} 个字段类型冲突，这可能导致复制失败`,
      details: analysis.typeConflicts
    });
  }

  if (analysis.unmatchedSource.length > 0) {
    recommendations.push({
      type: 'warning',
      message: `源表有 ${analysis.unmatchedSource.length} 个字段在目标表中不存在，这些数据将被跳过`,
      details: analysis.unmatchedSource.map(f => f.name)
    });
  }

  if (analysis.matchedFields.length === 0) {
    recommendations.push({
      type: 'error',
      message: '没有找到匹配的字段，请检查表格结构是否正确'
    });
  }

  return recommendations;
}
