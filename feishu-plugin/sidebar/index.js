// 全局变量
let currentBaseId = null;
let currentToken = null;
let isAuthorized = false;

// 页面加载时初始化
window.addEventListener('load', () => {
  initializePlugin();
});

// 初始化插件
function initializePlugin() {
  // 从URL获取BaseId和表格信息
  autoDetectBaseId();
  
  // 初始化UI状态
  updateUIState();
  
  log('插件已加载，请输入PersonalBaseToken');
}

// 自动获取BaseId
function autoDetectBaseId() {
  try {
    // 从URL参数获取
    const urlParams = new URLSearchParams(window.location.search);
    const tableParam = urlParams.get('table');
    
    // 从当前页面URL获取BaseId
    const currentUrl = window.location.href;
    const baseIdMatch = currentUrl.match(/\/base\/([a-zA-Z0-9]+)/);
    
    if (baseIdMatch) {
      currentBaseId = baseIdMatch[1];
      document.getElementById('baseId').value = currentBaseId;
      log(`✅ 自动获取BaseId: ${currentBaseId}`);
    } else {
      // 使用默认值
      currentBaseId = 'KnX9bIOTKaE3trspPCycfFMjnkg';
      document.getElementById('baseId').value = currentBaseId + ' (默认)';
      log('⚠️ 使用默认BaseId');
    }
    
    // 如果有表格参数，自动填入源表格
    if (tableParam) {
      document.getElementById('sourceTable').value = tableParam;
      log(`✅ 自动获取当前表格ID: ${tableParam}`);
    }
  } catch (error) {
    log(`❌ 初始化失败: ${error.message}`);
  }
}

// 测试授权
async function testAuth() {
  const token = document.getElementById('personalToken').value.trim();
  const baseId = document.getElementById('baseId').value.replace(' (默认)', '').trim();
  
  if (!token) {
    showStatus('authStatus', '请输入PersonalBaseToken', 'error');
    return;
  }

  if (!baseId) {
    showStatus('authStatus', 'BaseId不能为空', 'error');
    return;
  }

  log('🔍 正在测试授权...');
  showStatus('authStatus', '正在验证授权...', 'info');

  try {
    // 调用FaaS函数测试授权
    const response = await fetch('/faas/testAuth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        baseId, 
        personalToken: token 
      })
    });

    const data = await response.json();
    
    if (data.success) {
      currentToken = token;
      currentBaseId = baseId;
      isAuthorized = true;
      
      showStatus('authStatus', `授权成功！可访问 ${data.tableCount} 个表格`, 'success');
      log(`✅ 授权成功！可访问 ${data.tableCount} 个表格`);
      
      updateUIState();
    } else {
      isAuthorized = false;
      showStatus('authStatus', `授权失败: ${data.error}`, 'error');
      log(`❌ 授权失败: ${data.error}`);
      updateUIState();
    }
  } catch (error) {
    isAuthorized = false;
    showStatus('authStatus', `网络错误: ${error.message}`, 'error');
    log(`❌ 测试授权失败: ${error.message}`);
    updateUIState();
  }
}

// 执行操作（预览或直接复制）
async function executeOperation() {
  const sourceTable = document.getElementById('sourceTable').value.trim();
  const targetTable = document.getElementById('targetTable').value.trim();
  const selectedMode = document.querySelector('input[name="operationMode"]:checked').value;

  if (!sourceTable || !targetTable) {
    log('❗ 请填写源表格和目标表格ID');
    return;
  }

  if (!isAuthorized || !currentToken || !currentBaseId) {
    log('❗ 请先完成授权测试');
    return;
  }

  if (selectedMode === 'preview') {
    await previewDifferences();
  } else {
    await directCopy();
  }
}

// 预览差异
async function previewDifferences() {
  const sourceTable = document.getElementById('sourceTable').value.trim();
  const targetTable = document.getElementById('targetTable').value.trim();
  const primaryKey = document.getElementById('primaryKeyField').value;

  log('🔍 开始分析差异...');
  
  const operationBtn = document.getElementById('operationBtn');
  operationBtn.disabled = true;
  operationBtn.textContent = '分析中...';

  try {
    // 调用差异分析FaaS函数
    const response = await fetch('/faas/analyzeDiff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        baseId: currentBaseId,
        personalToken: currentToken,
        sourceTableId: sourceTable, 
        targetTableId: targetTable,
        primaryKeyField: primaryKey
      })
    });

    const data = await response.json();
    
    if (data.success) {
      displayDiffResults(data.results);
      log(`✅ 差异分析完成！新增: ${data.results.new.length}, 删除: ${data.results.deleted.length}, 修改: ${data.results.modified.length}, 相同: ${data.results.same.length}`);
    } else {
      log(`❌ 差异分析失败: ${data.error}`);
    }
  } catch (error) {
    log(`❌ 网络错误: ${error.message}`);
  } finally {
    operationBtn.disabled = false;
    operationBtn.textContent = '🔍 开始分析';
  }
}

