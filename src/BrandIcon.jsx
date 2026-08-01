/**
 * BrandIcon — the app's mark: two forearm bones narrowing into a wrist.
 *
 * Replaces the earlier bandage-roll glyph (a rect with vertical stripes).
 * That one read as generic medical supply; this one reads as the joint a
 * cast actually goes on, which is a closer fit for what the app is for.
 *
 * Geometry only, no background — every place this is used already sits
 * inside its own white rounded chip (`.cf2-hero-icon` / `.lg-icon`). The one
 * place that needs its own background is the browser-tab favicon, which
 * cannot rely on a wrapping element; `public/favicon.svg` bakes the same
 * five shapes onto a white square by hand and must be kept in sync with
 * this file if the geometry ever changes.
 */
export default function BrandIcon({ size = 24, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="20" y="8" width="8" height="28" rx="4" stroke={color} strokeWidth="4" />
      <rect x="36" y="8" width="8" height="26" rx="4" stroke={color} strokeWidth="4" />
      <circle cx="26" cy="44" r="5" fill={color} />
      <circle cx="33" cy="49" r="5" fill={color} />
      <circle cx="40" cy="44" r="5" fill={color} />
    </svg>
  );
}
