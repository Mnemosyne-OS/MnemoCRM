import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { onHostConfig } from './sdk/mnemo-sdk';
import { setHostLanguage } from './i18n';
import './styles.css';

// Inherit the host shell's theme and live tokens (the person's accent
// included), and follow its language.
onHostConfig((config) => setHostLanguage(config.lang));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
