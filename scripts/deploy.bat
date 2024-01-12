@echo off
setlocal enabledelayedexpansion

set buildPath=%CD%\build
set serverPath=%CD%\server

set backup=%serverPath%\backup.bat
set restore=%serverPath%\restore.bat

set httpdPath=%serverPath%\httpd
set wwwPath=%httpdPath%\www

echo Deleting old files

if exist "%wwwPath%/api" rmdir /s /q "%wwwPath%/api"
if exist "%wwwPath%/web" rmdir /s /q "%wwwPath%/web"

echo Copying new files

xcopy "%buildPath%\*" "%wwwPath%\" /E /C /I /H /Y

echo Creating backup
backupPath=$("$backup")
for /f "delims=" %%a in ('call %backup%') do (
    set "backupPath=%%a"
)
echo Backup: !backupPath!

echo Restoring backup
call %restore% prod %backupPath%

echo Done
