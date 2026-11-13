@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 (
    echo Python 3.11 or newer is required. Install Python and try again.
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" -c "import flask, waitress" >nul 2>&1
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Dependency installation failed. Check your network and retry.
    pause
    exit /b 1
  )
)
echo Open http://localhost:8765 after the server starts.
echo Keep this window open. Press Ctrl+C to stop the server.
".venv\Scripts\python.exe" server.py
if errorlevel 1 echo Server stopped. If port 8765 is occupied, close the previous instance.
pause
