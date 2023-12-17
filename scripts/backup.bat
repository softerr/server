@echo off
setlocal enabledelayedexpansion

for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "fullstamp=%dt:~0,4%%dt:~4,2%%dt:~6,2%%dt:~8,2%%dt:~10,2%%dt:~12,2%"

set backupPath={backupPath}\%fullstamp%
set backupPathZip=%backupPath%.zip

set mysqlBackupFileProd=%backupPath%\db.sql
set mysqlBackupFileDev=%backupPath%\db-dev.sql

if not exist %backupPath% mkdir %backupPath%

if exist "{mysqlDataPathProd}" (
	"{mysqldump}" --defaults-extra-file={mysqlBackupConfFileProd} --no-create-info --no-create-db --skip-triggers --skip-tz-utc --compact --databases user quiz > %mysqlBackupFileProd%
)

if exist "{mysqlDataPathDev}" (
	"{mysqldump}" --defaults-extra-file={mysqlBackupConfFileDev} --no-create-info --no-create-db --skip-triggers --skip-tz-utc --compact --databases user quiz > %mysqlBackupFileDev%
)

powershell Compress-Archive -Path "%backupPath%\*" -DestinationPath "%backupPathZip%"

echo %backupPathZip%
