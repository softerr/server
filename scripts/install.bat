@echo off
setlocal enabledelayedexpansion

if "%~8"=="" (
	goto usage
)

if not "%~9"=="" (
	goto usage
)

set config=%1

if "!config!" neq "prod" if "!config!" neq "dev" (
	goto usage
)

goto continue

:usage
echo Usage: %0 {prod^|dev} ^<email^> ^<pass^> ^<root_pass^> ^<admin_pass^> ^<backup_pass^> ^<restore_pass^> ^<php_pass^>
exit /b 1

:continue

set mysqlAdminHost=localhost
set mysqlAdminUser=admin
set mysqlBackupHost=localhost
set mysqlBackupUser=backup
set mysqlRestoreHost=localhost
set mysqlRestoreUser=restore
set mysqlPhpHost=localhost
set mysqlPhpUser=php

set httpdVersion=2.4.58
set httpdVSVersion=VS17
set phpVersion=8.3.0
set phpVSVersion=vs16
set mysqlMajorVersion=8.2
set mysqlMinorVersion=8.2.0
set phpmyadminVersion=5.2.1
set smtpVersion=1.3.0

set configPath=%CD%\config
set downloadPath=%CD%\dl
set serverPath=%CD%\server
set scriptsPath=%CD%\scripts
set srcPath=%CD%\src
set buildPath=%CD%\build
set webPath=%srcPath%\web

set dbCreateFile=%configPath%\db.sql
set dbInitFile=%configPath%\init.sql
set dbDataFileProd=db.sql
set dbDataFileDev=db-dev.sql
set tmplHttpdConfFile=%configPath%\win\httpd.conf
set tmplSitesConfFileProd=%configPath%\win\sites.conf
set tmplSitesConfFileDev=%configPath%\win\sites-dev.conf
set tmplMysqlConfFile=%configPath%\win\my.ini
set tmplMysqlClientConfFile=%configPath%\client.ini
set tmplPhpConfFile=%configPath%\win\php-dev.ini
set tmplConfigPhpFile=%configPath%\config.php
set tmplPhpmyadminConfFile=%configPath%\win\config.inc.php
set tmplSmtpConfFile=%configPath%\win\sendmail.ini
set tmplBackup=%scriptsPath%\backup.bat
set tmplRestore=%scriptsPath%\restore.bat

rem https://www.apachelounge.com/download/
set httpdUrl=https://www.apachelounge.com/download/%httpdVSVersion%/binaries/httpd-%httpdVersion%-win64-%httpdVSVersion%.zip
set httpdZip=%downloadPath%\httpd-%httpdVersion%.zip
set httpdExt=%downloadPath%\httpd-%httpdVersion%
set httpdPath=%serverPath%\httpd
set httpdPortProd=80
set httpdPortDev=8080
set httpdConfFileProd=conf\httpd.conf
set httpdConfFileDev=conf\httpd-dev.conf
set httpdPidFileProd=logs\httpd.pid
set httpdPidFileDev=logs\httpd-dev.pid
set httpdLogPath=logs
set sitesConfFileProd=conf\sites.conf
set sitesConfFileDev=conf\sites-dev.conf
set wwwPathProd=%httpdPath%\www
set wwwPathDev=%httpdPath%\www-dev

rem https://windows.php.net/download
set phpUrl=https://windows.php.net/downloads/releases/php-%phpVersion%-Win32-%phpVSVersion%-x64.zip
set phpZip=%downloadPath%\php-%phpVersion%.zip
set phpExt=%downloadPath%\php-%phpVersion%
set phpPath=%serverPath%\php
set phpConfFile=%phpPath%\php.ini

