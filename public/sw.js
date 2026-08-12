// public/sw.js
// Phase 4 of docs/scope-offline-capability.md: a small, hand-rolled service
// worker for FORA's PWA shell. Deliberately no Workbox — this project has
// 5 runtime dependencies today (see package.json), and this file is meant
// to stay small enough to read end-to-end.
//
// This app has no client-side router (src/main.jsx does one pathname
// check for "/onboarding", everything else is the same SPA shell switched
// by session state), so there's exactly one HTML shell to cache — no
// per-route logic needed here.
//
// THE RULE THAT MATTERS MOST: never intercept anything under /api/. Every
// offline-detection path built in Phases 0-3 (the !navigator.onLine checks,
// the isNetworkFailure/isServerError split, the IndexedDB submission and
// photo queues) depends on those requests reaching the real network and
// failing naturally when they can't. A service worker that tried to cache
// or short-circuit an API response would silently break all of that.

const CACHE_VERSION = "fora-shell-v1";

// A page isn't controlled by its own service worker until *after* that
// worker has installed, activated, and (via clients.claim() below) taken
// control — the very first load's own index.html/JS/CSS requests happen
// before any of that, so they'd never get cached by the runtime fetch
// handler alone. Precaching them here at install time, instead of only
// relying on opportunistic runtime caching, is what makes the shell
// available starting from the *second* visit rather than "eventually,
// whenever a fetch happens to be interceptable." No build-time manifest
// needed for this — just fetching "/" and reading out of its own HTML
// which script/link tags Vite actually emitted for the current deploy.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const shellRes = await fetch("/", { cache: "no-store" });
      const shellText = await shellRes.clone().text();
      await cache.put("/index.html", shellRes);

      const assetUrls = new Set();
      for (const match of shellText.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
        assetUrls.add(match[1]);
      }
      assetUrls.add("/manifest.json");

      // manifest.json's icons aren't referenced from index.html itself
      // (only from the manifest), so they wouldn't otherwise get pulled in
      // above — precache those too rather than leaving them to whenever
      // the OS happens to fetch one for an install prompt.
      try {
        const manifestRes = await fetch("/manifest.json", { cache: "no-store" });
        const manifestJson = await manifestRes.json();
        for (const icon of manifestJson.icons || []) assetUrls.add(icon.src);
      } catch (e) { /* best-effort */ }

      await Promise.all(
        [...assetUrls].map(async (path) => {
          try {
            const res = await fetch(path, { cache: "no-store" });
            if (res.ok) await cache.put(path, res);
          } catch (e) { /* best-effort — a missed asset just falls back to runtime caching later */ }
        })
      );
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only ever handle same-origin GET requests — everything else (API
  // calls, Supabase/Anthropic/Stripe requests, POSTs, cross-origin) passes
  // straight through untouched.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (loading/reloading a page): network-first, so a
  // returning-online visit picks up a new deploy's updated script tags,
  // falling back to the cached shell when there's no connectivity at all —
  // this is what lets the app actually open with zero signal, not just
  // survive a signal drop mid-session.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put("/index.html", fresh.clone());
          return fresh;
        } catch (e) {
          const cache = await caches.open(CACHE_VERSION);
          const cached = await cache.match("/index.html");
          if (cached) return cached;
          throw e;
        }
      })()
    );
    return;
  }

  // Static shell assets (Vite's content-hashed JS/CSS under /assets/, the
  // logo, manifest, icons): cache-first. Safe for hashed filenames — a
  // given hash's content never changes once published, so there's no
  // freshness concern in serving it from cache indefinitely. Falls back to
  // network (and caches the response for next time) for anything not yet
  // cached, which is how the shell gets populated in the first place — the
  // app has to be opened online once after each deploy to pick up that
  // deploy's bundle, the trade-off for not needing a build-time precache
  // manifest to track Vite's hashed filenames.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch (e) {
        if (cached) return cached;
        throw e;
      }
    })()
  );
});
