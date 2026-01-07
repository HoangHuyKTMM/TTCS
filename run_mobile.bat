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

:: Tu dong tao android\local.properties neu thieu (can cho build local bang Android Studio/Gradle)
if not exist "%ROOT_DIR%android\local.properties" (
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        echo [THONG TIN] Khong tim thay android\local.properties. Dang tao tu dong...
        setlocal EnableDelayedExpansion
        set "RAW_SDK=%LOCALAPPDATA%\Android\Sdk"
        set "SDK_DIR=!RAW_SDK:\=\\!"
        set "SDK_DIR=!SDK_DIR::=\:!"
        > "%ROOT_DIR%android\local.properties" echo sdk.dir=!SDK_DIR!
        endlocal
    ) else (
        echo [CANH BAO] Khong tim thay android\local.properties va cung khong tim thay Android SDK tai:
        echo          %LOCALAPPDATA%\Android\Sdk
        echo          Hay mo Android Studio ^> SDK Manager de cai Android SDK,
        echo          hoac tao file android\local.properties voi dong:
        echo          sdk.dir=C\:\\Users\\YOUR_USERNAME\\AppData\\Local\\Android\\Sdk
        echo.
    )
)

echo Dang chay tren Android Studio Emulator (Development Build)...
echo.
echo   Cach dung:
echo   1) Mo Android Studio ^> Device Manager ^> Start Emulator
echo   2) Script se build + cai app len emulator va tu khoi dong Metro.
echo.
echo   [TIP] Lan sau neu khong doi native libs/config, ban co the chay nhanh bang: npm start
echo.
echo   Nhan Ctrl+C de dung.
echo.

npx expo run:android

pause
