@echo off
setlocal enabledelayedexpansion

echo =========================================================================
echo Starting Intelligent Traffic Decision Support System (IT-DSS) Platform
echo =========================================================================

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "VENV_DIR=%ROOT_DIR%\.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "VENV_ACT=%VENV_DIR%\Scripts\activate.bat"

echo [1/4] Verifying Python virtual environment...
if not exist "%VENV_PY%" (
    echo [Setup] Creating virtual environment in .venv ...
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [ERROR] Could not create the Python virtual environment. Install Python 3.11+ and retry.
        pause
        exit /b 1
    )
)

"%VENV_PY%" -c "import fastapi, sqlmodel, uvicorn, traci, sumolib" >nul 2>&1
if errorlevel 1 (
    echo [Setup] Installing backend dependencies ^(one-time initialization^)...
    "%VENV_PY%" -m pip install --disable-pip-version-check -r "%ROOT_DIR%\backend\requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Backend dependency installation failed.
        pause
        exit /b 1
    )
)

echo [2/4] Verifying frontend dependencies...
if not exist "%ROOT_DIR%\frontend\node_modules\vite\bin\vite.js" (
    echo [Setup] Installing frontend dependencies ^(one-time initialization^)...
    pushd "%ROOT_DIR%\frontend"
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Please check your Node.js / npm installation.
        popd
        pause
        exit /b 1
    )
    popd
)

echo [3/4] Checking and clearing dedicated ports (8765, 5199)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8765 ^| findstr LISTENING 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5199 ^| findstr LISTENING 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo [4/4] Launching IT-DSS Services...
start "IT-DSS Backend" cmd /k "cd /d "%ROOT_DIR%" && call "%VENV_ACT%" && set PYTHONPATH=%ROOT_DIR% && uvicorn backend.app.main:app --host 0.0.0.0 --port 8765 --reload"

start "IT-DSS Frontend" cmd /k "cd /d "%ROOT_DIR%\frontend" && call npm run dev"

echo.
echo =========================================================================
echo DSS Platform successfully initiated on dedicated ports!
echo Backend API Docs:       http://localhost:8765/docs
echo Frontend Command Center: http://localhost:5199
echo =========================================================================

