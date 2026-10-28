/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'deregister') {
      self.registration.unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => { clients.forEach((client) => client.navigate(client.url)); });
    }
  });
  self.addEventListener('fetch', function (e) {
    const r = e.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

    const request = (coepCredentialless && r.mode === 'no-cors')
      ? new Request(r, { credentials: 'omit' })
      : r;

    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) return response;

          const newHeaders = new Headers(response.headers);
          newHeaders.set('Cross-Origin-Embedder-Policy',
            coepCredentialless ? 'credentialless' : 'require-corp'
          );
          if (!coepCredentialless) {
            newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
          }
          newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

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
    const reloadedByCOI = window.sessionStorage.getItem('coiReloadedByCOI');
    window.sessionStorage.removeItem('coiReloadedByCOI');

    const coiCheck = () => {
      const { crossOriginIsolated, SharedArrayBuffer, window: w } = globalThis;
      if (crossOriginIsolated !== false) return true;
      if (SharedArrayBuffer !== undefined) return true;
      return false;
    };

    if (coiCheck()) {
      return;
    }

    if (reloadedByCOI) {
      return;
    }

    if (!window.isSecureContext) {
      console.log('COOP/COEP Service Worker: Not a secure context, cannot register.');
      return;
    }

    navigator.serviceWorker
      .register(new URL(document.currentScript?.src ?? 'coi-serviceworker.js', window.location.href).href)
      .then(
        (registration) => {
          console.log('COOP/COEP Service Worker registered', registration.scope);

          // Reloading before the worker activates leaves the new page uncontrolled (and the
          // coiReloadedByCOI guard then blocks a retry), so wait for activation.
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            const reload = () => {
              console.log('COOP/COEP Service Worker activated, reloading...');
              window.sessionStorage.setItem('coiReloadedByCOI', 'true');
              window.location.reload();
            };
            if (!worker || worker.state === 'activated') return reload();
            worker.addEventListener('statechange', () => {
              if (worker.state === 'activated') reload();
            });
          });

          if (registration.active && !navigator.serviceWorker.controller) {
            console.log('COOP/COEP Service Worker: Reloading to activate...');
            window.sessionStorage.setItem('coiReloadedByCOI', 'true');
            window.location.reload();
          }
        },
        (err) => {
          console.error('COOP/COEP Service Worker: Registration failed:', err);
        }
      );
  })();
}
