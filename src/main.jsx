import React from 'react'
import ReactDOM from 'react-dom/client'
import Login from './Login.jsx'
import Onboarding from './Onboarding.jsx'

const isOnboarding = window.location.pathname.replace(/\/+$/, '') === '/onboarding'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isOnboarding ? <Onboarding /> : <Login />}
  </React.StrictMode>,
)

// docs/scope-offline-capability.md Phase 4: only register against a real
// production build — registering the service worker against Vite's dev
// server would just create confusing caching behavior (no hashed bundle
// for it to cache, HMR fighting the cache) for no offline benefit during
// development.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA install is a bonus, not a hard requirement — don't block the app on it */ });
  });
}
