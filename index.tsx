import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// Fix: Added missing parenthesis for root.render call to resolve "Operator '>' cannot be applied" error
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);