import { fmtTimer } from '../core/util.js';

export function createHud({ state, bus, game }) {
  let scoreboardEl = null, timerEl = null, sbVisible = false;

  function updateOnlineUI() {
    const titleScreen = document.querySelector('.m-title');
    if (!titleScreen) return;
    const eyebrow = titleScreen.querySelector('.m-eyebrow');
    if (!eyebrow) return;
    let el = document.getElementById('online-ui');
    if (!el) {
      el = document.createElement('span');
      el.id = 'online-ui';
      el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;color:#44ff44;font-family:"IBM Plex Mono",monospace;font-size:13px;font-weight:600;letter-spacing:1px;margin-left:12px;';
      eyebrow.appendChild(el);
    }
    const dot = state.getOnlineCount() > 0 ? '●' : '○';
    el.innerHTML = `<span style="font-size:10px;">${dot}</span> ONLINE: ${state.getOnlineCount()}`;
  }

  function initKillFeed() {
    if (document.getElementById('kill-feed')) return;
    const ui = document.createElement('div');
    ui.id = 'kill-feed';
    ui.style.cssText = `position:fixed;top:calc(210px + var(--sat));right:24px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;pointer-events:none;z-index:9500;font-family:'Barlow Condensed',sans-serif;`;
    document.getElementById('ui').appendChild(ui);
  }
  function addKillMsg(killer, victim, assists) {
    const ui = document.getElementById('kill-feed'); if (!ui) return;
    const el = document.createElement('div');
    el.style.cssText = `background:rgba(11,13,15,0.8);border-left:2px solid var(--bone-faint);padding:4px 10px;font-size:15px;color:#eee;letter-spacing:1px;white-space:nowrap;transition:opacity 0.5s;`;
    const killerCol = killer === 'MACHINE' ? '#ff4444' : '#44ff44';
    const victimCol = victim === 'MACHINE' || victim === 'GULL' || victim === 'HOUND' ? '#ff4444' : '#fff';
    let assistHtml = '';
    if (Array.isArray(assists) && assists.length) {
      const names = assists.filter((n) => n && n !== killer && n !== victim).slice(0, 3);
      if (names.length) assistHtml = ` <span style="color:#8d9aa3;font-size:12px;">+${names.join(', ')}</span>`;
    }
    el.innerHTML = `<span style="color:${killerCol};font-weight:700;">${killer}</span> <span style="color:#aaa;font-size:12px;margin:0 4px;">✖</span> <span style="color:${victimCol};font-weight:600;">${victim}</span>${assistHtml}`;
    ui.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 3500);
  }

  function initMatchTimer() {
    if (document.getElementById('match-timer')) return;
    timerEl = document.createElement('div');
    timerEl.id = 'match-timer';
    timerEl.style.cssText = `position:fixed;top:calc(76px + var(--sat));left:50%;transform:translateX(-50%);font-family:'Big Shoulders Display',sans-serif;font-size:48px;font-weight:700;color:#ffcc00;text-shadow:0 2px 12px rgba(0,0,0,0.9),0 0 24px rgba(255,204,0,0.3);letter-spacing:4px;z-index:9100;display:none;pointer-events:none;text-align:center;line-height:1;`;
    document.getElementById('ui').appendChild(timerEl);
  }
  function updateMatchTimer() {
    if (!timerEl) return;
    const G = game.G, r = G.game && G.game.run;
    if (!r || G.game.state !== 'playing' || r.netMatchOver) { timerEl.style.display = 'none'; return; }
    timerEl.style.display = 'block';
    if (r.netOvertime) {
      timerEl.style.color = '#ff4444';
      timerEl.innerHTML = `加时 · ${fmtTimer(r.netOvertimeTimer)}<br><span style="font-size:18px;color:#fff;letter-spacing:2px;">先到 ${r.netOvertimeTarget} 胜</span>`;
    } else {
      timerEl.style.color = r.netTimer < 30 ? '#ff4444' : '#ffcc00';
      timerEl.textContent = fmtTimer(r.netTimer);
    }
  }

  function initScoreboard() {
    if (document.getElementById('scoreboard')) return;
    scoreboardEl = document.createElement('div');
    scoreboardEl.id = 'scoreboard';
    scoreboardEl.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(11,13,15,0.96);border:1px solid rgba(232,228,218,0.4);border-top:4px solid var(--signal,#ffb347);padding:26px 34px;min-width:900px;z-index:10000;font-family:'Barlow Condensed',sans-serif;color:#e8e4da;display:none;box-shadow:0 12px 48px rgba(0,0,0,0.85);letter-spacing:1px;`;
    document.getElementById('ui').appendChild(scoreboardEl);
  }
  
  function renderScoreboard() {
    if (!scoreboardEl) return;
    const red = [], blue = [];
    const allScores = state.getAllScores();
    for (const id in allScores) {
      const s = allScores[id] || {};
      const row = {
        name: s.name || state.getName(id) || 'Player',
        kills: s.kills | 0, 
        aiKills: s.aiKills | 0, // 👈 提取 AI 击杀
        deaths: s.deaths | 0, 
        assists: s.assists | 0,
        cuts: s.cuts | 0, 
        repairs: s.repairs | 0, 
        isMe: id === state.me
      };
      if (s.team === 'blue') blue.push(row); else red.push(row);
    }
    const sortFn = (a, b) => (b.kills - a.kills) || (a.deaths - b.deaths) || a.name.localeCompare(b.name);
    red.sort(sortFn); blue.sort(sortFn);
    
    // 👈 渲染行 HTML：加入 AI 击杀
    const rowHtml = (r, color) => `<tr style="${r.isMe ? 'background:rgba(255,179,71,0.14);outline:1px solid rgba(255,179,71,0.5);' : ''}">
      <td style="padding:8px 14px;color:${color};text-align:left;font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">${r.isMe ? '▸ ' : ''}${r.name}</td>
      <td style="padding:8px 14px;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#eee;">${r.kills}</td>
      <td style="padding:8px 14px;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#ffcc00;">${r.aiKills}</td>
      <td style="padding:8px 14px;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#8d9aa3;">${r.deaths}</td>
      <td style="padding:8px 14px;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#ffb347;">${r.assists}</td>
      <td style="padding:8px 14px;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#ffcc00;">${r.cuts}</td>
      <td style="padding:8px 14px;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:16px;color:#44ff88;">${r.repairs}</td>
    </tr>`;
    
    // 👈 表头加入 AI 列，且空数据 colspan 改为 7
    const teamBlock = (label, color, list) => `<div style="flex:1;min-width:0;">
      <div style="font-size:18px;letter-spacing:5px;color:${color};font-weight:700;border-bottom:2px solid ${color};padding-bottom:8px;margin-bottom:10px;">${label}</div>
      <table style="width:100%;border-collapse:collapse;"><thead><tr style="font-size:11px;color:#8d9aa3;letter-spacing:2px;border-bottom:1px solid rgba(255,255,255,0.1);">
        <th style="text-align:left;padding:4px 14px;font-weight:400;">PLAYER</th>
        <th style="text-align:right;padding:4px 14px;font-weight:400;color:#eee;">PVP</th>
        <th style="text-align:right;padding:4px 14px;font-weight:400;color:#ffcc00;">AI</th>
        <th style="text-align:right;padding:4px 14px;font-weight:400;">D</th>
        <th style="text-align:right;padding:4px 14px;font-weight:400;color:#ffb347;">A</th>
        <th style="text-align:right;padding:4px 14px;font-weight:400;color:#ffcc00;">CUT</th>
        <th style="text-align:right;padding:4px 14px;font-weight:400;color:#44ff88;">FIX</th>
      </tr></thead><tbody>${list.map((r) => rowHtml(r, color)).join('') || '<tr><td colspan="7" style="text-align:center;color:#555;padding:16px;font-size:13px;">—</td></tr>'}</tbody></table></div>`;
    
    const m = state.getMode();
    let modeLabel = '';
    if (m.mode === 'vs') { const atk = m.attackTeam === 'red' ? 'RED' : 'BLUE', def = m.attackTeam === 'red' ? 'BLUE' : 'RED'; modeLabel = `VS · ${atk} 拆 / ${def} 修 · ${Math.floor(m.target / 2)} v ${m.target}`; }
    else if (m.mode === 'kills') modeLabel = `KILLS · FIRST TO ${m.target}`;
    else if (m.mode === 'relays') modeLabel = `RELAYS · FIRST TO ${m.target}`;
    if (m.timeScale) modeLabel += ` · ${m.timeScale.toUpperCase()}`;
    
    // 👈 底部图例更新
    scoreboardEl.innerHTML = `<div style="font-family:'Big Shoulders Display',sans-serif;font-size:34px;letter-spacing:8px;text-align:center;margin-bottom:22px;color:#ffcc00;font-weight:900;text-shadow:0 2px 16px rgba(255,204,0,0.3);">SCOREBOARD</div>
      <div style="text-align:center;font-size:13px;color:#ffb347;letter-spacing:4px;margin-bottom:18px;">${modeLabel}</div>
      <div style="display:flex;gap:38px;">${teamBlock('RED TEAM', '#ff5555', red)}${teamBlock('BLUE TEAM', '#5588ff', blue)}</div>
      <div style="text-align:center;font-size:11px;color:#666;margin-top:22px;letter-spacing:3px;">HOLD TAB · PVP=PLAYER KILLS AI=MACHINE KILLS D=DEATHS A=ASSISTS CUT=RELAYS CUT FIX=RELAYS RESTORED</div>`;
  }
  
  function showScoreboard() { if (!scoreboardEl) initScoreboard(); renderScoreboard(); scoreboardEl.style.display = 'block'; sbVisible = true; }
  function hideScoreboard() { if (scoreboardEl) scoreboardEl.style.display = 'none'; sbVisible = false; }
  
  function initScoreboardKey() {
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); e.stopPropagation();
      if (!sbVisible) showScoreboard();
    }, true);
    document.addEventListener('keyup', (e) => {
      if (e.code !== 'Tab') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); e.stopPropagation();
      if (sbVisible) hideScoreboard();
    }, true);
    window.addEventListener('blur', () => { if (sbVisible) hideScoreboard(); });
  }

  // 订阅
  bus.on('state:online', updateOnlineUI);
  bus.on('state:scores', () => { if (sbVisible) renderScoreboard(); });
  bus.on('state:teams-changed', () => { if (sbVisible) renderScoreboard(); });
  bus.on('state:mode', () => { if (sbVisible) renderScoreboard(); });
  bus.on('ui:timer-tick', updateMatchTimer);
  bus.on('ui:scoreboard-refresh', () => { if (sbVisible) renderScoreboard(); });
  bus.on('kill:feed', ({ killer, victim, assists }) => addKillMsg(killer, victim, assists));

  function init() { initKillFeed(); initMatchTimer(); initScoreboard(); initScoreboardKey(); }

  return { init, updateOnlineUI, showScoreboard, hideScoreboard, renderScoreboard };
}