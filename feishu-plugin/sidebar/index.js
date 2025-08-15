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

// 开始复制
async function startCopy() {
  const sourceTable = document.getElementById('sourceTable').value.trim();
  const targetTable = document.getElementById('targetTable').value.trim();

  if (!sourceTable || !targetTable) {
    log('❗ 请填写源表格和目标表格ID');
    return;
  }

  if (!isAuthorized || !currentToken || !currentBaseId) {
    log('❗ 请先完成授权测试');
    return;
  }

  log('🚀 开始复制数据...');
  
  // 禁用复制按钮
  const copyBtn = document.getElementById('copyBtn');
  copyBtn.disabled = true;
  copyBtn.textContent = '复制中...';

  try {
    // 调用FaaS函数执行复制
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
    // 恢复复制按钮
    copyBtn.disabled = false;
    copyBtn.textContent = '🚀 开始复制';
  }
}

// 更新UI状态
function updateUIState() {
  const copyBtn = document.getElementById('copyBtn');
  
  if (isAuthorized) {
    copyBtn.disabled = false;
  } else {
    copyBtn.disabled = true;
  }
}

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