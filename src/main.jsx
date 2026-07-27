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
