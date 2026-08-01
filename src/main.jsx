import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CastForm from './CastForm';
import LiffGate from './LiffGate';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LiffGate>
      <CastForm />
    </LiffGate>
  </StrictMode>,
);
