import React from 'react';
import { createRoot } from 'react-dom/client';

// Lato, self-hosted via @fontsource (bundled + fingerprinted by Vite). No
// third-party font request blocks gameplay. We load only the weights we use:
// 400 (body/upcoming text), 700 (UI/labels), 900 (display/headlines).
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';

import './index.css';
import './game.css';
import { App } from './App';

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root');
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
