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
    btn.setAttribute('aria-pressed', String(isDark));
    btn.querySelector('.label').textContent = isDark ? 'Dark' : 'Light';
  });
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0F2723' : '#F9F9F9');
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
