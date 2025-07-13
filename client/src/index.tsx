import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Enhanced service worker registration with update detection
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/service-worker.js`)
      .then(function(registration) {
        console.log('SW registered: ', registration);
        
        // Check for updates every 60 seconds
        setInterval(() => {
          registration.update();
        }, 60000);
        
        // Listen for waiting service worker
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New content is available, show update notification
                showUpdateNotification(registration);
              }
            });
          }
        });
        
        // Check if there's already a waiting service worker
        if (registration.waiting) {
          showUpdateNotification(registration);
        }
      })
      .catch(function(registrationError) {
        console.log('SW registration failed: ', registrationError);
      });
  });
  
  // Listen for service worker controller changes
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Service worker has been updated and is now controlling the page
    window.location.reload();
  });
}

// Function to show update notification
function showUpdateNotification(registration: ServiceWorkerRegistration) {
  // Create and show update banner
  const updateBanner = document.createElement('div');
  updateBanner.id = 'update-banner';
  updateBanner.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #2c3e50;
      color: white;
      padding: 12px 20px;
      text-align: center;
      z-index: 10000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    ">
      <div style="max-width: 600px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <span style={{flex: 1, minWidth: 200}}>🚀 A new version of MigoYugo is available!</span>
        <div style="display: flex; gap: 10px;">
          <button id="update-now" style="
            background: #3498db;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
          ">Update Now</button>
          <button id="update-later" style="
            background: transparent;
            color: white;
            border: 1px solid white;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
          ">Later</button>
        </div>
      </div>
    </div>
  `;
  
  // Remove existing banner if present
  const existingBanner = document.getElementById('update-banner');
  if (existingBanner) {
    existingBanner.remove();
  }
  
  document.body.appendChild(updateBanner);
  
  // Handle update now button
  document.getElementById('update-now')?.addEventListener('click', () => {
    if (registration.waiting) {
      // Tell the waiting service worker to skip waiting
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    updateBanner.remove();
  });
  
  // Handle update later button
  document.getElementById('update-later')?.addEventListener('click', () => {
    updateBanner.remove();
    // Show reminder in 5 minutes
    setTimeout(() => {
      if (registration.waiting) {
        showUpdateNotification(registration);
      }
    }, 5 * 60 * 1000);
  });
  
  // Auto-hide after 30 seconds if no interaction
  setTimeout(() => {
    if (document.getElementById('update-banner')) {
      updateBanner.remove();
    }
  }, 30000);
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