rem https://dev.mysql.com/downloads/mysql/
set mysqlUrl=https://dev.mysql.com/get/Downloads/MySQL-%mysqlMajorVersion%/mysql-%mysqlMinorVersion%-winx64.zip
set mysqlZip=%downloadPath%\mysql-%mysqlMinorVersion%.zip
set mysqlExt=%downloadPath%\mysql-%mysqlMinorVersion%
set mysqlPath=%serverPath%\mysql
set mysqlPortProd=3306
set mysqlPortDev=3307
set mysqlConfFileProd=%mysqlPath%\bin\my.ini
set mysqlConfFileDev=%mysqlPath%\bin\my-dev.ini
set mysqlBackupConfFileProd=%mysqlPath%\bin\backup.ini
set mysqlBackupConfFileDev=%mysqlPath%\bin\backup-dev.ini
set mysqlRestoreConfFileProd=%mysqlPath%\bin\restore.ini
set mysqlRestoreConfFileDev=%mysqlPath%\bin\restore-dev.ini
set mysqlDataPathProd=%mysqlPath%\data
set mysqlDataPathDev=%mysqlPath%\data-dev
set mysqlLogsPath=%mysqlPath%\logs
set mysqlLogErrorFileProd=%mysqlLogsPath%\mysql_error.log
set mysqlLogErrorFileDev=%mysqlLogsPath%\mysql_error-dev.log
set mysqlTmpPathProd=%mysqlPath%\tmp
set mysqlTmpPathDev=%mysqlPath%\tmp-dev
set mysqlSocketFileProd=%mysqlPath%\mysql.sock
set mysqlSocketFileDev=%mysqlPath%\mysql-dev.sock
set mysql=%mysqlPath%\bin\mysql
set mysqldump=%mysqlPath%\bin\mysqldump

rem https://www.phpmyadmin.net/downloads/
set phpmyadminUrl=https://files.phpmyadmin.net/phpMyAdmin/%phpmyadminVersion%/phpMyAdmin-%phpmyadminVersion%-english.zip
set phpmyadminZip=%downloadPath%\phpmyadmin-%phpmyadminVersion%.zip
set phpmyadminExt=%downloadPath%\phpmyadmin-%phpmyadminVersion%
set phpmyadminConfFile=%phpmyadminPath%\config.inc.php

set smtpUrl=https://www.glob.com.au/sendmail/sendmail.zip
set smtpZip=%downloadPath%\sendmail-%smtpVersion%.zip
set smtpExt=%downloadPath%\sendmail-%smtpVersion%
set smtpPath=%serverPath%\sendmail
set smtpConfFile=%smtpPath%\sendmail.ini

set backup=%serverPath%\backup.bat
set restore=%serverPath%\restore.bat
set startProd=%serverPath%\start.bat
set stopProd=%serverPath%\stop.bat
set startDev=%serverPath%\start-dev.bat
set stopDev=%serverPath%\stop-dev.bat

if "%config%" == "prod" (
	set backupDataFile=%backupDataFileProd%
	set dbDataFile=%dbDataFileProd%

	set httpdExe=httpd
	set httpdPort=%httpdPortProd%
	set httpdConfFile=%httpdConfFileProd%
	set httpdPidFile=%httpdPidFileProd%
	set tmplSitesConfFile=%tmplSitesConfFileProd%
	set sitesConfFile=%sitesConfFileProd%
	set wwwPath=%wwwPathProd%

	set mysqldExe=mysqld
	set mysqlPort=%mysqlPortProd%
	set mysqlConfFile=%mysqlConfFileProd%
	set mysqlBackupConfFile=%mysqlBackupConfFileProd%
	set mysqlRestoreConfFile=%mysqlRestoreConfFileProd%
	set mysqlDataPath=%mysqlDataPathProd%
	set mysqlLogErrorFile=%mysqlLogErrorFileProd%
	set mysqlTmpPath=%mysqlTmpPathProd%
	set mysqlSocketFile=%mysqlSocketFileProd%

	set start=%startProd%
	set stop=%stopProd%
) else (
	set backupDataFile=%backupDataFileDev%
	set dbDataFile=%dbDataFileDev%

	set httpdExe=httpd-dev
	set httpdPort=%httpdPortDev%
	set httpdConfFile=%httpdConfFileDev%
	set httpdPidFile=%httpdPidFileDev%
	set tmplSitesConfFile=%tmplSitesConfFileDev%
	set sitesConfFile=%sitesConfFileDev%
	set wwwPath=%wwwPathDev%

	set mysqldExe=mysqld-dev
	set mysqlPort=%mysqlPortDev%
	set mysqlConfFile=%mysqlConfFileDev%
	set mysqlBackupConfFile=%mysqlBackupConfFileDev%
	set mysqlRestoreConfFile=%mysqlRestoreConfFileDev%
	set mysqlDataPath=%mysqlDataPathDev%
	set mysqlLogErrorFile=%mysqlLogErrorFileDev%
	set mysqlTmpPath=%mysqlTmpPathDev%
	set mysqlSocketFile=%mysqlSocketFileDev%

	set start=%startDev%
	set stop=%stopDev%
)

