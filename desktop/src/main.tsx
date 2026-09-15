import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider, applyTheme, resolveInitialTheme } from './context/ThemeContext';
import './index.css';

// Antes del primer render, para no pintar un cuadro claro y luego oscurecerlo.
applyTheme(resolveInitialTheme());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
