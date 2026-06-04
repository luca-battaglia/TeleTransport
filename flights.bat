@echo off
set "DIR=%~dp0"
set PYTHONPATH=%DIR%
"%DIR%.venv\Scripts\python.exe" "%DIR%cli\flights_cli.py" %*