set configPhpFile=%wwwPath%\config\config.php

set httpd=%httpdPath%\bin\%httpdExe%
set php=%phpPath%\php
set mysqld=%mysqlPath%\bin\%mysqldExe%

echo.
echo ---------------------APACHE----------------------
"%httpd%" -v
echo.
echo -----------------------PHP-----------------------
"%php%" -v
echo.
echo ----------------------MYSQL----------------------
"%mysqld%" -V
echo .
echo -------------------------------------------------

rem backup
if exist "%mysqlDataPath%" (
	echo Creating backup
	for /f "delims=" %%a in ('call %backup%') do (
		set "backupPath=%%a"
	)
	echo Backup: !backupPath!
	call %stop%
)

if not exist "%downloadPath%" mkdir "%downloadPath%"
if not exist "%serverPath%" mkdir "%serverPath%"

rem download
echo Downloading
if not exist "%httpdZip%" curl -L -k -o "%httpdZip%" "%httpdUrl%"
if not exist "%phpZip%" curl -L -k -o "%phpZip%" "%phpUrl%"
if not exist "%mysqlZip%" curl -L -k -o "%mysqlZip%" "%mysqlUrl%"
if not exist "%phpmyadminZip%" curl -L -k -o "%phpmyadminZip%" "%phpmyadminUrl%"
if not exist "%smtpZip%" curl -L -k -o "%smtpZip%" "%smtpUrl%"

rem extract
echo Extracting
if not exist "%httpdExt%" powershell -command "Expand-Archive -Path '%httpdZip%' -DestinationPath '%httpdExt%' -Force"
if not exist "%phpExt%" powershell -command "Expand-Archive -Path '%phpZip%' -DestinationPath '%phpExt%' -Force"
if not exist "%mysqlExt%" powershell -command "Expand-Archive -Path '%mysqlZip%' -DestinationPath '%mysqlExt%' -Force"
if not exist "%phpmyadminExt%" powershell -command "Expand-Archive -Path '%phpmyadminZip%' -DestinationPath '%phpmyadminExt%' -Force"
if not exist "%smtpExt%" powershell -command "Expand-Archive -Path '%smtpZip%' -DestinationPath '%smtpExt%' -Force"

echo Generating server files
rem copy
if not exist "%httpdPath%" xcopy "%httpdExt%\Apache24" "%httpdPath%" /E /I /Q /Y
if not exist "%phpPath%" xcopy "%phpExt%" "%phpPath%" /E /I /Q /Y
if not exist "%mysqlPath%" xcopy "%mysqlExt%\mysql-%mysqlMinorVersion%-winx64" "%mysqlPath%" /E /I /Q /Y
if not exist "%smtpPath%" xcopy "%smtpExt%" "%smtpPath%" /E /I /Q /Y

if not exist "%httpd%.exe" copy "%httpdPath%\bin\httpd.exe" "%httpd%.exe"
if not exist "%mysqld%.exe" copy "%mysqlPath%\bin\mysqld.exe" "%mysqld%.exe"

rem config
echo Configuring HTTP server
powershell -command (gc %tmplHttpdConfFile%)^
-replace '{serverPath}', '%serverPath:\=/%'^
-replace '{serverPort}', '%httpdPort:\=/%'^
-replace '{serverWww}', '%wwwPath:\=/%'^
-replace '{pidFile}', '%httpdPidFile:\=/%'^
-replace '{logPath}', '%httpdLogPath:\=/%'^
-replace '{sitesConfFile}', '%sitesConfFile:\=/%'^
| Out-File -encoding ASCII %httpdPath%\%httpdConfFile%

