import { MM } from '../core/constants.js';

export function createIngame({ state, bus, game, entities }) {
  let fsInitialized = false;
  let mmCanvas = null, mmCtx = null, mapBaseCanvas = null;
  let squadUI = null;
  const squadElements = new Map();

  function initFullscreenAndExit() {
    if (fsInitialized) return;
    fsInitialized = true;
    const injectExitBtn = () => {
      const actions = document.querySelector('.m-screen[data-s="paused"] .m-actions');
      if (actions && !document.getElementById('btn-exit-title')) {
        const btn = document.createElement('button');
        btn.id = 'btn-exit-title';
        btn.className = 'btn';
        btn.style.cssText = 'border-color: #ff4444; color: #ff4444;';
        btn.textContent = 'EXIT TO TITLE';
        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); bus.emit('game:reset-title-request'); if (state.isHost()) bus.emit('net:send', { t: 'back_title' }); };
        actions.appendChild(btn);
      }
    };
    setInterval(injectExitBtn, 1000);
    injectExitBtn();

    // 只保留全屏请求；复活倒计时交给 features/respawn.js + patches.js 处理
    document.addEventListener('click', (e) => {
      const isDeploy = e.target.closest('button[data-act="deploy"]');
      const isRedeploy = e.target.closest('button[data-act="redeploy"]');
      if (!isDeploy && !isRedeploy) return;
      if (isDeploy && !allPlayersReadyHelper()) return;
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }, true);

    const checkFs = () => {
      if (!game.G || !game.G.game) return;
      const st = game.G.game.state;
      if (st === 'playing') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); }
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    game.G.events?.on('game:state', checkFs);
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && game.G.game && game.G.game.state === 'playing') game.G.game.pause?.(); });
    document.addEventListener('contextmenu', (e) => {
      const t = document.activeElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('auxclick', (e) => { if (e.button === 1 || e.button === 2) e.preventDefault(); }, { passive: false });
  }

  function allPlayersReadyHelper() {
    const ids = new Set(Object.keys(state.getTeamDict())); ids.add(state.me);
    if (ids.size === 0) return false;
    for (const id of ids) {
      const t = id === state.me ? state.getMyTeam() : state.getTeam(id);
      if (t !== 'red' && t !== 'blue') return false;
    }
    return true;
  }

  // ==================== 观战 UI ====================
  function initSpectateUI() {
    if (document.getElementById('spectate-ui')) return;
    const el = document.createElement('div');
    el.id = 'spectate-ui';
    el.style.cssText = 'position:fixed;bottom:110px;left:50%;transform:translateX(-50%);font-family:"Barlow Condensed",sans-serif;color:#fff;text-align:center;z-index:9500;pointer-events:none;display:none;text-shadow:0 0 10px #000;';
    el.innerHTML = `
      <div style="font-size:13px;letter-spacing:4px;color:#ff4444;margin-bottom:6px;">💀 观战中</div>
      <div id="spectate-target" style="font-size:20px;font-weight:700;letter-spacing:2px;margin-bottom:4px;">无存活队友</div>
      <div style="font-size:11px;color:#aaa;letter-spacing:1px;">视角自动跟随 &nbsp;|&nbsp; Q / E · 滚轮 切换目标</div>
    `;
    document.getElementById('ui').appendChild(el);

    bus.on('ui:spectate-enter', () => { el.style.display = 'block'; });
    bus.on('ui:spectate-exit', () => { el.style.display = 'none'; });
    bus.on('ui:spectate-target', ({ index, total, name }) => {
      const t = document.getElementById('spectate-target');
      if (!t) return;
      if (total === 0) t.textContent = '无存活队友';
      else t.textContent = `观测目标 ${index + 1}/${total} · ${name || '?'}`;
    });
  }

  // ==================== 小队 UI ====================
  function initSquadUI() {
    if (document.getElementById('squad-ui')) return;
    squadUI = document.createElement('div');
    squadUI.id = 'squad-ui';
    squadUI.style.cssText = `position:fixed;left:24px;bottom:80px;display:none;flex-direction:column;gap:6px;pointer-events:none;z-index:9000;font-family:'Barlow Condensed',sans-serif;`;
    document.getElementById('ui').appendChild(squadUI);
  }
  function updateSquadUI() {
    if (!squadUI || !game.G || !game.G.game) return;
    if (game.G.game.state === 'playing') squadUI.style.display = 'flex'; else { squadUI.style.display = 'none'; return; }
    const allies = [];
    for (const [id, rem] of entities.getRemotes()) if (entities.isAlly(id)) allies.push([id, rem]);
    for (const [id, el] of squadElements) if (!entities.getRemotes().has(id) || !entities.isAlly(id)) { el.remove(); squadElements.delete(id); }
    for (const [id, rem] of allies) {
      let el = squadElements.get(id);
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = `display:flex;align-items:center;gap:8px;background:rgba(11,13,15,0.6);padding:4px 8px;border-left:2px solid #44ff44;`;
        el.innerHTML = `<span class="squad-name" style="color:#fff;font-size:14px;letter-spacing:1px;width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span><div style="width:60px;height:6px;background:#333;position:relative;"><div class="hp-bar" style="width:100%;height:100%;background:#44ff44;"></div></div><span class="hp-text" style="color:#44ff44;font-size:12px;width:24px;text-align:right;">100</span>`;
        squadUI.appendChild(el); squadElements.set(id, el);
      }
      const displayName = state.getName(id) || id.slice(0, 5);
      const nameSpan = el.querySelector('.squad-name');
      if (nameSpan.textContent !== displayName) nameSpan.textContent = displayName;
      const hp = Math.max(0, rem.lastHp !== undefined ? rem.lastHp : 100);
      const hpColor = hp > 50 ? '#44ff44' : hp > 20 ? '#ffcc00' : '#ff4444';
      const bar = el.querySelector('.hp-bar'), txt = el.querySelector('.hp-text');
      if (bar.style.width !== `${hp}%`) { bar.style.width = `${hp}%`; bar.style.background = hpColor; txt.textContent = Math.ceil(hp); txt.style.color = hpColor; el.style.borderLeftColor = hpColor; }
    }
  }

  function initMinimap() {
    if (document.getElementById('minimap')) return;
    mmCanvas = document.createElement('canvas');
    mmCanvas.id = 'minimap';
    mmCanvas.width = MM.SIZE; mmCanvas.height = MM.SIZE;
    mmCanvas.style.cssText = `position:fixed;top:24px;right:24px;width:${MM.SIZE}px;height:${MM.SIZE}px;background:rgba(11,13,15,0.85);border:1.5px solid rgba(232,228,218,0.6);border-radius:50%;pointer-events:none;z-index:9000;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
    document.getElementById('ui').appendChild(mmCanvas);
    mmCtx = mmCanvas.getContext('2d');
  }
  function buildMapBase() {
    if (mapBaseCanvas) return;
    const w = MM.WIDTH * MM.BASE_RES, h = MM.HEIGHT * MM.BASE_RES;
    mapBaseCanvas = document.createElement('canvas');
    mapBaseCanvas.width = w; mapBaseCanvas.height = h;
    const ctx = mapBaseCanvas.getContext('2d');
    ctx.fillStyle = '#182024'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
    for (let i = 0; i <= w; i += 10 * MM.BASE_RES) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    const boxes = game.G.physics && game.G.physics.boxes ? game.G.physics.boxes : [];
    for (const box of boxes) {
      const bw = box.max.x - box.min.x, bd = box.max.z - box.min.z, bh = box.max.y - box.min.y;
      if (bw < 0.5 || bd < 0.5) continue;
      const px = (box.min.x + MM.OFFSET_X) * MM.BASE_RES, pz = (box.min.z + MM.OFFSET_Z) * MM.BASE_RES;
      const pw = bw * MM.BASE_RES, ph = bd * MM.BASE_RES;
      if (bh > 3) { ctx.fillStyle = '#2d363c'; ctx.strokeStyle = '#414d55'; }
      else if (bh > 1) { ctx.fillStyle = '#222b30'; ctx.strokeStyle = '#333f47'; }
      else { ctx.fillStyle = 'rgba(34,43,48,0.4)'; ctx.strokeStyle = 'rgba(65,77,85,0.4)'; }
      ctx.fillRect(px, pz, pw, ph); ctx.lineWidth = 1.5; ctx.strokeRect(px, pz, pw, ph);
    }
  }
  function drawMinimap() {
    const G = game.G;
    if (!mmCtx || !G || !G.player) return;
    if (G.game.state === 'playing') mmCanvas.style.display = 'block'; else { mmCanvas.style.display = 'none'; return; }
    if (!mapBaseCanvas) { if (G.physics && G.physics.boxes && G.physics.boxes.length > 0) buildMapBase(); else return; }
    const ctx = mmCtx, R = MM.SIZE / 2;
    ctx.clearRect(0, 0, MM.SIZE, MM.SIZE);
    ctx.save(); ctx.translate(R, R); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
    const cx = G.player.pos.x, cz = G.player.pos.z;
    const viewW = MM.SIZE / MM.SCALE, viewH = MM.SIZE / MM.SCALE;
    const sx = (cx + MM.OFFSET_X) * MM.BASE_RES - (viewW * MM.BASE_RES) / 2;
    const sy = (cz + MM.OFFSET_Z) * MM.BASE_RES - (viewH * MM.BASE_RES) / 2;
    ctx.drawImage(mapBaseCanvas, sx, sy, viewW * MM.BASE_RES, viewH * MM.BASE_RES, -R, -R, MM.SIZE, MM.SIZE);
    const toMap = (wx, wz) => ({ x: (wx - cx) * MM.SCALE, z: (wz - cz) * MM.SCALE });
    if (G.game && G.game.run && G.game.run.relays) for (const r of G.game.run.relays) {
      if (r.cut) continue;
      const pos = toMap(r.o.pos.x, r.o.pos.z);
      ctx.fillStyle = '#ffcc00'; ctx.shadowColor = '#ffcc00'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(pos.x, pos.z, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    const cameraRange = 70, rays = 24, halfFov = Math.acos(0.4);
    const drawRayCone = (wx, wz, wyaw, color, alpha) => {
      const origin = toMap(wx, wz);
      const eye = new G.THREE.Vector3(wx, G.player.pos.y + 1.6, wz);
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(origin.x, origin.z);
      for (let i = 0; i <= rays; i++) {
        const a = wyaw - halfFov + 2 * halfFov * (i / rays);
        const dir = new G.THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
        let dist = cameraRange;
        try { const hit = G.physics.raycast(eye, dir, cameraRange); if (hit) dist = hit.dist; } catch (e) {}
        const hp = toMap(wx + dir.x * dist, wz + dir.z * dist);
        ctx.lineTo(hp.x, hp.z);
      }
      ctx.closePath(); ctx.fill(); ctx.restore();
    };
    drawRayCone(cx, cz, G.player.yaw, '#ffffff', 0.15);
    for (const [id, rem] of entities.getRemotes()) { if (!rem.group.visible || !entities.isAlly(id)) continue; drawRayCone(rem.group.position.x, rem.group.position.z, rem.group.rotation.y, '#44ff88', 0.2); }
    ctx.save(); ctx.rotate(-G.player.yaw);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    for (const [id, rem] of entities.getRemotes()) {
      if (!rem.group.visible) continue;
      const ally = entities.isAlly(id);
      if (!ally && !state.hasVisible(id)) continue;
      const pos = toMap(rem.group.position.x, rem.group.position.z);
      if (pos.x * pos.x + pos.z * pos.z > (R + 20) * (R + 20)) continue;
      ctx.save(); ctx.translate(pos.x, pos.z); ctx.rotate(-rem.group.rotation.y);
      ctx.fillStyle = ally ? '#44ff44' : '#ff4444';
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }

  bus.on('ui:reset-title', () => { updateSquadUI(); });

  function init() {
    initMinimap();
    initSquadUI();
    initFullscreenAndExit();
    initSpectateUI();
  }
  return { init, updateSquadUI, drawMinimap, initMinimap, initSquadUI, initFullscreenAndExit, initSpectateUI };
}