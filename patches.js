// patches.js
export function installPatches({ bus, state, game, net, match, relay, combat, entities, scoring }) {
  const G = game.G;

  // ==================== redeploy / deploy 按钮 ====================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="redeploy"], button[data-act="deploy"]');
    if (!btn) return;

    if (window.__respawn && window.__respawn.deadState()) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      window.__respawn.startCountdown();
      return;
    }

    if (btn.dataset.act === 'redeploy') {
      e.preventDefault();
      e.stopPropagation();
      bus.emit('game:reset-title-request');
      if (state.isHost()) net.send({ t: 'back_title' });
    }
  }, true);

  // ==================== G.events 钩子 ====================
  G.events.on('player:hit', (d) => {
    if (d) net.send({ t: 'ph', target: state.me, a: d.amount, f: d.fromPos ? [d.fromPos.x, d.fromPos.y, d.fromPos.z] : null });
    if (d && d.fromPos) state.setLastAttacker(null, 'MACHINE');
  });

  G.events.on('player:dead', () => {
    net.send({ t: 'pd', target: state.me });
    if (!state.isDeadReported()) {
      state.setDeadReported(true);
      const la = state.getLastAttacker();
      const assists = scoring.getAssists(state.me, la.id);
      net.send({ t: 'kill', killerId: la.id || null, killerName: la.name || 'MACHINE', victimId: state.me, victimName: state.getPlayerName(), assistIds: assists });
    }
    state.clearLastAttacker();
  });

  G.events.on('enemy:killed', (d) => {
    if (!d || !d.enemy) return;
    const type = d.enemy.type ? d.enemy.type.toUpperCase() : 'MACHINE';
    const killer = G._currentShooter || { id: state.me, name: state.getPlayerName() };
    net.send({ t: 'kill', killerId: killer.id, killerName: killer.name, victimId: null, victimName: type, assistIds: [] });
    if (state.isHost() && d.enemy._netId != null) net.send({ t: 'ek', id: d.enemy._netId });
  });

  let hasSentStart = false;

  bus.on('ui:reset-title', () => {
    hasSentStart = false;
  });

  G.events.on('game:state', (d) => {
    bus.emit('game:state', d);

    if (d.state === 'title') {
      hasSentStart = false;
      bus.emit('game:reset-title-request');
    }

    if (d.state === 'intro') {
      const r = G.game.run;
      if (r) {
        r.netTimer = -1; r.netOvertime = false; r.netOvertimeTimer = 0;
        r.netOvertimeTarget = 0; r.netMatchOver = false; r.netWinner = null;
        const m = state.getMode();
        r.netScores = m.mode === 'vs' ? { attack: 0, defend: 0 } : { red: 0, blue: 0 };
      }
    }

    if (state.isHost() && d.state === 'intro' && !hasSentStart) {
      hasSentStart = true;
      net.send({ t: 'start', o: {} });
    }

    if (state.isHost()) net.send({ t: 'gs', s: d.state });

    if (!state.isHost() && (d.state === 'intro' || d.state === 'playing') && state.getPendingMode()) {
      state.setMode(state.getPendingMode());
      state.clearPendingMode();
    }

    if (d.state === 'playing') {
      match.applyModeToRun();
      state.setDeadReported(false);
    }

    if (d.state === 'playing' && d.prev === 'intro') {
      const spawns = (G.level.enemySpawns || []).filter((s) => s.type === 'ground');
      if (spawns.length > 0) {
        let best = spawns[0].pos, maxD = -1;
        for (let i = 0; i < 5; i++) {
          const sp = spawns[Math.floor(Math.random() * spawns.length)];
          let minD = 999;
          for (const [, r] of entities.getRemotes()) if (r.group.visible) minD = Math.min(minD, sp.pos.distanceTo(r.group.position));
          if (minD > maxD) { maxD = minD; best = sp.pos; }
        }
        G.player.reset({ pos: best.clone(), yaw: Math.random() * Math.PI * 2 });
        G.hud.message('Spawned', 2);
      }
      if (!state.isHost()) net.send({ t: 'req_relay' });
    }
  });

  G.events.on('weapon:fire', (d) => {
    if (!state.isHost() || !d || !d.origin || !d.dir) return;
    net.send({ t: 'wf', o: [d.origin.x, d.origin.y, d.origin.z], d: [d.dir.x, d.dir.y, d.dir.z], m: d.muzzle ? [d.muzzle.x, d.muzzle.y, d.muzzle.z] : null });
  });

  G.events.on('explosion', (d) => {
    if (!state.isHost() || !d || !d.pos) return;
    net.send({ t: 'ex', p: [d.pos.x, d.pos.y, d.pos.z], s: d.size || 1 });
  });

  G.game.flow.cutSeconds = 1e9;
  G.game.flow.interactRange = 0;

  // ==================== renderer.render 拦截 ====================
  if (G.renderer && typeof G.renderer.render === 'function') {
    const origRender = G.renderer.render.bind(G.renderer);
    G.renderer.render = (scene, camera, ...args) => {
      if (window.__spectateActive && window.__spectate) {
        try { window.__spectate.beforeRender?.(); } catch (e) { console.error('[spectate] beforeRender', e); }
      }
      const result = origRender(scene, camera, ...args);
      if (window.__spectateActive && window.__spectate) {
        try { window.__spectate.afterRender?.(); } catch (e) {}
      }
      return result;
    };
    console.log('[patches] ✅ renderer.render 已拦截');
  }

  // ==================== 拦截 game.update ====================
  const origGameUpdate = G.game.update.bind(G.game);
  G.game.update = (dt) => {
    const r = origGameUpdate(dt);
    try { relay.clientTick(dt); } catch (e) { console.error('[netmod] clientTick', e); }
    try { relay.autoRecoverTick(); } catch (e) { console.error('[netmod] autoRecover', e); }
    try { match.tickMatchTimer(dt); } catch (e) { console.error('[netmod] tickMatchTimer', e); }
    return r;
  };

  // ==================== 拦截 playerShot ====================
  const origShot = G.combat.playerShot.bind(G.combat);
  G._netOrigShot = origShot;
  G.combat.playerShot = (o, d, opt) => {
    if (!state.isHost()) net.send({ t: 'shot', from: state.me, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] });
    combat.localPvPCheck(o, d, state.me);
    return origShot(o, d, opt);
  };

  // ==================== 拦截 enemies.update ====================
  const origEnemiesUpdate = G.enemies.update.bind(G.enemies);
  G.enemies.update = (dt) => {
    if (state.isHost()) {
      const remotes = entities.getRemotes();
      for (const e of G.enemies.list) {
        if (!e.alive) continue;
        let targetPos = G.player && G.player.alive ? G.player.pos : null;
        let targetId = state.me;
        let minDist = targetPos ? e.pos.distanceTo(targetPos) : Infinity;
        const ghostActive = window.__spectateActive && window.__spectate?.isActive?.();

        for (const [id, r] of remotes) {
          if (!r.group.visible) continue;
          if (r.ghost) continue;
          const d2 = e.pos.distanceTo(r.group.position);
          if (d2 < minDist) { minDist = d2; targetPos = r.group.position; targetId = id; }
        }
        if (ghostActive && targetId === state.me) { targetPos = null; }

        if (targetPos && (minDist < 25 || e.mode === 'engage' || e.state === 'chase')) {
          if (minDist < 40) e.lastKnown.copy(targetPos);
          if (minDist < 25) {
            if (e.mode === 'patrol' || e.mode === 'idle') e.mode = 'engage';
            if (e.state === 'patrol' || e.state === 'idle') e.state = 'chase';
          }
          if (targetId !== state.me) {
            if (e.mode === 'engage' || e.los) {
              if (!e._lastNetAtk || performance.now() - e._lastNetAtk > (e.type === 'gull' ? 1000 : 800)) {
                e._lastNetAtk = performance.now();
                const V3 = G.THREE.Vector3;
                const from = e.muzzle || e.pos;
                const d = new V3().subVectors(targetPos, from).normalize();
                d.x += (Math.random() - 0.5) * 0.05;
                d.y += (Math.random() - 0.5) * 0.05;
                d.z += (Math.random() - 0.5) * 0.05;
                d.normalize();
                if (e.type === 'gull') {
                  net.send({ t: 'ef_custom', target: targetId, p: [from.x, from.y, from.z], d: [d.x, d.y, d.z], ty: 'gull' });
                } else if (e.type === 'hound' && minDist < 2) {
                  net.send({ t: 'p_hit', target: targetId, dmg: 15, from: state.me, fromName: 'MACHINE' });
                }
              }
            }
          }
        }
      }
    }
    origEnemiesUpdate(dt);
  };

  // ==================== 定时遥测 ====================
  let nextNetId = 1;
  const _euler = new G.THREE.Euler();
  setInterval(() => {
    if (!G.player) return;
    const p = G.player;
    const seen = combat.updateVision() || [];
    let yaw = p.yaw || 0;
    let pitch = 0;
    try {
      _euler.setFromQuaternion(G.camera.quaternion, 'YXZ');
      yaw = _euler.y;
      pitch = _euler.x;
    } catch (e) {}
    const ghostFlag = (window.__spectateActive && window.__spectate?.isActive?.()) ? 1 : 0;

    // 【B】同步真实 eyeHeight（供观战者准确还原高度）
    const eh = +(p.eyeHeight ?? 1.6).toFixed(2);
    // 【E】同步真实速度（供观战者驱动 bob，避免用位置差分滞后）
    const vx = p.vel ? +p.vel.x.toFixed(2) : 0;
    const vz = p.vel ? +p.vel.z.toFixed(2) : 0;

    net.send({
      t: 'pp', id: state.me,
      x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2),
      yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3),
      hp: p.health | 0, al: p.alive ? 1 : 0,
      seen, ghost: ghostFlag,
      eh, vx, vz,
    });
  }, 33);

  setInterval(() => {
    if (!state.isHost() || !G.enemies) return;
    const list = [];
    for (const e of G.enemies.list) {
      if (!e.alive || !e.active) continue;
      if (e._netId == null) e._netId = nextNetId++;
      list.push({ id: e._netId, ty: e.type, x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2), z: +e.pos.z.toFixed(2), yaw: +e.yaw.toFixed(2), hp: Math.max(0, e.hp | 0) });
    }
    net.send({ t: 'es', s: list });
  }, 50);

  setInterval(() => {
    if (!state.isHost()) return;
    const r = G.game.run;
    if (!r || r.netMatchOver || G.game.state !== 'playing') return;
    net.send({ t: 'timer', timer: +r.netTimer.toFixed(2), overtime: !!r.netOvertime, overtimeTimer: r.netOvertime ? +r.netOvertimeTimer.toFixed(2) : 0, overtimeTarget: r.netOvertimeTarget || 0 });
  }, 500);
}