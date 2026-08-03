import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { registerServiceWorker } from './registerServiceWorker'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Offline app shell. Registered after render so it never delays first paint on a
// till, and it never throws — see registerServiceWorker for why it is best-effort.
registerServiceWorker();
