import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Preload WebAssembly artifacts early so the viewer is ready to render instantly.
// preloadWorker only needs baseUrl but the type signature requires full config — safe to cast.
import("@nutrient-sdk/viewer").then((module) => {
  const preload = module.default.preloadWorker as (config: { baseUrl: string }) => Promise<void>;
  preload({ baseUrl: `${window.location.protocol}//${window.location.host}/` });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
