console.log("🔥 MAIN.JS 成功加载！");

import { createBus } from './core/bus.js';
import { createState } from './core/state.js';
import { installRouter } from './router.js';
import { createNet } from './services/net.js';
import { createScoring } from './features/scoring.js';
import { createEntities } from './features/entities.js';
import { createCombat } from './features/combat.js';
import { createMatch } from './features/match.js';
import { createRelay } from './features/relay.js';
import { createHud } from './ui/hud.js';
import { createLobby } from './ui/lobby.js';
import { createIngame } from './ui/ingame.js';
import { installPatches } from './patches.js';
import { installShortcuts } from './core/shortcuts.js';
import { installPointerLock } from './core/pointer-lock.js';
import { installSpectate } from './features/spectate.js';
import { installRespawn } from './features/respawn.js';
import { createModAPI } from './core/mod-api.js';

export async function bootstrap() {
  const params = new URLSearchParams(location.search);
  const SERVER = params.get('net');
  if (!SERVER) return;

  const ME = (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2));

  const bus = createBus();
  const state = createState({ bus, me: ME });

  const waitGame = (fn) => {
    if (window.__G && window.__G.game) return fn();
    setTimeout(() => waitGame(fn), 100);
  };

  waitGame(async () => {
    const game = { G: window.__G };
    const net = createNet({ bus, server: SERVER });

    installShortcuts();
    installPointerLock({ game, bus });

    const scoring = createScoring({ state });
    const entities = createEntities({ state, bus, game });
    const combat = createCombat({ state, bus, game, net, entities });
    const match = createMatch({ state, bus, game, net });
    const relay = createRelay({ state, bus, game, net, match });

    bus.on('combat:hit-confirmed', ({ target, from }) => {
      scoring.recordDamage(target, from, state.getName(from) || state.getPlayerName());
      net.send({ t: 'p_hit', target, dmg: 20, from, fromName: state.getPlayerName() });
      game.G.hud?.hitmarker?.('hit');
    });

    const hud = createHud({ state, bus, game });
    const lobby = createLobby({ state, bus, game, net });
    const ingame = createIngame({ state, bus, game, entities });

    // ==================== 观战 + 复活控制器 ====================
    const spectate = installSpectate({ game, bus, state, entities, net });
    window.__spectate = spectate;

    const respawn = installRespawn({ game, bus, state });
    window.__respawn = respawn;

    installRouter({ bus, state });
    installPatches({ bus, state, game, net, match, relay, combat, entities, scoring });

    hud.init();
    lobby.init();
    ingame.init();

    const ModAPI = createModAPI({
      state, bus, game, net, match, relay, combat, entities, scoring, hud, lobby, ingame
    });
    window.SaltlineAPI = ModAPI;

    try {
      console.log('[System] 正在自动扫描 mods 文件夹...');
      const res = await fetch('/api/mods');
      if (!res.ok) throw new Error('API 请求失败');
      const modFiles = await res.json();
      console.log(`[System] 发现 ${modFiles.length} 个 Mod，开始加载...`);

      for (const file of modFiles) {
        try {
          const module = await import(`./mods/${file}`);
          const mod = module.default;
          if (mod && mod.name) ModAPI.register(mod);
          else console.warn(`[Mod Error] ${file} 未导出合法的默认对象`);
        } catch (e) {
          console.error(`[Mod Error] 加载 ${file} 失败:`, e);
        }
      }
    } catch (err) {
      console.warn("⚠️ 无法获取 Mod 列表。", err);
    }

    setInterval(() => {
      if (game.G.game && game.G.game.state === 'title') {
        lobby.initTeamUI();
        hud.updateOnlineUI();
      }
      lobby.updateTeamUI();
      lobby.updateModeUI();
      lobby.updateLobbyUI();
    }, 250);

    window.__relay_state = () => {
      const G = game.G;
      const r = G && G.game && G.game.run;
      const m = state.getMode();
      return {
        isHost: state.isHost(), gameState: G && G.game && G.game.state,
        mode: m.mode, target: m.target, attackTeam: m.attackTeam, timeScale: m.timeScale,
        netTimer: r && r.netTimer, overtime: r && r.netOvertime,
        overtimeTimer: r && r.netOvertimeTimer, matchOver: r && r.netMatchOver,
        winner: r && r.netWinner, scores: r && r.netScores,
        onlineCount: state.getOnlineCount(),
        spectateActive: window.__spectateActive,
        deadState: window.__respawn?.deadState?.(),
        respawnCounting: window.__respawn?.isCountingDown?.(),
      };
    };

    bus.on('net:open', () => net.send({ t: 'hello', id: ME, team: state.getMyTeam(), name: state.getPlayerName() }));
    bus.on('net:welcome-applied', () => { lobby.updateModeUI(); lobby.updateLobbyUI(); });
    bus.on('game:start-request', (o) => game.G.game.start(o || {}));
    bus.on('ui:reset-title', () => hud.updateOnlineUI());

    bus.on('net:kill', (m) => {
      if (!m || !m.killerName || !m.victimName) return;
      const assists = scoring.getAssistNames(m.assistIds || [], null);
      bus.emit('kill:feed', { killer: m.killerName, victim: m.victimName, assists });
      const isAi = !m.victimId;
      if (state.isHost() && m.killerId) match.hostApplyKill(m.killerId, isAi);
    });

    // 👻 幽灵模式下免疫伤害
    bus.on('net:p_hit', (m) => {
      if (m.target !== ME) return;
      const G = game.G;
      if (!G.player || !G.player.alive) return;
      if (G.player.invulnerable) return;   // 幽灵免伤
      if (m.fromName) state.setLastAttacker(m.from, m.fromName);
      scoring.recordDamage(ME, m.from, m.fromName);
      G.player.damage(m.dmg, null);
      G.fx.explosion(G.player.pos.clone().setY(G.player.pos.y + 1), 0.1);
    });

    bus.on('net:ph', (m) => {
      if (m.target !== ME || state.isHost()) return;
      const G = game.G;
      if (!G.player || !G.player.alive) return;
      if (G.player.invulnerable) return;   // 幽灵免伤
      const f = m.f ? new G.THREE.Vector3(m.f[0], m.f[1], m.f[2]) : null;
      G.player.damage(m.a, f);
    });

    bus.on('net:pd', (m) => {
      if (m.target !== ME || state.isHost()) return;
      const G = game.G;
      if (!G.player || !G.player.alive) return;
      if (G.player.invulnerable) return;   // 幽灵免伤
      G.player.damage(9999, null);
    });

    bus.on('net:wf', (m) => {
      if (m.id === ME) return;
      const G = game.G;
      const V3 = G.THREE.Vector3;
      const o = new V3(m.o[0], m.o[1], m.o[2]);
      const d = new V3(m.d[0], m.d[1], m.d[2]).normalize();
      const mu = m.m ? new V3(m.m[0], m.m[1], m.m[2]) : o.clone().addScaledVector(d, 0.5);
      const hit = G.physics.raycast(o, d, 200);
      const end = hit ? hit.point.clone() : o.clone().addScaledVector(d, 200);
      G.fx.tracer(mu, end);
      G.fx.muzzleFlash(mu, d, { scale: 1 });
      try { G.audio.play('rifle_shot', { pos: [mu.x, mu.y, mu.z] }); } catch (e) {}
    });

    bus.on('net:ef_custom', (m) => {
      if (state.isHost() || m.target !== ME) return;
      const G = game.G;
      const V3 = G.THREE.Vector3;
      const from = new V3(m.p[0], m.p[1], m.p[2]);
      const d = new V3(m.d[0], m.d[1], m.d[2]).normalize();
      try {
        const dmg = m.ty === 'gull' ? 6 : 5;
        if (G.combat && typeof G.combat.enemyShot === 'function') G.combat.enemyShot(from, d, { damage: dmg, range: 200 });
      } catch (e) {}
      const hit = G.physics.raycast(from, d, 200);
      const to = hit ? hit.point.clone() : from.clone().addScaledVector(d, 200);
      G.fx.tracer(from, to, { color: 16760944, speed: 260, width: 0.035 });
      G.fx.muzzleFlash(from, d, { scale: 0.9 });
      try { G.audio.play('gull_fire', { pos: [from.x, from.y, from.z] }); } catch (e) {}
    });

    bus.on('net:ex', (m) => {
      if (state.isHost()) return;
      const G = game.G;
      const p = new G.THREE.Vector3(m.p[0], m.p[1], m.p[2]);
      G.fx.explosion(p, m.s);
    });

    bus.on('net:shot', (m) => {
      if (!state.isHost()) return;
      const G = game.G;
      const V3 = G.THREE.Vector3;
      const o = new V3(m.o[0], m.o[1], m.o[2]);
      const d = new V3(m.d[0], m.d[1], m.d[2]).normalize();
      G._currentShooter = { id: m.from || null, name: state.getName(m.from) || 'Player' };
      try { G._netOrigShot(o, d, {}); } catch (e) {}
      G._currentShooter = null;
    });

    bus.on('net:gs', (m) => {
      const G = game.G;
      if (m.s === 'paused' && G.game.state === 'playing') { try { G.game.pause(); } catch (e) {} }
      else if (m.s === 'playing' && G.game.state === 'paused') { try { G.game.resume(); } catch (e) {} }
    });

    let lastT = performance.now();
    function tick() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      entities.updateRemotes(dt);
      ingame.drawMinimap();
      ingame.updateSquadUI();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    net.connect();
  });
}