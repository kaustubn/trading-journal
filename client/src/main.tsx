import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App.tsx'
import './App.css'
import './styles/theme.css'

// Same-origin API: the backend serves this frontend, so relative /api paths work
// on any host (Render, Railway, localhost via Vite's /api proxy). No baked URLs.
axios.defaults.baseURL = ''

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
