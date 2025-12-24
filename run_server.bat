@echo off
chcp 65001 >nul
TITLE Backend Server - Port 4000

echo.
echo ==========================================
echo   KHOI DONG BACKEND SERVER
echo ==========================================
echo.

set "ROOT_DIR=%~dp0"

:: Kiem tra node_modules
if not exist "%ROOT_DIR%admin-dashboard\server\node_modules" (
    echo [CANH BAO] Chua cai dat thu vien!
    echo Dang cai dat...
    cd /d "%ROOT_DIR%admin-dashboard\server"
    call npm install
)

cd /d "%ROOT_DIR%admin-dashboard\server"

echo Dang khoi dong server...
echo.
echo   URL: http://localhost:4000
echo   API: http://localhost:4000/books
echo.
echo   Nhan Ctrl+C de dung server.
echo.

node index.js

pause
