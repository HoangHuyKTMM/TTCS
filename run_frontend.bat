@echo off
chcp 65001 >nul
TITLE Admin Frontend - Port 5173

echo.
echo ==========================================
echo   KHOI DONG ADMIN FRONTEND (WEB)
echo ==========================================
echo.

set "ROOT_DIR=%~dp0"

:: Kiem tra node_modules
if not exist "%ROOT_DIR%admin-dashboard\frontend\node_modules" (
    echo [CANH BAO] Chua cai dat thu vien!
    echo Dang cai dat...
    cd /d "%ROOT_DIR%admin-dashboard\frontend"
    call npm install
)

cd /d "%ROOT_DIR%admin-dashboard\frontend"

echo Dang khoi dong frontend...
echo.
echo   URL:        http://localhost:5173
echo   Dang nhap:  http://localhost:5173/login.html
echo.
echo   Nhan Ctrl+C de dung.
echo.

npm run dev

pause
