const KEY = 'gatewright.autosave.v1';

export function autosave(circ) {
  try { localStorage.setItem(KEY, JSON.stringify(circ.toJSON())); } catch { /* storage unavailable */ }
}

export function restore(circ) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    circ.load(JSON.parse(raw));
    return circ.components.length > 0;
  } catch { return false; }
}

export function saveFile(circ) {
  const blob = new Blob([JSON.stringify(circ.toJSON(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gatewright-circuit.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function loadFile(circ, file) {
  circ.load(JSON.parse(await file.text()));
}
