// Theme palette and per-method colours for the approximation lab.

const DARK = {
    bg: '#14161a', panel: '#181b20', fg: '#eceff4', muted: '#8b93a1',
    grid: '#262b33', axis: '#4b5463', accent: '#ff4d4f', border: '#2d333d',
};
const LIGHT = {
    bg: '#f0f0f0', panel: '#fafafa', fg: '#14161a', muted: '#6b7280',
    grid: '#dcdfe4', axis: '#9aa1ad', accent: '#e11d2e', border: '#c9ced6',
};

export const METHOD_COLORS = {
    taylor: '#4aa3ff',
    pade: '#ff9f43',
    fourier: '#2ecc71',
    wavelet: '#c77dff',
    interp: '#ff5fa2',
};

/** Resolve 'dark' | 'light' | 'auto' into a palette. */
export function getPalette(theme) {
    let dark = true;
    if (theme === 'light') dark = false;
    else if (theme === 'auto' || theme === undefined) {
        try {
            dark = !globalThis.matchMedia || globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch {
            dark = true;
        }
    }
    return { ...(dark ? DARK : LIGHT), dark };
}
