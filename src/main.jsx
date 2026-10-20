import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/* The service worker is registered in production builds only — in dev, Vite's
   module graph and an app-shell SW fight each other. The app reads the result
   through the `mc-sw` event and shows "Simulated" when there is no real SW. */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        window.dispatchEvent(new CustomEvent('mc-sw', { detail: { state: 'registered', scope: reg.scope } }));
        reg.addEventListener('updatefound', () => {
          window.dispatchEvent(new CustomEvent('mc-sw', { detail: { state: 'update-found' } }));
        });
      })
      .catch((err) => {
        window.dispatchEvent(new CustomEvent('mc-sw', { detail: { state: 'failed', error: String(err) } }));
      });
  });
} else {
  window.dispatchEvent(new CustomEvent('mc-sw', { detail: { state: 'simulated' } }));
}
