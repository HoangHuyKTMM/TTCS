@echo off
chcp 65001 >nul
TITLE Mobile App - Expo

echo.
echo ==========================================
echo   KHOI DONG MOBILE APP (EXPO)
echo ==========================================
echo.

set "ROOT_DIR=%~dp0"

:: Kiem tra node_modules
if not exist "%ROOT_DIR%node_modules" (
    echo [CANH BAO] Chua cai dat thu vien!
    echo Dang cai dat...
    cd /d "%ROOT_DIR%"
    call npm install
)

cd /d "%ROOT_DIR%"

echo Dang khoi dong Expo...
echo.
echo   Sau khi Expo khoi dong:
echo   - Nhan 'a' de mo Android Emulator
echo   - Nhan 'w' de mo tren Web
echo   - Quet ma QR bang app Expo Go tren dien thoai
echo.
echo   Nhan Ctrl+C de dung.
echo.

npx expo start

pause
