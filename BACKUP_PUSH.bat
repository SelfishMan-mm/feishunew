@echo off
echo 飞书插件项目备份推送脚本
echo ==============================
echo.
echo 当前时间: %date% %time%
echo.
echo 正在检查Git状态...
git status
echo.
echo 正在检查提交历史...
git log --oneline -5
echo.
echo 正在尝试推送...
git push feishunew main
echo.
if %errorlevel% neq 0 (
    echo 推送失败，网络连接问题仍然存在
    echo.
    echo 建议解决方案：
    echo 1. 下载GitHub Desktop: https://desktop.github.com/
    echo 2. 配置SSH密钥（见PUSH_TROUBLESHOOTING.md）
    echo 3. 检查网络设置
    echo.
    pause
) else (
    echo 推送成功！
    pause
)