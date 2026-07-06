import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Dashboard from './Dashboard.jsx'

const isDashboard = window.location.pathname === '/dashboard'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isDashboard ? <Dashboard /> : <App />}
  </React.StrictMode>,
)
