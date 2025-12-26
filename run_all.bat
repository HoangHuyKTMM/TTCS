@echo off
chcp 65001 >nul
TITLE Reader App - Khoi Dong Tat Ca

echo.
echo ==========================================
echo   KHOI DONG DU AN TTCS (READER APP)
echo ==========================================
echo.

:: Luu duong dan goc
set "ROOT_DIR=%~dp0"

:: Kiem tra Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [LOI] Khong tim thay Node.js!
    echo Vui long cai dat Node.js tu: https://nodejs.org/
    pause
    exit /b 1
)

:: Kiem tra da cai dat thu vien chua
echo [KIEM TRA] Dang kiem tra thu vien...
if not exist "%ROOT_DIR%node_modules" (
    echo [CANH BAO] Chua cai dat thu vien Mobile App!
    echo Dang chay npm install...
    cd /d "%ROOT_DIR%"
    call npm install
)

if not exist "%ROOT_DIR%admin-dashboard\server\node_modules" (
    echo [CANH BAO] Chua cai dat thu vien Backend Server!
    echo Dang chay npm install...
    cd /d "%ROOT_DIR%admin-dashboard\server"
    call npm install
)

if not exist "%ROOT_DIR%admin-dashboard\frontend\node_modules" (
    echo [CANH BAO] Chua cai dat thu vien Admin Frontend!
    echo Dang chay npm install...
    cd /d "%ROOT_DIR%admin-dashboard\frontend"
    call npm install
)

:: Giai phong cong 4000 neu dang bi chiem
echo.
echo [0/3] Dang kiem tra va giai phong cong 4000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":4000 "') do (
    if NOT "%%a"=="0" (
        echo      Dang dung tien trinh PID: %%a dang chiem cong 4000...
        taskkill /f /pid %%a >nul 2>&1
    )
)

:: Giai phong cong 5173 neu dang bi chiem
echo [0/3] Dang kiem tra va giai phong cong 5173...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173 "') do (
    if NOT "%%a"=="0" (
        echo      Dang dung tien trinh PID: %%a dang chiem cong 5173...
        taskkill /f /pid %%a >nul 2>&1
    )
)

:: Giai phong cong 8081 (Metro) neu dang bi chiem
echo [0/3] Dang kiem tra va giai phong cong 8081...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8081 "') do (
    if NOT "%%a"=="0" (
        echo      Dang dung tien trinh PID: %%a dang chiem cong 8081...
        taskkill /f /pid %%a >nul 2>&1
    )
)

echo.
echo [1/3] Dang khoi dong Backend Server (http://localhost:4000)...
start "Backend Server - Port 4000" cmd /k "cd /d "%ROOT_DIR%admin-dashboard\server" && node index.js"

:: Cho 3 giay de server khoi dong
timeout /t 3 /nobreak >nul

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
echo   Backend Server:   http://localhost:4000
echo   Admin Frontend:   http://localhost:5173
echo   Mobile App:       Expo DevTools (QR code ben duoi)
echo.
echo ==========================================
echo.
echo   [TIP] Quet QR code bang Expo Go de mo app tren dien thoai
echo   [TIP] Bam 'a' de mo Android Emulator
echo   [TIP] Bam 'w' de mo tren web browser
echo.
echo ==========================================
echo.

:: Mo trang Admin Dashboard tren trinh duyet
start http://localhost:5173

:: Chay Expo
cd /d "%ROOT_DIR%"
call npx expo start

pause
