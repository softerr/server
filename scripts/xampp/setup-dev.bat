@echo off
setlocal enabledelayedexpansion

set "downloadPath=%CD%\dl"
set "toolsPath=%CD%\tools"

set "xamppDownloadPath=%downloadPath%\xampp.zip"
set "xamppPath=%toolsPath%\xampp"
set "xamppVersion=8.2.12"
set "VS=VS16"

set "serverRoot=Test"

if not exist "%downloadPath%" mkdir "%downloadPath%"
if not exist "%toolsPath%" mkdir "%toolsPath%"

if not exist "%xamppDownloadPath%" curl -L -k -o "%xamppDownloadPath%" "https://sourceforge.net/projects/xampp/files/XAMPP%%20Windows/%xamppVersion%/xampp-portable-windows-x64-%xamppVersion%-0-%VS%.zip/download"

if not exist "%xamppPath%" powershell -command "Expand-Archive -Path '%xamppDownloadPath%' -DestinationPath '%xamppPath%' -Force"

powershell -Command "(gc config\httpd.conf) -replace '{xamppPath}', '%xamppPath:\=/%' | Out-File -encoding ASCII %xamppPath%\apache\conf\httpd.conf"
powershell -Command "(gc config\httpd-ssl.conf) -replace '{xamppPath}', '%xamppPath:\=/%' | Out-File -encoding ASCII %xamppPath%\apache\conf\extra\httpd-ssl.conf"
powershell -Command "(gc config\httpd-xampp.conf) -replace '{xamppPath}', '%xamppPath:\=/%' -replace '{xamppPathB}', '%xamppPath:\=\\%' | Out-File -encoding ASCII %xamppPath%\apache\conf\extra\httpd-xampp.conf"

powershell -Command "(gc config\my.ini) -replace '{xamppPath}', '%xamppPath:\=/%' | Out-File -encoding ASCII %xamppPath%\mysql\bin\my.ini"
powershell -Command "(gc config\php.ini) -replace '{xamppPath}', '%xamppPath%' | Out-File -encoding ASCII %xamppPath%\php\php.ini"
