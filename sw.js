// Guarda os arquivos do app no celular para funcionar sem internet.
const VERSAO = "coco-certo-v6";
const ARQUIVOS = ["./", "index.html", "estilo.css", "calculo.js", "dados.js", "app.js",
  "manifest.webmanifest", "icone.svg", "icone-192.png", "icone-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Usa o que está guardado e, ao mesmo tempo, busca a versão nova para a próxima vez.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSAO).then(async cache => {
    const guardado = await cache.match(e.request, { ignoreSearch: true });
    const daRede = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => guardado);
    return guardado || daRede;
  }));
});
