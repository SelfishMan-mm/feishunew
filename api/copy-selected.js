const express = require('express');
const router = express.Router();
const { BaseClient } = require('@lark-base-open/node-sdk');

// 复制选中的记录
async function copySelected(req, res) {
  try {
    const { baseId, sourceTableId, targetTableId, token, recordIds, fieldMapping } = req.body;
    
    if (!baseId || !sourceTableId || !targetTableId || !token || !recordIds || !Array.isArray(recordIds)) {
      return res.json({
        success: false,
        error: '缺少必要参数: baseId, sourceTableId, targetTableId, token, recordIds'
      });
    }

    console.log('开始复制选中记录...', { 
      recordCount: recordIds.length,
      fieldMapping 
    });

    // 初始化客户端
    const client = new BaseClient({ 
      baseId, 
      personalBaseToken: token 
    });

    // 1. 获取字段信息
    console.log('获取字段信息...');
    const [sourceFieldsResp, targetFieldsResp] = await Promise.all([
      client.base.appTableField.list({ table_id: sourceTableId }),
      client.base.appTableField.list({ table_id: targetTableId })
    ]);

    if (sourceFieldsResp.code !== 0 || targetFieldsResp.code !== 0) {
      return res.json({
        success: false,
        error: '获取字段信息失败'
      });
    }

    const sourceFields = sourceFieldsResp.data.items.map(f => ({
      id: f.field_id,
      name: f.field_name,
      type: f.type
    }));
    
    const targetFields = targetFieldsResp.data.items.map(f => ({
      id: f.field_id,
      name: f.field_name,
      type: f.type
    }));

    // 2. 构建字段映射
    let mappingRules = {};
    
    if (fieldMapping === 'auto') {
      // 自动匹配同名字段
      sourceFields.forEach(sf => {
        const matchedTarget = targetFields.find(tf => tf.name === sf.name);
        if (matchedTarget) {
          mappingRules[sf.id] = matchedTarget.id;
        }
      });
    } else {
      // 手动映射暂时使用自动匹配
      sourceFields.forEach(sf => {
        const matchedTarget = targetFields.find(tf => tf.name === sf.name);
        if (matchedTarget) {
          mappingRules[sf.id] = matchedTarget.id;
        }
      });
    }

    console.log('字段映射规则:', mappingRules);

    // 3. 获取选中的记录
    console.log('获取选中记录详情...');
    const recordsPromises = recordIds.map(recordId => 
      client.base.appTableRecord.get({
        table_id: sourceTableId,
        record_id: recordId
      })
    );

    const recordsResponses = await Promise.all(recordsPromises);
    const records = recordsResponses
      .filter(resp => resp.code === 0)
      .map(resp => resp.data.record);

    console.log(`成功获取 ${records.length} 条记录`);

    // 4. 数据转换和复制
    let copiedCount = 0;
    
    for (const [index, record] of records.entries()) {
      console.log(`处理第 ${index + 1}/${records.length} 条记录...`);
      
      const targetData = {};
      let fieldCount = 0;

      // 字段映射和数据转换
      for (const [sourceFieldId, targetFieldId] of Object.entries(mappingRules)) {
        const sourceField = sourceFields.find(f => f.id === sourceFieldId);
        const targetField = targetFields.find(f => f.id === targetFieldId);
        
        if (!sourceField || !targetField) continue;

        const sourceFieldName = sourceField.name;
        const targetFieldName = targetField.name;
        
        if (record.fields.hasOwnProperty(sourceFieldName)) {
          const value = record.fields[sourceFieldName];
          
          if (value !== undefined && value !== null) {
            // 数据类型转换
            let convertedValue;
            
            switch (targetField.type) {
              case 1: // 文本
                convertedValue = String(value);
                break;
              case 2: // 数字
                convertedValue = Number(value);
                if (isNaN(convertedValue)) continue;
                break;
              case 3: // 单选
                convertedValue = String(value);
                break;
              case 4: // 多选
                convertedValue = Array.isArray(value) ? value.map(v => String(v)) : [String(value)];
                break;
              default:
                convertedValue = value;
            }
            
            // 使用目标字段名称作为键
            targetData[targetFieldName] = convertedValue;
            fieldCount++;
          }
        }
      }

      if (Object.keys(targetData).length === 0) {
        console.log(`第 ${index + 1} 条记录没有可映射数据，跳过`);
        continue;
      }

      // 创建记录
      try {
        const createResp = await client.base.appTableRecord.create({
          table_id: targetTableId,
          record: { fields: targetData }
        });

        if (createResp.code === 0) {
          copiedCount++;
          console.log(`✅ 第 ${index + 1} 条记录复制成功`);
        } else {
          console.log(`❌ 第 ${index + 1} 条记录复制失败:`, createResp.msg);
        }
      } catch (createError) {
        console.log(`❌ 第 ${index + 1} 条记录创建异常:`, createError.message);
      }
    }

    console.log(`复制完成: 成功 ${copiedCount}/${records.length} 条记录`);

    res.json({
      success: true,
      copiedCount,
      totalCount: records.length,
      skippedCount: records.length - copiedCount
    });

  } catch (error) {
    console.error('复制选中记录错误:', error);
    res.json({
      success: false,
      error: error.message || '复制失败'
    });
  }
}

module.exports = copySelected;
