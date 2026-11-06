// Shapes for drawing journeys on the map (no map library needed, so it can be tested).

/**
 * Points along a gentle curve from a to b (each [lat, lng]).
 * bend: how far the curve bows out (0 = straight); different values keep
 * several journeys on the same route from drawing on top of each other.
 */
export function curvePoints(a, b, bend = 0.18, steps = 24) {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const mx = (lat1 + lat2) / 2;
  const my = (lng1 + lng2) / 2;
  // Perpendicular offset for the control point.
  const dx = lat2 - lat1;
  const dy = lng2 - lng1;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([u * u * lat1 + 2 * u * t * cx + t * t * lat2, u * u * lng1 + 2 * u * t * cy + t * t * lng2]);
  }
  return pts;
}

/** Bend values for n journeys sharing a route: 0.18, -0.18, 0.3, -0.3, ... */
export function bendFor(index) {
  const step = Math.floor(index / 2);
  const sign = index % 2 === 0 ? 1 : -1;
  return sign * (0.18 + step * 0.12);
}

/** Angle in degrees (0 = pointing right, clockwise) from screen point p to q. */
export function screenAngle(p, q) {
  return (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
}

/** Key for "same route" regardless of direction. */
export const routeKey = (from, to) => [from, to].sort().join('|');
