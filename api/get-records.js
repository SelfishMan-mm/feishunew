const express = require('express');
const router = express.Router();
const { BaseClient } = require('@lark-base-open/node-sdk');

// 获取源表记录数据
async function getRecords(req, res) {
  try {
    const { baseId, sourceTableId, token } = req.body;
    
    if (!baseId || !sourceTableId || !token) {
      return res.json({
        success: false,
        error: '缺少必要参数: baseId, sourceTableId, token'
      });
    }

    console.log('获取记录数据...', { baseId, sourceTableId });

    // 初始化客户端
    const client = new BaseClient({ 
      baseId, 
      personalBaseToken: token 
    });

    // 获取记录
    let allRecords = [];
    let pageToken = null;
    const pageSize = 100;

    do {
      console.log(`获取记录分页，pageToken: ${pageToken}`);
      
      const params = {
        table_id: sourceTableId,
        page_size: pageSize,
      };
      
      if (pageToken) {
        params.page_token = pageToken;
      }

      const response = await client.base.appTableRecord.list(params);
      
      if (response.code !== 0) {
        console.error('获取记录失败:', response);
        return res.json({
          success: false,
          error: `获取记录失败: ${response.msg || '未知错误'}`
        });
      }

      const records = response.data.items || [];
      allRecords = allRecords.concat(records);
      pageToken = response.data.page_token;
      
      console.log(`本批获取 ${records.length} 条记录`);
      
    } while (pageToken);

    console.log(`总共获取 ${allRecords.length} 条记录`);

    // 返回记录数据
    res.json({
      success: true,
      records: allRecords,
      totalCount: allRecords.length
    });

  } catch (error) {
    console.error('获取记录数据错误:', error);
    res.json({
      success: false,
      error: error.message || '获取记录失败'
    });
  }
}

module.exports = getRecords;
