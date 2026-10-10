// First-run disclaimer: shown until acknowledged, then again after 336 hours (14 days).
const KEY = 'checked';
const MAX_AGE = 336 * 60 * 60 * 1000;

function acknowledged() {
  try {
    const t = Number(localStorage.getItem(KEY));
    return t > 0 && Date.now() - t < MAX_AGE && t <= Date.now();
  } catch { return false; }
}

export function requireDisclaimer() {
  if (acknowledged()) return;
  const dlg = document.querySelector('#disclaimer-dlg');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc must not skip it
  const ok = document.querySelector('#disclaimer-ok'), chk = document.querySelector('#disclaimer-chk');
  chk.checked = false;
  ok.disabled = true;
  chk.addEventListener('change', () => { ok.disabled = !chk.checked; });
  ok.addEventListener('click', () => {
    if (!chk.checked) return;
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage unavailable: ask again next visit */ }
    dlg.close();
  });
  dlg.showModal();
}
