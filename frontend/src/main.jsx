import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import Admin from './Admin.jsx';
import About from './About.jsx';
import './styles.css';

// Simple path-based routing: /admin and /about have their own pages.
const path = window.location.pathname.replace(/\/+$/, '');
const route = path.endsWith('/admin') ? 'admin' : path.endsWith('/about') ? 'about' : 'app';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {route === 'admin' ? <Admin /> : route === 'about' ? <About /> : <App />}
  </React.StrictMode>
);
