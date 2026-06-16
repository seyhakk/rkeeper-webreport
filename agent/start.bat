@echo off
title R-Keeper Report Agent
cd /d "%~dp0"

REM Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js is not installed.
  echo Please install Node.js from https://nodejs.org (LTS version)
  pause
  exit /b 1
)

REM First run: install dependencies
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --production
  if %errorlevel% neq 0 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

REM Check if config.json exists
if not exist "config.json" (
  echo Config not found. Running setup wizard...
  node agent.js --setup
  if %errorlevel% neq 0 exit /b 1
)

REM Run the agent
node agent.js %*
pause
