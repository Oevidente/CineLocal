/*! coi-serviceworker v0.1.7 - MIT License - https://github.com/gzuidhof/coi-serviceworker */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type === 'deregister') {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => {
          clients.forEach((client) => client.navigate(client.url));
        });
    }
  });

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      return;
    }

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) {
            return response;
          }

          const newHeaders = new Headers(response.headers);
          newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
          if (coepCredentialless) {
            newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
          } else {
            newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
          }

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch((e) => console.error(e))
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem('coiReloadedBySelf');
    window.sessionStorage.removeItem('coiReloadedBySelf');
    const coi = {
      shouldRegister: () => !window.crossOriginIsolated,
      shouldDeregister: () => false,
      doReload: () => window.location.reload(),
      quiet: false,
      ...window.coi,
    };

    const isTopLevel = window === window.top;
    if (!isTopLevel) {
      // In iframes or nested contexts, skip auto-reloading
      return;
    }

    if (navigator.serviceWorker) {
      if (coi.shouldDeregister()) {
        navigator.serviceWorker.controller?.postMessage({ type: 'deregister' });
      }

      if (coi.shouldRegister()) {
        navigator.serviceWorker
          .register(window.document.currentScript?.src || '/coi-serviceworker.js')
          .then(
            (registration) => {
              if (!coi.quiet) {
                console.log('[COI] Service Worker registered for COOP/COEP isolation');
              }
              registration.addEventListener('updatefound', () => {
                if (!coi.quiet) console.log('[COI] Reloading page for cross-origin isolation');
                coi.doReload();
              });

              // If the registration is active but hasn't controlled the page yet:
              if (registration.active && !navigator.serviceWorker.controller) {
                if (!reloadedBySelf) {
                  window.sessionStorage.setItem('coiReloadedBySelf', 'true');
                  coi.doReload();
                }
              }
            },
            (err) => {
              if (!coi.quiet) console.warn('[COI] Failed to register service worker:', err);
            }
          );
      }
    }
  })();
}
