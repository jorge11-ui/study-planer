/* StudyJournal — service worker (app shell offline).
   Estratégia: navegação = rede-primeiro (nunca guarda interstitials);
   estáticos = cache-primeiro; /api/* nunca passa pela cache.
   Ao mudar ficheiros, subir CACHE para forçar atualização. */
const CACHE = 'study-journal-v1';

const NUCLEO = [
    '/',
    '/index.html',
    '/app.css',
    '/manifest.webmanifest',
    '/src/app.js',
    '/src/vault.js',
    '/src/pdfs.js',
    '/src/weekly.js',
    '/src/github-sync.js',
    '/src/conta-sync.js',
    '/src/exames.js',
    '/src/notas.js',
    '/src/imagens.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE).then((cache) => cache.addAll(NUCLEO)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(async (resp) => {
                    if (resp && resp.ok) {
                        // Com o túnel em baixo o ngrok devolve 200 com página
                        // de erro: nunca guardar isso como shell da app.
                        const ct = resp.headers.get('content-type') || '';
                        let valida = !ct.includes('text/html');
                        if (!valida) {
                            try {
                                const texto = await resp.clone().text();
                                valida = /StudyJournal/.test(texto) && !/err_ngrok|ngrok-skip|ERR_NGROK/i.test(texto);
                            } catch {
                                valida = false;
                            }
                        }
                        if (valida) {
                            const copia = resp.clone();
                            caches.open(CACHE).then((cache) => cache.put(event.request, copia));
                        } else {
                            const cached = await caches.match(event.request);
                            if (cached) return cached;
                        }
                    }
                    return resp;
                })
                .catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((hit) => {
            const rede = fetch(event.request).then((resp) => {
                if (resp && resp.ok) {
                    const copia = resp.clone();
                    caches.open(CACHE).then((cache) => cache.put(event.request, copia));
                }
                return resp;
            }).catch(() => hit);
            return hit || rede;
        })
    );
});
