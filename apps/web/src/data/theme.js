/** The color theme: dark by default, light on request. The choice is kept in this browser only. */

const KEY = 'theme';

/** @returns {'dark'|'light'} */
export function readTheme(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Puts the theme on the page and remembers it; a browser that refuses storage still gets the theme. */
export function applyTheme(theme, root = globalThis.document?.documentElement, storage = globalThis.localStorage) {
  root?.setAttribute('data-theme', theme);
  try {
    storage?.setItem(KEY, theme);
  } catch {
    // Private window or blocked storage: the theme lasts until the page closes.
  }
}
