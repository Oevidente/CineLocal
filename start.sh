#!/usr/bin/env bash
# CineLocal - Inicializador Portátil Linux / Mac
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

export PORT="${PORT:-3050}"
export NODE_ENV="${NODE_ENV:-production}"
export HLS_CACHE_DIR="${HLS_CACHE_DIR:-$DIR/.cache/hls}"
export HLS_CACHE_MAX_MB="${HLS_CACHE_MAX_MB:-4096}"

echo "======================================================"
echo "   CineLocal - Biblioteca de Mídia 100% Offline"
echo "======================================================"
echo "[INFO] Porta configurada: $PORT"
echo ""

# Adiciona pastas bin e ffmpeg locais ao PATH se existirem
if [ -d "$DIR/bin" ]; then
  export PATH="$DIR/bin:$PATH"
fi
if [ -d "$DIR/ffmpeg/bin" ]; then
  export PATH="$DIR/ffmpeg/bin:$PATH"
fi
if [ -d "$DIR/ffmpeg" ]; then
  export PATH="$DIR/ffmpeg:$PATH"
fi

# Verifica Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js não foi encontrado no sistema!"
  echo "Por favor instale o Node.js (https://nodejs.org) para continuar."
  exit 1
fi

# Instala ou atualiza dependências se necessário
if [ ! -d "$DIR/node_modules" ] || [ ! -d "$DIR/node_modules/hls.js" ] || [ ! -d "$DIR/node_modules/tsx" ] || [ ! -d "$DIR/node_modules/vite-plugin-pwa" ]; then
  echo "[INFO] Instalando/atualizando dependências necessárias (npm install)..."
  npm install
  echo "[OK] Dependências instaladas com sucesso!"
else
  echo "[OK] Dependências verificadas e prontas."
fi

# Abre o navegador padrão após 3 segundos
(sleep 3 && (xdg-open "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT" 2>/dev/null || true)) &

if [ -f "$DIR/dist/server.cjs" ]; then
  node "$DIR/dist/server.cjs"
else
  npm run build && node "$DIR/dist/server.cjs" || npx tsx server.ts
fi
