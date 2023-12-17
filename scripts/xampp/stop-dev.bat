rem @echo off
setlocal enabledelayedexpansion

set "toolsPath=%CD%\tools"

set "xamppPath=%toolsPath%\xampp"

start %xamppPath%\apache_stop.bat
start %xamppPath%\mysql_stop.bat
