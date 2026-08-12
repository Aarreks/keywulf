import React from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted via @fontsource (bundled + fingerprinted by Vite). No third-party
// font request blocks gameplay. Two typefaces:
//   Bitter - a slab serif for the masthead, headlines, and prose. Newsprint
//     register that pairs with the typewriter mono (deliberately NOT a soft
//     old-style serif, which read too close to certain AI-assistant branding).
//   Courier Prime - a refined typewriter monospace for the typing passage, the
//     HUD numerals, and all labels (the teletype / typewriter register).
import '@fontsource/bitter/400.css';
import '@fontsource/bitter/700.css';
import '@fontsource/bitter/400-italic.css';
import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';

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