// 直接复制
async function directCopy() {
  const sourceTable = document.getElementById('sourceTable').value.trim();
  const targetTable = document.getElementById('targetTable').value.trim();

  log('🚀 开始直接复制...');
  
  const operationBtn = document.getElementById('operationBtn');
  operationBtn.disabled = true;
  operationBtn.textContent = '复制中...';

  try {
    const response = await fetch('/faas/copyRecords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        baseId: currentBaseId,
        personalToken: currentToken,
        sourceTableId: sourceTable, 
        targetTableId: targetTable
      })
    });

    const data = await response.json();
    
    if (data.success) {
      log(`✅ 复制完成！成功复制 ${data.copied} 条记录`);
    } else {
      log(`❌ 复制失败: ${data.error}`);
    }
  } catch (error) {
    log(`❌ 网络错误: ${error.message}`);
  } finally {
    operationBtn.disabled = false;
    operationBtn.textContent = '🚀 开始复制';
  }
}

// 显示差异结果
function displayDiffResults(results) {
  const diffResultSection = document.getElementById('diffResultSection');
  const diffSummary = document.getElementById('diffSummary');
  
  // 显示结果区域
  diffResultSection.classList.remove('hidden');
  
  // 生成汇总信息
  diffSummary.innerHTML = `
    <div class="diff-summary">
      <div class="diff-item diff-new">
        <div style="font-weight: bold;">${results.new.length}</div>
        <div>新增记录</div>
      </div>
      <div class="diff-item diff-deleted">
        <div style="font-weight: bold;">${results.deleted.length}</div>
        <div>删除记录</div>
      </div>
      <div class="diff-item diff-modified">
        <div style="font-weight: bold;">${results.modified.length}</div>
        <div>修改记录</div>
      </div>
      <div class="diff-item diff-same">
        <div style="font-weight: bold;">${results.same.length}</div>
        <div>相同记录</div>
      </div>
    </div>
    <div style="font-size: 12px; color: #666; margin-top: 8px;">
      💡 新增和修改的记录将被复制到目标表格
    </div>
  `;
  
  // 存储结果供后续使用
  window.diffResults = results;
}

// 执行复制（基于差异结果）
async function executeCopy() {
  if (!window.diffResults) {
    log('❌ 没有差异分析结果');
    return;
  }

  const results = window.diffResults;
  const totalOperations = results.new.length + results.modified.length;
  
  if (totalOperations === 0) {
    log('ℹ️ 没有需要复制的记录');
    return;
  }

  if (!confirm(`确定要执行复制操作吗？\n将处理 ${totalOperations} 条记录（${results.new.length} 新增，${results.modified.length} 修改）`)) {
    return;
  }

  log(`🚀 开始执行复制操作，共 ${totalOperations} 条记录...`);
  
  const executeCopyBtn = document.getElementById('executeCopyBtn');
  executeCopyBtn.disabled = true;
  executeCopyBtn.textContent = '执行中...';

  try {
    const response = await fetch('/faas/executeDiffCopy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        baseId: currentBaseId,
        personalToken: currentToken,
        sourceTableId: document.getElementById('sourceTable').value.trim(),
        targetTableId: document.getElementById('targetTable').value.trim(),
        diffResults: results
      })
    });

    const data = await response.json();
    
    if (data.success) {
      log(`✅ 复制执行完成！成功: ${data.successCount}, 失败: ${data.errorCount}`);
      if (data.errors && data.errors.length > 0) {
        log(`⚠️ 部分错误: ${data.errors.slice(0, 3).join(', ')}`);
      }
    } else {
      log(`❌ 复制执行失败: ${data.error}`);
    }
  } catch (error) {
    log(`❌ 网络错误: ${error.message}`);
  } finally {
    executeCopyBtn.disabled = false;
    executeCopyBtn.textContent = '✅ 确认执行复制';
  }
}

// 导出结果
function exportResults() {
  if (!window.diffResults) {
    log('❌ 没有可导出的结果');
    return;
  }

  const results = window.diffResults;
  const exportData = {
    timestamp: new Date().toISOString(),
    summary: {
      new: results.new.length,
      deleted: results.deleted.length,
      modified: results.modified.length,
      same: results.same.length
    },
    details: results
  };

  // 创建下载链接
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `diff-results-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  log('📄 差异结果已导出为JSON文件');
}

// 更新UI状态
function updateUIState() {
  const operationBtn = document.getElementById('operationBtn');
  
  if (isAuthorized) {
    operationBtn.disabled = false;
    // 更新操作按钮文本
    updateOperationButtonText();
  } else {
    operationBtn.disabled = true;
  }
}

// 更新操作按钮文本
function updateOperationButtonText() {
  const operationBtn = document.getElementById('operationBtn');
  const selectedMode = document.querySelector('input[name="operationMode"]:checked').value;
  
  if (selectedMode === 'preview') {
    operationBtn.textContent = '🔍 开始分析';
  } else {
    operationBtn.textContent = '🚀 开始复制';
  }
}

// 监听操作模式变化
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[name="operationMode"]').forEach(radio => {
    radio.addEventListener('change', updateOperationButtonText);
  });
});

// 显示状态信息
function showStatus(elementId, message, type) {
  const element = document.getElementById(elementId);
  element.innerHTML = `<div class="status status-${type}">${message}</div>`;
}

// 日志函数
function log(message) {
  const logElement = document.getElementById('log');
  const timestamp = new Date().toLocaleTimeString();
  logElement.textContent += `[${timestamp}] ${message}\n`;
  logElement.scrollTop = logElement.scrollHeight;
}