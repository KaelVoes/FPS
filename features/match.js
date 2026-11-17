import { getMatchTime } from '../core/constants.js';

export function createMatch({ state, bus, game, net }) {
  let lastAppliedModeSig = '';

  function run() { return game.G.game && game.G.game.run; }

  // ==================== 模式同步 ====================
  function syncRunMode(r) {
    if (!r) return;
    const m = state.getMode();
    r.netMode = m.mode; r.netTarget = m.target; r.attackTeam = m.attackTeam;
    if (!r.netScores || typeof r.netScores !== 'object') {
      r.netScores = m.mode === 'vs' ? { attack: 0, defend: 0 } : { red: 0, blue: 0 };
    } else if (m.mode === 'vs') {
      if (typeof r.netScores.attack !== 'number' || typeof r.netScores.defend !== 'number') r.netScores = { attack: 0, defend: 0 };
    } else {
      if (typeof r.netScores.red !== 'number' || typeof r.netScores.blue !== 'number') r.netScores = { red: 0, blue: 0 };
    }
  }

  function refreshObjectiveUI() {
    const r = run(); if (!r) return;
    syncRunMode(r);
    const G = game.G, m = state.getMode();
    const target = m.target, atk = m.attackTeam;
    if (m.mode === 'vs') {
      const a = atk === 'red' ? 'R' : 'B', d = atk === 'red' ? 'B' : 'R';
      const s = r.netScores || { attack: 0, defend: 0 };
      G.hud.setObjective(`VS · ${a}拆 ${s.attack || 0}/${target} · ${d}修 ${s.defend || 0}/${Math.floor(target / 2)}`);
    } else if (m.mode === 'kills') {
      const s = r.netScores || { red: 0, blue: 0 };
      if (r.netOvertime) G.hud.setObjective(`加时 · R ${s.red || 0} / B ${s.blue || 0} · 先到 ${r.netOvertimeTarget}`);
      else G.hud.setObjective(`Kills: R ${s.red || 0} / B ${s.blue || 0} · 目标 ${target}`);
    } else if (m.mode === 'relays') {
      const s = r.netScores || { red: 0, blue: 0 };
      if (r.netOvertime) G.hud.setObjective(`加时 · R ${s.red || 0} / B ${s.blue || 0} · 先到 ${r.netOvertimeTarget}`);
      else G.hud.setObjective(`Cuts: R ${s.red || 0} / B ${s.blue || 0} · 目标 ${target}`);
    }
    const marks = r.relays.filter((x) => !x.cut).map((x) => ({ id: x.id, short: x.short, label: x.o.label, pos: x.o.pos, kind: 'relay' }));
    G.hud.setMarkers(marks);
  }

  // ==================== 标题 / 重置 ====================
  function resetToTitle() {
    const G = game.G;
    if (G.game) {
      G.game.state = 'title';
      G.game.menus?.closePanel?.();
      G.game.menus?.show?.('title');
    }
    if (G.game.run) {
      G.game.run.netMatchOver = false;
      G.game.run.netTimer = -1;
      G.game.run.netWinner = null;
      G.game.run.netOvertime = false;
    }
    if (G.level && G.player) G.player.reset(G.level.playerStart);
    G.enemies?.clear?.();
    G.hud?.show?.(false);
    const debrief = document.querySelector('.m-screen[data-s="complete"]');
    const mh = debrief?.querySelector('.m-h'); if (mh) mh.style.display = '';
    const tEl = document.getElementById('match-timer'); if (tEl) tEl.style.display = 'none';
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    navigator.keyboard?.unlock?.();
    const ui = document.getElementById('team-selector'); if (ui) ui.style.display = 'flex';
    bus.emit('ui:reset-title');
  }

  // ==================== 计时 + 胜负 ====================
  function tickMatchTimer(dt) {
    const G = game.G;
    if (!G.game || G.game.state !== 'playing') return;
    const r = run(); if (!r || r.netMatchOver) return;
    if (r.netTimer > 0) r.netTimer -= dt;
    if (r.netOvertime && r.netOvertimeTimer > 0) r.netOvertimeTimer -= dt;
    if (state.isHost()) checkWinCondition();
    bus.emit('ui:timer-tick');
  }

  function checkWinCondition() {
    const r = run(); if (!r || r.netMatchOver) return;
    const m = state.getMode(), s = r.netScores || {}, target = r.netTarget || 10;
    if (m.mode === 'vs') {
      if ((s.attack || 0) >= target) return endMatch(m.attackTeam, 'attack');
      if (r.netTimer <= 0) return endMatch(m.attackTeam === 'red' ? 'blue' : 'red', 'defend');
      return;
    }
    if (m.mode === 'kills' || m.mode === 'relays') {
      const red = s.red || 0, blue = s.blue || 0;
      if (!r.netOvertime) {
        if (red >= target) return endMatch('red', m.mode);
        if (blue >= target) return endMatch('blue', m.mode);
        if (r.netTimer <= 0) {
          if (red > blue) endMatch('red', 'time');
          else if (blue > red) endMatch('blue', 'time');
          else startOvertime(m.mode);
        }
      } else {
        if (red >= r.netOvertimeTarget) return endMatch('red', 'overtime');
        if (blue >= r.netOvertimeTarget) return endMatch('blue', 'overtime');
        if (r.netOvertimeTimer <= 0) {
          if (red > blue) endMatch('red', 'overtime_time');
          else if (blue > red) endMatch('blue', 'overtime_time');
          else endMatch(null, 'draw');
        }
      }
    }
  }

  function startOvertime(mode) {
    const r = run(); if (!r || r.netOvertime) return;
    r.netOvertime = true; r.netOvertimeTimer = 60;
    r.netOvertimeTarget = mode === 'kills' ? 10 : 5;
    r.netTimer = 0;
    net.send({ t: 'overtime', target: r.netOvertimeTarget, timer: 60, mode });
    game.G.hud?.warn?.('OVERTIME · FIRST TO ' + r.netOvertimeTarget, 4);
    bus.emit('ui:scoreboard-refresh');
  }

  function endMatch(winnerTeam, source) {
    const r = run(); if (!r || r.netMatchOver) return;
    r.netMatchOver = true; r.netWinner = winnerTeam;
    const label = !winnerTeam ? 'DRAW' : (winnerTeam === 'red' ? 'RED WINS' : 'BLUE WINS');
    net.send({ t: 'match_end', winnerSide: winnerTeam, winnerLabel: label, source, scores: r.netScores });
    clientMatchEnd(winnerTeam, label, r.netScores, source);
  }

  function clientMatchEnd(winnerSide, winnerLabel, scores, source) {
    const G = game.G, r = run(); if (!r) return;
    r.netWinner = winnerSide; r.netMatchOver = true;
    if (G.player) { G.player.enabled = false; G.player.invulnerable = true; G.player.vel?.set(0, 0, 0); }
    G.input?.setGameplay?.(false);
    G.input?.exitLock?.();
    const debrief = document.querySelector('.m-screen[data-s="complete"]');
    if (debrief) {
      const mk = debrief.querySelector('.m-k'); if (mk) mk.textContent = 'MATCH OVER';
      const mh = debrief.querySelector('.m-h'); if (mh) mh.style.display = 'none';
      const rs = debrief.querySelector('.m-rating span'); if (rs) rs.textContent = 'RESULT';
      const rb = debrief.querySelector('.m-rating b');
      if (rb) rb.style.color = winnerLabel === 'DRAW' ? '#ffcc00' : (winnerLabel.startsWith('RED') ? '#ff5555' : '#5588ff');
    }
    const combat = G.combat?.stats || { shots: 0, hits: 0, kills: 0 };
    const accuracy = combat.shots > 0 ? Math.min(1, combat.hits / combat.shots) : null;
    G.game.menus?.setDebrief?.({ time: r.time, accuracy, kills: combat.kills || 0, retries: r.retries, rating: winnerLabel });
    G.game.state = 'complete';
    G.game.menus?.show?.('complete');
    G.events.emit('game:state', { state: 'complete', prev: 'playing' });
  }

  function applyModeToRun(force) {
    const r = run(); if (!r) return;
    syncRunMode(r);
    const needReset = force || r.netTimer == null || r.netTimer < 0 || isNaN(r.netTimer) || r.netMatchOver;
    if (needReset) {
      const m = state.getMode();
      r.netTimer = getMatchTime(m.mode, m.target, m.timeScale);
      r.netOvertime = false; r.netOvertimeTimer = 0; r.netOvertimeTarget = 0;
      r.netMatchOver = false; r.netWinner = null;
      r.netScores = m.mode === 'vs' ? { attack: 0, defend: 0 } : { red: 0, blue: 0 };
    }
    refreshObjectiveUI();
    const sig = `${state.getMode().mode}|${state.getMode().target}|${state.getMode().attackTeam}|${state.getMode().timeScale}`;
    if (needReset || sig !== lastAppliedModeSig) {
      lastAppliedModeSig = sig;
      const m = state.getMode();
      let txt = '';
      if (m.mode === 'vs') {
        const atk = m.attackTeam === 'red' ? 'RED' : 'BLUE';
        const def = m.attackTeam === 'red' ? 'BLUE' : 'RED';
        txt = `VS · ${atk} 拆 / ${def} 修 · 15 秒自动复位`;
      } else if (m.mode === 'kills') txt = `KILLS · FIRST TO ${m.target}`;
      else if (m.mode === 'relays') txt = `RELAYS · FIRST TO ${m.target} · 10 秒自动复位`;
      if (txt) game.G.hud?.message?.(txt, 4);
    }
  }

  // ==================== 计分（原 scoring 里的 hostApply*，因为要碰 run） ====================
  function hostApplyAttack(cutterId) {
    const r = run(); const m = state.getMode();
    if (!r || m.mode !== 'vs' || r.netMatchOver) return;
    if (state.getTeam(cutterId) !== m.attackTeam) return;
    if (!r.netScores) r.netScores = { attack: 0, defend: 0 };
    r.netScores.attack++;
    refreshObjectiveUI();
    net.send({ t: 'mode_score', mode: 'vs', scores: r.netScores, target: r.netTarget, attackTeam: r.attackTeam });
  }

  function hostApplyDefend(repairerId) {
    const r = run(); const m = state.getMode();
    if (!r || m.mode !== 'vs' || r.netMatchOver) return;
    const defTeam = m.attackTeam === 'red' ? 'blue' : 'red';
    if (state.getTeam(repairerId) !== defTeam) return;
    if (!r.netScores) r.netScores = { attack: 0, defend: 0 };
    r.netScores.defend++;
    r.netScores.attack = Math.max(0, r.netScores.attack - 1);
    refreshObjectiveUI();
    net.send({ t: 'mode_score', mode: 'vs', scores: r.netScores, target: r.netTarget, attackTeam: r.attackTeam });
  }

  function hostApplyKill(killerId, isAi = false) {
    const r = run(); const m = state.getMode();
    if (!r || m.mode !== 'kills' || r.netMatchOver) return;
    
    // 👇 如果是击杀 AI，不计入比赛得分
    if (isAi) return; 

    const team = state.getTeam(killerId);
    if (team !== 'red' && team !== 'blue') return;
    if (!r.netScores) r.netScores = { red: 0, blue: 0 };
    r.netScores[team] = (r.netScores[team] || 0) + 1;
    refreshObjectiveUI();
    net.send({ t: 'mode_score', mode: 'kills', scores: r.netScores, target: r.netTarget });
  }

  function hostApplyCut(cutterId) {
    const r = run(); const m = state.getMode();
    if (!r || m.mode !== 'relays' || r.netMatchOver) return;
    const team = state.getTeam(cutterId);
    if (team !== 'red' && team !== 'blue') return;
    if (!r.netScores) r.netScores = { red: 0, blue: 0 };
    r.netScores[team] = (r.netScores[team] || 0) + 1;
    refreshObjectiveUI();
    net.send({ t: 'mode_score', mode: 'relays', scores: r.netScores, target: r.netTarget });
  }

  // ==================== 订阅 ====================
  bus.on('objective:refresh', refreshObjectiveUI);

  bus.on('net:mode_score', (m) => {
    if (state.isHost()) return;
    const r = run(); if (!r) return;
    syncRunMode(r);
    if (m.scores) r.netScores = m.scores;
    refreshObjectiveUI();
  });

  bus.on('net:timer', (m) => {
    if (state.isHost()) return;
    const r = run(); if (!r) return;
    if (Number.isFinite(m.timer)) r.netTimer = m.timer;
    r.netOvertime = !!m.overtime;
    if (Number.isFinite(m.overtimeTimer)) r.netOvertimeTimer = m.overtimeTimer;
    if (Number.isFinite(m.overtimeTarget)) r.netOvertimeTarget = m.overtimeTarget;
  });

  bus.on('net:overtime', (m) => {
    if (state.isHost()) return;
    const r = run(); if (!r) return;
    r.netOvertime = true;
    r.netOvertimeTimer = m.timer || 60;
    r.netOvertimeTarget = m.target || 10;
    game.G.hud?.warn?.('OVERTIME · FIRST TO ' + r.netOvertimeTarget, 4);
  });

  bus.on('net:match_end', (m) => {
    if (state.isHost()) return;
    clientMatchEnd(m.winnerSide, m.winnerLabel, m.scores || {}, m.source);
  });

  bus.on('game:reset-title-request', resetToTitle);

  bus.on('game:start-denied', () => {
    resetToTitle();
    game.G.hud?.message?.('ALL PLAYERS MUST PICK A TEAM', 3);
  });

  return {
    resetToTitle,
    tickMatchTimer,
    applyModeToRun,
    refreshObjectiveUI,
    syncRunMode,
    clientMatchEnd,
    hostApplyAttack,
    hostApplyDefend,
    hostApplyKill,
    hostApplyCut,
  };
}