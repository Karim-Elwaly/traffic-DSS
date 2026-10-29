@echo off
echo =========================================================================
echo Starting Intelligent Traffic Decision Support System (IT-DSS) Platform
echo =========================================================================

echo [1/2] Launching FastAPI Backend on http://localhost:8765 ...
start "IT-DSS Backend" cmd /k "cd /d %~dp0backend && uvicorn backend.app.main:app --host 0.0.0.0 --port 8765 --reload"

echo [2/2] Launching React Vite Command Center on http://localhost:5199 ...
start "IT-DSS Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo =========================================================================
echo DSS Platform successfully initiated on non-conflicting dedicated ports!
echo Backend API Docs: http://localhost:8765/docs
echo Frontend Command Center: http://localhost:5199
echo =========================================================================
