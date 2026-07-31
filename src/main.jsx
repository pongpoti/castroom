import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PatientCapture from './PatientCapture';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PatientCapture />
  </StrictMode>,
);
