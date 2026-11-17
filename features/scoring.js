// scoring.js —— 仅负责"谁打了谁"的记账，不碰 run / 不发网络
export function createScoring({ state }) {
  function recordDamage(victimId, attackerId, attackerName) {
    if (!victimId || !attackerId || victimId === attackerId) return;
    let m = state.getDamagers(victimId);
    if (!m) { m = new Map(); state.setDamagers(victimId, m); }
    m.set(attackerId, { name: attackerName || 'Player', t: performance.now() });
    const now = performance.now();
    for (const [aid, r] of m) if (now - r.t > 12000) m.delete(aid);
  }

  function getAssists(victimId, excludeId, windowMs = 5000) {
    const m = state.getDamagers(victimId);
    if (!m) return [];
    const now = performance.now(), out = [];
    for (const [aid, r] of m) {
      if (aid === excludeId || aid === victimId) continue;
      if (now - r.t <= windowMs) out.push(aid);
    }
    return out;
  }

  function getAssistNames(assistIds, excludeId) {
    const out = [];
    for (const aid of assistIds) {
      if (aid === excludeId) continue;
      const n = state.getName(aid) || (aid === state.me ? state.getPlayerName() : aid.slice(0, 5));
      if (n) out.push(n);
    }
    return out;
  }

  return { recordDamage, getAssists, getAssistNames };
}