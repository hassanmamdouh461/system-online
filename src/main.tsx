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

  // 2. Monkeypatch Storage.prototype to sync localStorage changes back to SQLite with safety wraps
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.setItem = function(this: Storage, key: string, value: string) {
    originalSetItem.apply(this, [key, value]);
    if (this === localStorage) {
      if (window.electronAPI && typeof window.electronAPI.saveSetting === 'function') {
        try {
          window.electronAPI.saveSetting(key, value);
        } catch (err) {
          console.warn('[main.tsx] Failed to sync setting to Electron IPC:', key, err);
        }
      }
    }
  };

  Storage.prototype.removeItem = function(this: Storage, key: string) {
    originalRemoveItem.apply(this, [key]);
    if (this === localStorage) {
      if (window.electronAPI && typeof window.electronAPI.deleteSetting === 'function') {
        try {
          window.electronAPI.deleteSetting(key);
        } catch (err) {
          console.warn('[main.tsx] Failed to delete setting via Electron IPC:', key, err);
        }
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
