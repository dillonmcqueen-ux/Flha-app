import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import Login from './Login.jsx'
import Onboarding from './Onboarding.jsx'
import ClaimAccount from './ClaimAccount.jsx'

const path = window.location.pathname.replace(/\/+$/, '')
const isOnboarding = path === '/onboarding'
const isClaim = path === '/claim'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isClaim ? <ClaimAccount /> : isOnboarding ? <Onboarding /> : <Login />}
    <Analytics />
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
