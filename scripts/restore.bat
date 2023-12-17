@echo off
setlocal enabledelayedexpansion

if "%~2"=="" (
	echo Usage: %0 {prod^|dev} ^<backup_path^>
	exit /b 1
)

set config=%1
set backupPath=%2

if "!config!" neq "prod" if "!config!" neq "dev" (
	echo Usage: %0 {prod^|dev} ^<backup_path^>
	exit /b 1
)

set dbDataFileProd=db.sql
set dbDataFileDev=db-dev.sql

if "%config%" == "prod" (
	set dbDataFile=%dbDataFileProd%
	set mysqlRestoreConfFile={mysqlRestoreConfFileProd}
) else (
	set dbDataFile=%dbDataFileDev%
	set mysqlRestoreConfFile={mysqlRestoreConfFileDev}
)

echo Restoring db
set backupExtPath=%CD%\backup\restore
set dbDataPath=%backupExtPath%\%dbDataFile%
powershell Expand-Archive -Path "%backupPath%" -DestinationPath "%backupExtPath%" -Force
"{mysql}" --defaults-extra-file=%mysqlRestoreConfFile% -e "source "{dbCreateFile}";SET foreign_key_checks = 0;SET @TRIGGER_CHECKS = FALSE;source "%dbDataPath:\=/%";SET @TRIGGER_CHECKS = TRUE;SET foreign_key_checks = 0;"

echo Restored successfully
