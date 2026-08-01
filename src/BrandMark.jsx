import { useId } from 'react';

/**
 * BrandMark — the app's icon: an anatomical bone in a plaster cast.
 *
 * Self-contained, unlike the wrist-bone glyph it replaces (which was strokes
 * only and relied on a wrapping white chip for its background). This one
 * draws its own rounded gradient tile and a hairline white rim, so it can
 * sit directly on the header's own green gradient without a chip nested
 * inside another chip. The header and the LIFF block screen both dropped
 * their `.cf2-hero-icon` / `.lg-icon` wrapper divs for this reason — only
 * `size` and layout are left to the caller.
 *
 * `public/favicon.svg` bakes the same shapes as a static file, since a
 * favicon has to be a file a `<link>` points at rather than JSX. Keep the
 * two in sync by hand if the geometry ever changes.
 *
 * Gradient/filter ids are suffixed with useId() so multiple instances on one
 * page never collide — cheap insurance, since today only one ever renders
 * at a time (header while the form shows, block screen while it doesn't).
 */
export default function BrandMark({ size = 48 }) {
  const uid = useId().replace(/:/g, '');
  const tile = `bm-tile-${uid}`;
  const bone = `bm-bone-${uid}`;
  const plaster = `bm-plaster-${uid}`;
  const lift = `bm-lift-${uid}`;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#08714E" />
          <stop offset="1" stopColor="#16A248" />
        </linearGradient>
        <linearGradient id={bone} gradientUnits="userSpaceOnUse" x1="18" y1="8" x2="46" y2="56">
          <stop offset="0" stopColor="#FFFAF0" />
          <stop offset="0.5" stopColor="#F2E5CB" />
          <stop offset="1" stopColor="#D2B98F" />
        </linearGradient>
        <linearGradient id={plaster} gradientUnits="userSpaceOnUse" x1="19" y1="26" x2="44" y2="44">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#F2F5F3" />
          <stop offset="1" stopColor="#CFD9D4" />
        </linearGradient>
        <filter id={lift} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodColor="#123024" floodOpacity="0.4" />
        </filter>
      </defs>

      <rect width="64" height="64" rx="14" fill={`url(#${tile})`} />
      <rect x="0.9" y="0.9" width="62.2" height="62.2" rx="13.2"
            fill="none" stroke="#fff" strokeWidth="1.8" opacity=".9" />

      {/* Humerus: offset head + tubercle, tapered shaft, paired condyles. */}
      <g fill={`url(#${bone})`}>
        <path d="M26.5 16 C28.8 24, 27.8 32, 28.2 39 C28.5 44, 29.6 47.5, 31.4 50.5
                 L38.8 48.6 C36.8 45, 35.8 41.5, 35.7 36.5 C35.6 29, 36.6 22, 35.2 16 Z" />
        <ellipse cx="26.2" cy="15" rx="7.8" ry="6.8" transform="rotate(-18 26.2 15)" />
        <ellipse cx="36.6" cy="16.4" rx="5.2" ry="4.6" transform="rotate(-18 36.6 16.4)" />
        <ellipse cx="29.4" cy="51.4" rx="6.2" ry="5.6" transform="rotate(-18 29.4 51.4)" />
        <ellipse cx="40.6" cy="48.4" rx="5.6" ry="5.1" transform="rotate(-18 40.6 48.4)" />
      </g>

      {/* Plaster cuff: barrel-shaped, rolled edge, dropping a real shadow onto the bone. */}
      <g filter={`url(#${lift})`}>
        <path d="M19.5 30 C18.6 34.5, 18.7 39, 20.2 43.4 C25 45.6, 38 44.4, 43.6 41.6
                 C44.4 37, 44.3 32.6, 42.9 28.4 C37.6 25.8, 25 27.2, 19.5 30 Z"
              fill={`url(#${plaster})`} />
      </g>
      <g fill="none" stroke="#AFC0B7" strokeWidth="1.15" opacity=".9" strokeLinecap="round">
        <path d="M19.1 34.4 C24 36.5, 37.4 35.3, 43.4 32.6" />
        <path d="M19.2 38.2 C24.2 40.3, 37.8 39.1, 43.8 36.4" />
      </g>
    </svg>
  );
}
