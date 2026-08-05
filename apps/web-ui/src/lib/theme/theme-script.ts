import { FAMILY_KEY, SCHEME_KEY } from "./theme-core";

// Runs synchronously before first paint to set theme attributes from
// localStorage, so there is no flash of the wrong theme and no icon swap on
// hydration. Keep it dependency-free — it is injected as a raw <script>.
export const THEME_SCRIPT = `
(function(){
  try {
    var f = localStorage.getItem('${FAMILY_KEY}');
    if (f !== 'elegant' && f !== 'retro' && f !== 'chicago') f = 'elegant';
    var s = localStorage.getItem('${SCHEME_KEY}');
    if (s !== 'light' && s !== 'dark' && s !== 'auto') s = 'auto';
    var resolved = s === 'auto'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : s;
    var el = document.documentElement;
    el.setAttribute('data-theme-family', f);
    el.setAttribute('data-color-scheme', resolved);
    window.__loreFamily = f;
  } catch (e) {
    document.documentElement.setAttribute('data-theme-family', 'elegant');
    document.documentElement.setAttribute('data-color-scheme', 'dark');
  }
})();
`;
