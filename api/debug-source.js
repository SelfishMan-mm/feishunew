const { BaseClient } = require('@lark-base-open/node-sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sourceTableId, baseId, personalToken } = req.body;
  
  if (!sourceTableId || !baseId || !personalToken) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const client = new BaseClient({
    appToken: baseId,
    personalBaseToken: personalToken
  });

  try {
    console.log('🔍 开始调试源表数据...');

    // 1. 获取字段信息
    const fieldsRes = await client.base.appTableField.list({ path: { table_id: sourceTableId } });
    const fields = fieldsRes.data.items;
    
    console.log('源表字段列表:');
    fields.forEach(f => {
      console.log(`  ${f.field_name} (${f.field_id}) - 类型: ${f.type}`);
    });

    // 2. 获取前3条记录
    const recordsRes = await client.base.appTableRecord.list({
      path: { table_id: sourceTableId },
      params: { page_size: 3 }
    });

    const records = recordsRes.data.items;
    console.log(`\n获取到 ${records.length} 条记录:`);

    const analysisResult = {
      fields: fields.map(f => ({ 
        name: f.field_name, 
        id: f.field_id, 
        type: f.type 
      })),
      records: []
    };

    records.forEach((record, index) => {
      console.log(`\n记录 ${index + 1} (${record.record_id}):`);
      console.log('完整fields:', JSON.stringify(record.fields, null, 2));
      
      const recordAnalysis = {
        record_id: record.record_id,
        field_keys: Object.keys(record.fields),
        field_values: {}
      };

      Object.entries(record.fields).forEach(([key, value]) => {
        const fieldInfo = fields.find(f => f.field_id === key);
        const fieldName = fieldInfo ? fieldInfo.field_name : '未知字段';
        
        console.log(`  ${key} (${fieldName}): ${JSON.stringify(value)} [${typeof value}]`);
        
        recordAnalysis.field_values[key] = {
          fieldName,
          value,
          type: typeof value,
          isEmpty: value === '' || value === null || value === undefined
        };
      });

      analysisResult.records.push(recordAnalysis);
    });

    res.json({
      success: true,
      message: '源表数据分析完成',
      analysis: analysisResult
    });

  } catch (error) {
    console.error('调试源表数据失败:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data
    });
  }
}
