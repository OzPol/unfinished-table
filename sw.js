const CACHE = "unfinished-table-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./model.js", "./orbitals.js",
  "./compounds.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "./data/catalog.json", "./data/facts.ndjson.gz", "./data/isotopes.ndjson.gz", "./data/compounds.json",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("unfinished-table-") && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && event.request.mode !== "navigate") await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const fallback = event.request.mode === "navigate" ? await cache.match("./index.html") : await cache.match(event.request);
      if (fallback) return fallback;
      throw error;
    }
  })());
});
