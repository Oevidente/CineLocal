import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { apiRouter } from './src/server/routes';

// Global error handlers to ensure child process or async errors never crash the Node server
process.on('uncaughtException', (err: any) => {
  console.error('[CineLocal Server] Erro não tratado interceptado (uncaughtException):', err?.message || err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[CineLocal Server] Rejeição de Promise interceptada (unhandledRejection):', reason?.message || reason);
});

async function startServer() {
  const app = express();
  const DEFAULT_PORT = 3000;
  const configuredPort = Number(process.env.PORT);
  const PORT = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : DEFAULT_PORT;
  const httpsRequested = process.env.HTTPS === 'true' || process.env.HTTPS === '1';
  const certificateDirectory = process.env.HTTPS_CERT_DIR || path.join(process.cwd(), 'certs');
  const pfxPath = process.env.HTTPS_PFX_PATH || path.join(certificateDirectory, 'cinelocal.pfx');
  const pfxPassphrase = process.env.HTTPS_PFX_PASSPHRASE || 'CineLocal-HTTPS-Local';
  const useHttps = httpsRequested && fs.existsSync(pfxPath);

  if (httpsRequested && !useHttps) {
    console.warn(`[CineLocal] Certificado HTTPS não encontrado em ${pfxPath}. O servidor será iniciado em HTTP.`);
  }

  // Middleware
  // Subtitle imports are sent as base64 text from the browser. Keep the
  // request bounded while allowing normal subtitle files to be imported.
  app.use(express.json({ limit: '20mb' }));

  // The Cast receiver may request local media cross-origin. Keep this limited
  // to media routes so normal application responses remain unchanged.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/media/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });

  // API Routes
  app.use('/api', apiRouter);

  // Healthcheck
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Vite middleware in dev / Static files in prod
  const distPath = path.join(process.cwd(), 'dist');
  const distHtmlExists = fs.existsSync(path.join(distPath, 'index.html'));
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && distHtmlExists) {
    console.log('[CineLocal] Servindo interface compilada a partir de dist/');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          // The app already owns the HTTP server. Do not open Vite's separate
          // HMR WebSocket (which defaults to port 24678).
          hmr: false,
          ws: false,
          watch: {
            ignored: ['**/data/**', '**/data/library.json', '**/.git/**', '**/cinelocal_hls/**', '**/tmp/**', '**/*.ts', '**/*.m3u8'],
          },
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (viteErr: any) {
      console.warn('[CineLocal] Falha ao carregar Vite dev middleware (binding nativo ou modulo ausente):', viteErr?.message || viteErr);
      if (distHtmlExists) {
        console.log('[CineLocal] Fallback ativado com sucesso: Servindo frontend a partir da pasta dist/');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
          res.sendFile(path.join(distPath, 'index.html'));
        });
      } else {
        throw viteErr;
      }
    }
  }

  const primaryProtocol = useHttps ? 'https' : 'http';
  const primaryServer = useHttps
    ? https.createServer({ pfx: fs.readFileSync(pfxPath), passphrase: pfxPassphrase }, app)
    : http.createServer(app);

  // When the page is HTTPS, Chromecast uses this HTTP listener for the media
  // URL. This avoids making the receiver validate the local self-signed cert.
  app.locals.castMediaProtocol = useHttps ? null : 'http';
  app.locals.castMediaPort = useHttps ? null : PORT;
  const castMediaPort = Number(process.env.CAST_MEDIA_PORT) || PORT + 1;
  let castMediaServer: http.Server | null = null;

  primaryServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[CineLocal] Servidor rodando em ${primaryProtocol}://localhost:${PORT}`);

    if (useHttps) {
      castMediaServer = http.createServer(app);
      castMediaServer.on('error', (err: any) => {
        console.error(`[CineLocal] Não foi possível abrir a porta HTTP auxiliar ${castMediaPort}:`, err?.message || err);
        app.locals.castMediaProtocol = null;
        app.locals.castMediaPort = null;
      });
      castMediaServer.listen(castMediaPort, '0.0.0.0', () => {
        app.locals.castMediaProtocol = 'http';
        app.locals.castMediaPort = castMediaPort;
        console.log(`[CineLocal] Porta HTTP auxiliar para Chromecast: http://0.0.0.0:${castMediaPort}`);
      });
    }
  });

  primaryServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[ERRO FATAL] A porta ${PORT} ja esta ocupada por outro programa no seu computador!`);
      console.error(`Para usar outra porta, altere 'set PORT=3050' no arquivo start.bat para outra porta (ex: 3060, 8080).\n`);
    } else {
      console.error('[ERRO FATAL] Erro ao iniciar o servidor:', err);
    }
    process.exit(1);
  });
}

startServer();
