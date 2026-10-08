/* Service worker: cachea la "cáscara" de la app para que abra al instante
   y funcione sin conexión. Los mensajes SIEMPRE van al servidor. */
const CACHE = 'nosotros-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Todo lo que es API va SIEMPRE a internet: nunca servimos mensajes viejos del caché
  if (url.pathname.startsWith('/api/')) return;

  // Navegación: red primero, si no hay red mostramos la app desde el caché
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put('/', copia));
          return r;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Estáticos: caché primero
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match('/')))
  );
});
