import { CLIENT_INTERACT_RANGE, CLIENT_INTERACT_FACING } from '../core/constants.js';

export function createRelay({ state, bus, game, net, match }) {
  let clientCutT = 0;

  function run() { return game.G.game && game.G.game.run; }

  function findNearRelay(predicate) {
    const G = game.G, p = G.player, r = run();
    if (!p || !p.alive || !r) return null;
    let best = null, bestD = Infinity;
    for (const rel of r.relays) {
      if (!predicate(rel)) continue;
      const dx = rel.o.pos.x - p.pos.x, dz = rel.o.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > CLIENT_INTERACT_RANGE || Math.abs((rel.o.pos.y || 0) - p.pos.y) > 2.5) continue;
      if (d > 0.9) {
        const fx = p.forward.x, fz = p.forward.z, fl = Math.hypot(fx, fz) || 1;
        if ((dx * fx + dz * fz) / (d * fl) < CLIENT_INTERACT_FACING) continue;
      }
      if (d < bestD) { bestD = d; best = rel; }
    }
    return best ? { relay: best, dist: bestD } : null;
  }

  function clientTick(dt) {
    const G = game.G;
    if (!G.game || G.game.state !== 'playing') { clientCutT = 0; G.hud?.setPrompt?.(null, 0); return; }
    const r = run(); if (!r) return;
    match.syncRunMode(r);
    if (r.netMatchOver) { clientCutT = 0; G.hud?.setPrompt?.(null, 0); return; }
    const m = state.getMode();
    if (m.mode === 'kills') { clientCutT = 0; G.hud?.setPrompt?.(null, 0); return; }
    const myTeamHere = state.getTeam(state.me);
    let canCut = false, canRepair = false;
    if (m.mode === 'vs') { if (myTeamHere === m.attackTeam) canCut = true; else canRepair = true; }
    else if (m.mode === 'relays') canCut = true;

    const cutT = canCut ? findNearRelay((x) => !x.cut) : null;
    const fixT = canRepair ? findNearRelay((x) => x.cut) : null;
    const target = cutT && fixT ? (cutT.dist <= fixT.dist ? cutT : fixT) : (cutT || fixT);
    if (!target) { clientCutT = 0; G.hud?.setPrompt?.(null, 0); return; }
    const rel = target.relay;
    const holding = G.input && G.input.down && G.input.down('interact');
    clientCutT = holding ? Math.min(1, clientCutT + dt / 2.4) : 0;
    G.hud?.setPrompt?.((rel.cut ? 'Repair' : 'Cut') + ' relay ' + rel.short, clientCutT);
    if (clientCutT >= 1) {
      if (state.isHost()) { rel.cut ? hostRepair(rel.id, state.me) : hostCut(rel.id, state.me); }
      else net.send({ t: rel.cut ? 'repair' : 'cut', id: rel.id, from: state.me });
      clientCutT = 0;
    }
  }

  function hostCut(id, fromId) {
    const r = run(); if (!r || r.netMatchOver) return;
    match.syncRunMode(r);
    const rel = r.relays.find((x) => x.id === id);
    if (!rel || rel.cut) return;
    const m = state.getMode();
    if (m.mode === 'vs' && state.getTeam(fromId) !== m.attackTeam) return;
    rel.cut = true; rel.t = 1; rel.cutting = false; rel._cutAt = performance.now();
    try { rel.o.object?.userData?.setState?.('cut'); } catch (e) {}
    r.cut++;
    game.G.hud.setRelays(r.cut, r.relays.length);
    match.refreshObjectiveUI();
    if (fromId) net.send({ t: 'cutStat', id: fromId });
    if (m.mode === 'vs' && fromId) match.hostApplyAttack(fromId);
    else if (m.mode === 'relays' && fromId) match.hostApplyCut(fromId);
    net.send({ t: 'relay_sync', relays: r.relays.map((x) => ({ id: x.id, cut: x.cut })), cutCount: r.cut, allCut: r.allCut });
  }
  function hostRepair(id, fromId) {
    const r = run(); if (!r || r.netMatchOver) return;
    match.syncRunMode(r);
    if (state.getMode().mode !== 'vs') return;
    const rel = r.relays.find((x) => x.id === id);
    if (!rel || !rel.cut) return;
    const defTeam = state.getMode().attackTeam === 'red' ? 'blue' : 'red';
    if (state.getTeam(fromId) !== defTeam) return;
    rel.cut = false; rel.t = 0; rel.cutting = false; rel._cutAt = null;
    try { rel.o.object?.userData?.setState?.('live'); } catch (e) {}
    r.cut = Math.max(0, r.cut - 1);
    game.G.hud.setRelays(r.cut, r.relays.length);
    match.refreshObjectiveUI();
    game.G.hud?.message?.('Relay ' + rel.short + ' restored', 2);
    if (fromId) { net.send({ t: 'repairStat', id: fromId }); match.hostApplyDefend(fromId); }
    net.send({ t: 'relay_sync', relays: r.relays.map((x) => ({ id: x.id, cut: x.cut })), cutCount: r.cut, allCut: r.allCut });
  }

  function autoRecoverTick() {
    if (!state.isHost()) return;
    const r = run(); if (!r || r.netMatchOver) return;
    if (!Array.isArray(r.relays)) return;
    const m = state.getMode();
    if (m.mode === 'kills') return;
    const RECOVER_MS = m.mode === 'vs' ? 15000 : 10000;
    const now = performance.now();
    let changed = false;
    for (const rel of r.relays) {
      if (rel.cut) {
        if (!rel._cutAt) rel._cutAt = now;
        if (now - rel._cutAt >= RECOVER_MS) {
          rel.cut = false; rel.t = 0; rel.cutting = false; rel._cutAt = null;
          try { rel.o.object?.userData?.setState?.('live'); } catch (e) {}
          r.cut = Math.max(0, (r.cut | 0) - 1);
          changed = true;
        }
      } else if (rel._cutAt) rel._cutAt = null;
    }
    if (changed) {
      game.G.hud.setRelays(r.cut, r.relays.length);
      match.refreshObjectiveUI();
      net.send({ t: 'relay_sync', relays: r.relays.map((x) => ({ id: x.id, cut: x.cut })), cutCount: r.cut, allCut: r.allCut });
    }
  }

  function applySync(m) {
    const r = run(); if (!r) return;
    match.syncRunMode(r);
    if (m.relays) for (const rec of m.relays) {
      const rel = r.relays.find((x) => x.id === rec.id);
      if (rel && rel.cut !== rec.cut) {
        rel.cut = rec.cut; rel.t = rec.cut ? 1 : 0; rel.cutting = false;
        if (rec.cut) { if (!rel._cutAt) rel._cutAt = performance.now(); } else rel._cutAt = null;
        try { rel.o.object?.userData?.setState?.(rec.cut ? 'cut' : 'live'); } catch (e) {}
      }
    }
    r.cut = m.cutCount; r.allCut = m.allCut;
    game.G.hud.setRelays(r.cut, r.relays.length);
    match.refreshObjectiveUI();
  }

  // 订阅
  bus.on('net:cut', (m) => { if (state.isHost()) hostCut(m.id, m.from); });
  bus.on('net:repair', (m) => { if (state.isHost()) hostRepair(m.id, m.from); });
  bus.on('net:relay', (m) => { if (!state.isHost()) applySync(m); });
  bus.on('net:relay_sync', (m) => { if (!state.isHost()) applySync(m); });
  bus.on('net:req_relay', () => {
    if (!state.isHost()) return;
    const r = run(); if (!r) return;
    net.send({ t: 'relay_sync', relays: r.relays.map((x) => ({ id: x.id, cut: x.cut })), cutCount: r.cut, allCut: r.allCut });
  });

  return { clientTick, autoRecoverTick, hostCut, hostRepair, applySync };
}