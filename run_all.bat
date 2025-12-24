@echo off
chcp 65001 >nul
TITLE Reader App - Khoi Dong Tat Ca

echo.
echo ==========================================
echo   KHOI DONG DU AN TTCS (READER APP)
echo ==========================================
echo.

:: Kiem tra Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [LOI] Khong tim thay Node.js!
    echo Vui long cai dat Node.js tu: https://nodejs.org/
    pause
    exit /b 1
)

:: Luu duong dan goc
set "ROOT_DIR=%~dp0"

:: Kiem tra da cai dat thu vien chua
if not exist "%ROOT_DIR%admin-dashboard\server\node_modules" (
    echo [CANH BAO] Chua cai dat thu vien cho Backend Server!
    echo Dang chay install_all.bat truoc...
    call "%ROOT_DIR%install_all.bat"
)

echo.
echo [1/3] Dang khoi dong Backend Server (http://localhost:4000)...
start "Backend Server - Port 4000" cmd /k "cd /d "%ROOT_DIR%admin-dashboard\server" && node index.js"

:: Cho 2 giay de server khoi dong
timeout /t 2 /nobreak >nul

echo [2/3] Dang khoi dong Admin Frontend (http://localhost:5173)...
start "Admin Frontend - Port 5173" cmd /k "cd /d "%ROOT_DIR%admin-dashboard\frontend" && npm run dev"

:: Cho 2 giay
timeout /t 2 /nobreak >nul

echo [3/3] Dang khoi dong Mobile App (Expo)...
echo.
echo ==========================================
echo   TAT CA DICH VU DA DUOC KHOI DONG!
echo ==========================================
echo.
echo   - Backend Server:  http://localhost:4000
echo   - Admin Frontend:  http://localhost:5173
echo   - Mobile App:      Dang mo Expo...
echo.
echo   Dang nhap Admin: http://localhost:5173/login.html
echo.
echo ==========================================
echo.

cd /d "%ROOT_DIR%"
call npx expo start

pause
