export function createBus() {
  const map = new Map();
  return {
    on(evt, fn) {
      let s = map.get(evt);
      if (!s) { s = new Set(); map.set(evt, s); }
      s.add(fn);
      return () => s.delete(fn);
    },
    off(evt, fn) { map.get(evt)?.delete(fn); },
    emit(evt, payload) {
      const s = map.get(evt);
      if (!s) return;
      for (const fn of Array.from(s)) {
        try { fn(payload); } catch (e) { console.error('[bus]', evt, e); }
      }
    },
  };
}