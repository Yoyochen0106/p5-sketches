// Deep links to related units: '#/<id>?key=value&...' (the router mirrors settings into the hash).

/** Hash string for a unit id and a params object (undefined / null values are skipped). */
export function hashFor(id, params = {}) {
    const q = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
    return `#/${id}${q ? `?${q}` : ''}`;
}

/** Navigates to the unit (guarded for non-browser environments). Returns the hash used. */
export function openIn(id, params = {}) {
    const h = hashFor(id, params);
    if (typeof location !== 'undefined' && location) {
        try { location.hash = h; } catch { /* ignore */ }
    }
    return h;
}
