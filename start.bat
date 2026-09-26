@echo off
title CineLocal - Servidor Offline
cd /d "%~dp0"

:: Porta alternativa para nao conflitar com a 3000
set PORT=3050
set /a CAST_MEDIA_PORT=%PORT%+1
set "HTTPS=true"
set "HTTPS_CERT_DIR=%~dp0certs"
set "HTTPS_PFX_PASSPHRASE=CineLocal-HTTPS-Local"
:: Cache HLS no mesmo disco da instalação, evitando ocupar a unidade C:
:: Para usar outro disco, troque por exemplo por: set "HLS_CACHE_DIR=D:\CineLocalCache\hls"
set "HLS_CACHE_DIR=%~dp0.cache\hls"
set "HLS_CACHE_MAX_MB=4096"

echo ======================================================
echo    CineLocal - Servidor Offline (Porta %PORT%)
echo ======================================================
echo.
echo Preparando certificado HTTPS local...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-https-cert.ps1" -OutputDirectory "%HTTPS_CERT_DIR%"
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Nao foi possivel criar o certificado HTTPS local.
    echo Verifique se o Windows PowerShell esta disponivel e tente novamente.
    pause
    exit /b 1
)
:: Obtem o endereco IP local da rede para acesso no celular
set "LOCAL_IP="
for /f "usebackq tokens=*" %%i in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "(Get-NetIPAddress -AddressFamily IPv4 -Type Unicast | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -First 1)"`) do set "LOCAL_IP=%%i"

echo Iniciando servidor em https://localhost:%PORT% ...
echo Porta HTTP auxiliar para o Chromecast: %CAST_MEDIA_PORT%
if defined LOCAL_IP (
    echo Endereco HTTPS para acessar no celular: https://%LOCAL_IP%:%PORT%
) else (
    echo Endereco HTTPS para acessar no celular: https://[IP_DO_SEU_PC]:%PORT%
)
echo Certificado para instalar no celular: %HTTPS_CERT_DIR%\cinelocal.crt
echo (Pressione Ctrl+C para encerrar)
echo.

:: Se houver pasta bin ou ffmpeg com os executaveis, adiciona ao PATH
if exist "%~dp0bin" set "PATH=%~dp0bin;%PATH%"
if exist "%~dp0ffmpeg\bin" set "PATH=%~dp0ffmpeg\bin;%PATH%"
if exist "%~dp0ffmpeg" set "PATH=%~dp0ffmpeg;%PATH%"

:: Verifica o runtime e as dependencias JavaScript antes de iniciar
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Node.js nao foi encontrado.
    echo Execute "instalar dependências.bat" ou coloque node.exe na pasta bin.
    pause
    exit /b 1
)
where npm.cmd >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] npm nao foi encontrado.
    echo Instale o Node.js LTS ou use uma distribuicao portatil completa.
    pause
    exit /b 1
)
if not exist "%~dp0node_modules\tsx" (
    echo [ERRO] Dependencias do CineLocal nao foram instaladas.
    echo Execute primeiro "instalar dependências.bat".
    pause
    exit /b 1
)
if not exist "%~dp0node_modules\vite-plugin-pwa" (
    echo [AVISO] O modulo vite-plugin-pwa ainda nao esta instalado na pasta node_modules.
    echo Tentando atualizar dependencias automaticamente...
    call npm.cmd install vite-plugin-pwa --save
    if errorlevel 1 (
        echo [AVISO] Nao foi possivel baixar o modulo vite-plugin-pwa agora.
        echo O CineLocal prosseguira com o servidor offline padrao.
    )
)

:: Verifica se o FFmpeg esta presente
where ffmpeg >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    if not exist "%~dp0bin\ffmpeg.exe" (
        echo [AVISO] FFmpeg ainda nao detectado.
        echo Para reproduzir MKV, voce podera clicar em 'Instalar FFmpeg Automaticamente'
        echo diretamente na tela do aplicativo ou no icone de Status do CineLocal.
        echo.
    )
)

:: Abre o navegador automaticamente apos 3 segundos
start "" cmd /c "timeout /t 3 >nul 2>&1 & start https://localhost:%PORT%"

:: Define modo de producao para usar a interface compilada de forma rapida, leve e estavel
set "NODE_ENV=production"

:: Executa o CineLocal (preferindo dist/server.cjs compilado ou tsx server.ts)
if exist "%~dp0dist\server.cjs" if exist "%~dp0dist\index.html" (
    node "%~dp0dist\server.cjs"
) else (
    call npm run dev
)

echo.
echo Servidor encerrado.
pause
