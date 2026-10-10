@echo off
rem Abre o conector no modo PC (pc.mjs) e o reabre se ele cair.
rem
rem Nao existe mais auto-atualizacao: o codigo de saida 42 do conector antigo
rem nao tem mais sentido. Atualizar e copiar a pasta nova por cima.

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
"%NODE%" pc.mjs
if "%errorlevel%"=="0" goto fim
echo.
echo O conector parou (codigo %errorlevel%). Abrindo de novo em 10 segundos...
timeout /t 10 /nobreak >nul
goto abrir

:fim
echo O conector foi encerrado.
pause
