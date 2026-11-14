@echo off
setlocal
cd /d "%~dp0"
if not defined TASKFLOW_PORT set "TASKFLOW_PORT=8774"
if /i "%~1"=="demo" (
  set "TASKFLOW_PORT=8775"
  set "TASKFLOW_HOST=127.0.0.1"
  set "TASKFLOW_DEMO_ACCESS=1"
  set "TASKFLOW_KITCHEN_DEMO=1"
  set "TASKFLOW_DATA_DIR=%~dp0instance\kitchen-demo"
)
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 (
    echo Python 3.11 or newer is required. Install Python and try again.
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" -c "import flask, waitress, PIL" >nul 2>&1
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Dependency installation failed. Check your network and retry.
    pause
    exit /b 1
  )
)
if /i "%~1"=="demo" (
  echo The demo opens directly in the coordinator view.
)
echo Open http://localhost:%TASKFLOW_PORT% after the server starts.
echo Keep this window open. Press Ctrl+C to stop the server.
".venv\Scripts\python.exe" server.py
if errorlevel 1 echo Server stopped. Check the error shown above.
pause
