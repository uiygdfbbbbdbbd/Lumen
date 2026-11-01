// Runs before first paint to avoid a flash of the wrong theme. Reads the cached CSS variables
// written by the theme engine (src/lib/theme.ts). Data only: values are re-validated on write.
(function () {
  try {
    var raw = localStorage.getItem('lumen.theme.vars');
    if (!raw) return;
    var vars = JSON.parse(raw);
    var root = document.documentElement;
    for (var k in vars) if (/^--lm-[a-z0-9-]+$/.test(k) && typeof vars[k] === 'string') root.style.setProperty(k, vars[k]);
  } catch (e) {}
})();
