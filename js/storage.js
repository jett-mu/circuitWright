const KEY = 'circuitwright.autosave.v1';

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

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function saveFile(circ) {
  const name = (circ.title || 'circuit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'circuit';
  download(new Blob([JSON.stringify(circ.toJSON(), null, 2)], { type: 'application/json' }), `circuitwright-${name}.json`);
}

export async function loadFile(circ, file) {
  circ.load(JSON.parse(await file.text()));
}
