@echo off
setlocal enabledelayedexpansion

set buildPath=%CD%\build
set srcPath=%CD%\src

set webPath=%srcPath%\web

if exist "%buildPath%" rmdir /s /q "%buildPath%"
mkdir "%buildPath%"

xcopy "%srcPath%\api" "%buildPath%\api" /E /I /Q /Y

echo Building npm project
setlocal
        cd %webPath%
        call npm ci
        call npm run build
endlocal
xcopy "%webPath%\build" "%buildPath%\web" /E /I /Q /Y

echo "Built successfully"
