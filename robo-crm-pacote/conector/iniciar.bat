@echo off
rem Abre o conector e o reabre sozinho quando uma atualizacao pede.
rem
rem Substitui o FitMindConector.exe, que ficou fora deste pacote por ter a
rem marca FitMind. O combinado com o conector.mjs e um so: codigo de saida 42
rem quer dizer "gravei uma versao nova, me abra de novo". Qualquer outro
rem codigo e parada de verdade e fica na tela para alguem ler.

cd /d "%~dp0"

set "NODE=node"
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"

"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org
  echo ou coloque um node.exe nesta pasta, e abra de novo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Primeira vez: baixando as dependencias. Precisa de internet.
  call npm ci --omit=dev
  if errorlevel 1 (
    echo Nao consegui baixar as dependencias.
    pause
    exit /b 1
  )
)

:abrir
"%NODE%" conector.mjs
if "%errorlevel%"=="42" goto abrir

echo.
echo O conector parou (codigo %errorlevel%).
pause
