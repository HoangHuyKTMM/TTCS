@echo off
chcp 65001 >nul
TITLE Reader App - Cai Dat Thu Vien

echo.
echo ==========================================
echo   CAI DAT THU VIEN CHO DU AN TTCS
echo ==========================================
echo.

:: Kiem tra Node.js da duoc cai dat chua
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [LOI] Khong tim thay Node.js!
    echo Vui long cai dat Node.js tu: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Da tim thay Node.js: 
node --version
echo.

:: Luu duong dan goc
set "ROOT_DIR=%~dp0"

:: 1. Cai dat Backend Server
echo ==========================================
echo [1/3] Dang cai dat Backend Server...
echo ==========================================
cd /d "%ROOT_DIR%admin-dashboard\server"
if not exist "package.json" (
    echo [LOI] Khong tim thay package.json trong admin-dashboard\server
    pause
    exit /b 1
)
call npm install
if %ERRORLEVEL% neq 0 (
    echo [LOI] Cai dat Backend Server that bai!
    pause
    exit /b 1
)
echo [OK] Backend Server - Cai dat thanh cong!
echo.

:: 2. Cai dat Admin Frontend
echo ==========================================
echo [2/3] Dang cai dat Admin Frontend...
echo ==========================================
cd /d "%ROOT_DIR%admin-dashboard\frontend"
if not exist "package.json" (
    echo [LOI] Khong tim thay package.json trong admin-dashboard\frontend
    pause
    exit /b 1
)
call npm install
if %ERRORLEVEL% neq 0 (
    echo [LOI] Cai dat Admin Frontend that bai!
    pause
    exit /b 1
)
echo [OK] Admin Frontend - Cai dat thanh cong!
echo.

:: 3. Cai dat Mobile App (Expo) - Su dung legacy-peer-deps de tranh xung dot phien ban
echo ==========================================
echo [3/3] Dang cai dat Mobile App (Expo)...
echo ==========================================
cd /d "%ROOT_DIR%"
if not exist "package.json" (
    echo [LOI] Khong tim thay package.json trong thu muc goc
    pause
    exit /b 1
)
call npm install --legacy-peer-deps
if %ERRORLEVEL% neq 0 (
    echo [LOI] Cai dat Mobile App that bai!
    pause
    exit /b 1
)
echo [OK] Mobile App - Cai dat thanh cong!
echo.

echo ==========================================
echo   DA CAI DAT XONG TAT CA THU VIEN!
echo ==========================================
echo.
echo Buoc tiep theo:
echo   1. Chay file "run_all.bat" de khoi dong ung dung
echo   2. Hoac chay tung phan rieng le:
echo      - run_server.bat   : Chi chay Backend
echo      - run_frontend.bat : Chi chay Admin Web
echo      - run_mobile.bat   : Chi chay Mobile App
echo.
pause
