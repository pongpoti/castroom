import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CastForm from './CastForm';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CastForm />
  </StrictMode>,
);
