@echo off
setlocal enabledelayedexpansion

set "toolsPath=%CD%\tools"

set "xamppPath=%toolsPath%\xampp"

start %xamppPath%\apache_start.bat
start %xamppPath%\mysql_start.bat
