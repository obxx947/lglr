@echo off
chcp 65001 >nul
title 拉格朗日 - 一键推送到 GitHub
cd /d "C:\Users\Administrator\Desktop\lglr.html"

echo.
echo ╔══════════════════════════════════════════╗
echo ║     🚀 拉格朗日 一键推送到 GitHub      ║
echo ╚══════════════════════════════════════════╝
echo.

:: === 第1步：从源文件夹同步 ===
echo [1/4] 从 拉格朗日智能体3 同步文件...
robocopy "C:\Users\Administrator\Desktop\拉格朗日智能体3" "." /E /NFL /NDL /NJH /NJS /XD node_modules .git __pycache__ 2>nul
if errorlevel 8 (
    echo     ✗ 同步失败！请检查源文件夹是否存在
    pause
    exit /b 1
)
echo     ✓ 文件同步完成

:: === 第2步：清理不提交的文件 ===
echo [2/4] 清理临时文件...
if exist node_modules\ rmdir /s /q node_modules 2>nul
if exist __pycache__\ rmdir /s /q __pycache__ 2>nul
del /q *.log 2>nul
del /q fix_*.py 2>nul
del /q test_*.js 2>nul
echo     ✓ 清理完成

:: === 第3步：Git 提交 ===
echo [3/4] 提交到 Git...
git add -A

:: 生成带日期时间的提交信息
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DT=%%I
set VER=v%DT:~0,4%%DT:~4,2%%DT:~6,2%_%DT:~8,2%%DT:~10,2%
git commit -m "%VER%: 快速同步" 2>nul
if errorlevel 1 (
    echo     - 无变更，跳过提交
) else (
    echo     ✓ 提交完成 [%VER%]
)

:: === 第4步：推送 ===
echo [4/4] 推送到 GitHub...
git push origin main
if errorlevel 1 (
    echo.
    echo ╔══════════════════════════════════════════╗
    echo ║  ✗ 推送失败！请检查网络 / SSH 配置      ║
    echo ╚══════════════════════════════════════════╝
) else (
    echo.
    echo ╔══════════════════════════════════════════╗
    echo ║              ✅ 推送成功！               ║
    echo ╠══════════════════════════════════════════╣
    echo ║  🌐 https://obxx947.github.io/lglr/      ║
    echo ╚══════════════════════════════════════════╝
)

echo.
echo 按任意键关闭...
pause >nul
