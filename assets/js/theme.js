// The initial theme is applied by an inline snippet in <head> (avoids a flash);
// this wires up the toggle button.
const root = document.documentElement;
const dark = matchMedia('(prefers-color-scheme: dark)');

function current() {
  return root.dataset.theme || (dark.matches ? 'dark' : 'light');
}

function sync() {
  const isDark = current() === 'dark';
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  });
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0a1b18' : '#f9f9f9');
}

document.querySelectorAll('.theme-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    sync();
  });
});

dark.addEventListener('change', sync);
sync();
