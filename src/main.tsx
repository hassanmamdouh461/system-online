import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

async function initApp() {
  // 1. Sync settings from Electron SQLite DB to localStorage on startup
  if (window.electronAPI && typeof window.electronAPI.getSettings === 'function') {
    try {
      const dbSettings = await window.electronAPI.getSettings();
      for (const [key, val] of Object.entries(dbSettings)) {
        localStorage.setItem(key, val);
      }
    } catch (e) {
      console.error('[Settings] Failed to restore settings from DB:', e);
    }
  }

  // 2. Monkeypatch Storage.prototype to sync localStorage changes back to SQLite
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.setItem = function(this: Storage, key: string, value: string) {
    originalSetItem.apply(this, [key, value]);
    if (this === localStorage) {
      if (window.electronAPI && typeof window.electronAPI.saveSetting === 'function') {
        window.electronAPI.saveSetting(key, value);
      }
    }
  };

  Storage.prototype.removeItem = function(this: Storage, key: string) {
    originalRemoveItem.apply(this, [key]);
    if (this === localStorage) {
      if (window.electronAPI && typeof window.electronAPI.deleteSetting === 'function') {
        window.electronAPI.deleteSetting(key);
      }
    }
  };

  // 3. Mount the React application
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

initApp();