copy "%tmplSitesConfFile%" "%httpdPath%"\%sitesConfFile%

powershell -command (gc %tmplPhpConfFile%)^
-replace '{serverPath}', '%serverPath%'^
-replace '{sendmailExeFile}', '%smtpPath:\=/%/sendmail.exe'^
| Out-File -encoding ASCII %phpConfFile%

powershell -command (gc %tmplMysqlConfFile%)^
-replace '{serverPath}', '%serverPath:\=/%'^
-replace '{port}', '%mysqlPort%'^
-replace '{dataPath}', '%mysqlDataPath:\=/%'^
-replace '{logErrorFile}', '%mysqlLogErrorFile:\=/%'^
-replace '{tmpPath}', '%mysqlTmpPath:\=/%'^
-replace '{socketFile}', '%mysqlSocketFile:\=/%'^
| Out-File -encoding ASCII %mysqlConfFile%

powershell -command (gc %tmplMysqlClientConfFile%)^
-replace '{user}', '%mysqlBackupUser%'^
-replace '{pass}', '%6'^
-replace '{port}', '%mysqlPort%'^
| Out-File -encoding ASCII %mysqlBackupConfFile%

powershell -command (gc %tmplMysqlClientConfFile%)^
-replace '{user}', '%mysqlRestoreUser%'^
-replace '{pass}', '%7'^
-replace '{port}', '%mysqlPort%'^
| Out-File -encoding ASCII %mysqlRestoreConfFile%

echo Configuring Mail server
powershell -command (gc %tmplSmtpConfFile%)^
-replace '{email}', '%2'^
-replace '{pass}', '%3'^
| Out-File -encoding ASCII %smtpConfFile%

rem www
echo Generating www
if exist "%wwwPath%" rmdir /s /q "%wwwPath%"
xcopy "%buildPath%" "%wwwPath%" /E /I /Q /Y
xcopy "src\phpinfo" "%wwwPath%\phpinfo" /E /I /Q /Y

echo "Configuring API"
mkdir "%wwwPath%\config"
powershell -command (gc %tmplConfigPhpFile%)^
-replace '{mysqlPhpHost}', '%mysqlPhpHost%'^
-replace '{mysqlPhpUser}', '%mysqlPhpUser%'^
-replace '{mysqlPhpPass}', '%8'^
-replace '{mysqlPhpPort}', '%mysqlPort%'^
| Out-File -encoding ASCII %configPhpFile%

if "%config%" == "dev" (
	echo Preparing npm project
	setlocal
		cd %webPath%
		call npm install
	endlocal

	set phpmyadminPath=%wwwPath%\phpmyadmin
	xcopy "%phpmyadminExt%\phpMyAdmin-%phpmyadminVersion%-english" "!phpmyadminPath!" /E /I /Q /Y
	powershell -command "(gc %tmplPhpmyadminConfFile%) -replace '{port}', '%mysqlPort%' | Out-File -encoding ASCII %phpmyadminConfFile%"
)

rem scripts
set "httpdFlags=-f %httpdConfFile:\=/%"
set "mysqldFlags=--defaults-file=%mysqlConfFile:\=/%"
(
	echo @echo off
	echo setlocal enabledelayedexpansion
	echo.
	echo echo Starting HTTP server
	echo start %httpd% %httpdFlags%
	echo echo Starting MySQL server
	echo start %mysqld% %mysqldFlags%
	echo echo Starting npm server
	if "%config%" == "dev" (
		echo setlocal
		echo 	cd %webPath%
		echo 	start npm run start
		echo endlocal
	)
	echo echo Started successfully
) > %start%

(
	echo @echo off
	echo setlocal enabledelayedexpansion
	echo.
	echo echo Stoppping HTTP server
	echo taskkill /F /IM "%httpdExe%.exe"
	echo echo Stopping MySQL server
	echo taskkill /F /IM "%mysqldExe%.exe"
	echo echo Stopped successfully
) > %stop%

