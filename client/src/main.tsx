// Browser entry point: finds the <div id="root"> in index.html and renders React into it.

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No #root element found in index.html');

ReactDOM.createRoot(rootElement).render(
  // StrictMode is a development-only wrapper. It deliberately double-invokes effects
  // to surface bugs caused by non-idempotent code. It disappears in production builds.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
