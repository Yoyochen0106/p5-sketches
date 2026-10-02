// Deep links between course units: '#/<sketch-id>?key=value&...'.

/** Build the hash URL for a unit with optional scalar parameters. */
export function unitHash(id, params = {}) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `#/${id}${q ? `?${q}` : ''}`;
}

/** Navigate to another unit (no-op outside a browser). */
export function openUnit(id, params = {}) {
  if (typeof location === 'undefined') return false;
  location.hash = unitHash(id, params);
  return true;
}