powershell -command (gc %tmplBackup%)^
-replace '{backupPath}', '%CD%\backup'^
-replace '{mysqlDataPathProd}', '%mysqlDataPathProd%'^
-replace '{mysqlDataPathDev}', '%mysqlDataPathDev%'^
-replace '{mysqlBackupConfFileProd}', '%mysqlBackupConfFileProd%'^
-replace '{mysqlBackupConfFileDev}', '%mysqlBackupConfFileDev%'^
-replace '{mysqldump}', '%mysqldump%'^
| Out-File -encoding ASCII %backup%

powershell -command (gc %tmplRestore%)^
-replace '{mysqlRestoreConfFileProd}', '%mysqlRestoreConfFileProd%'^
-replace '{mysqlRestoreConfFileDev}', '%mysqlRestoreConfFileDev%'^
-replace '{dbCreateFile}', '%dbCreateFile:\=/%'^
-replace '{mysql}', '%mysql%'^
| Out-File -encoding ASCII %restore%

rem database
echo Initializing database
if exist "%mysqlDataPath%" rmdir /s /q "%mysqlDataPath%"
if not exist "%mysqlLogsPath%" mkdir "%mysqlLogsPath%"
if not exist "%mysqlTmpPath%" mkdir "%mysqlTmpPath%"
"%mysqld%" %mysqldFlags% --initialize-insecure

call %start%

if not exist "%backupPath%" (
	echo Creating db
	"%mysql%" -u root -P %mysqlPort% -e "source "%dbCreateFile:\=/%";source "%dbInitFile:\=/%";"
)

set mysqlAdminLogin=%mysqlAdminUser%'@'%mysqlAdminHost%
set mysqlBackupLogin=%mysqlBackupUser%'@'%mysqlBackupHost%
set mysqlRestoreLogin=%mysqlRestoreUser%'@'%mysqlRestoreHost%
set mysqlPhpLogin=%mysqlPhpUser%'@'%mysqlPhpHost%

set sql=^
ALTER USER 'root'@'localhost' IDENTIFIED BY '%4';^
CREATE USER '%mysqlAdminLogin%' IDENTIFIED BY '%5';^
CREATE USER '%mysqlBackupLogin%' IDENTIFIED BY '%6';^
CREATE USER '%mysqlRestoreLogin%' IDENTIFIED BY '%7';^
CREATE USER '%mysqlPhpLogin%' IDENTIFIED BY '%8';^
GRANT PROCESS ON *.* TO '%mysqlAdminLogin%';^
GRANT SELECT, UPDATE, INSERT, DELETE, LOCK TABLES ON user.* TO '%mysqlAdminLogin%';^
GRANT SELECT, UPDATE, INSERT, DELETE, LOCK TABLES ON quiz.* TO '%mysqlAdminLogin%';^
GRANT PROCESS ON *.* TO '%mysqlBackupLogin%';^
GRANT SELECT, LOCK TABLES ON user.* TO '%mysqlBackupLogin%';^
GRANT SELECT, LOCK TABLES ON quiz.* TO '%mysqlBackupLogin%';^
GRANT CREATE ON *.* TO '%mysqlRestoreLogin%';^
GRANT SELECT, UPDATE, INSERT, DELETE, TRIGGER, REFERENCES, DROP ON user.* TO '%mysqlRestoreLogin%';^
GRANT SELECT, UPDATE, INSERT, DELETE, TRIGGER, REFERENCES, DROP ON quiz.* TO '%mysqlRestoreLogin%';^
GRANT SELECT, UPDATE, INSERT, DELETE ON user.* TO '%mysqlPhpLogin%';^
GRANT SELECT, UPDATE, INSERT, DELETE ON quiz.* TO '%mysqlPhpLogin%';

echo Creating MySQL users
"%mysql%" -u root -P %mysqlPort% -e "%sql%"

if exist "%backupPath%" (
	call %restore% %config% %backupPath%
)

echo Installed successfully
