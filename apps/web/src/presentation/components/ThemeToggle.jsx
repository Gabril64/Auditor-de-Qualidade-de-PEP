import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { applyTheme, readTheme } from '../../data/theme.js';

/** Switches between the dark theme (default) and the light one. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const light = theme === 'light';

  function toggle() {
    const next = light ? 'dark' : 'light';
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={light ? 'Usar tema escuro' : 'Usar tema claro'}
      title={light ? 'Tema escuro' : 'Tema claro'}
      style={{
        background: 'none', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text2)',
        padding: '5px 10px', fontSize: 14, cursor: 'pointer',
      }}
    >
      <Icon name={light ? 'moon' : 'sun'} size={16} />
    </button>
  );
}
