// ui/lobby.js
import { escapeHtml } from '../core/util.js';
import { getMatchTime } from '../core/constants.js';

const MODE_CONFIG = {
  vs: { targets: [10, 20, 30], labels: ['VS 5v10', 'VS 10v20', 'VS 15v30'] },
  kills: { targets: [25, 50], labels: ['25 KILLS', '50 KILLS'] },
  relays: { targets: [10, 20], labels: ['10 RELAYS', '20 RELAYS'] }
};

export function createLobby({ state, bus, game, net }) {
  let initRetry = 0;

  function canSetMode() {
    if (!game.G || !game.G.game) return false;
    if (game.G.game.state !== 'title') return false;
    return state.isHost();
  }

  function allPlayersReady() {
    const ids = new Set(Object.keys(state.getTeamDict()));
    ids.add(state.me);
    for (const id of ids) {
      const t = id === state.me ? state.getMyTeam() : state.getTeam(id);
      if (t !== 'red' && t !== 'blue') return false;
      if (!state.getReady(id)) return false;
    }
    return true;
  }

  // ==================== 0. 隐藏原生红蓝队伍框和 .m-actions ====================
  // 只隐藏包含"点击加入/点击退出"的最小容器和底部原生按钮区，
  // 保留 PLAYERS 标题与背景，把交互完全交给自定义队伍列表。
  function hideNativeTeamBoxes() {
    if (!game.G || !game.G.game || game.G.game.state !== 'title') return;

    const nativeActions = document.querySelector('.m-actions');
    if (nativeActions) nativeActions.style.display = 'none';

    const titleMain = document.querySelector('.m-title-main');
    if (!titleMain) return;

    const panel = document.getElementById('custom-lobby-panel');
    const hits = [];
    titleMain.querySelectorAll('*').forEach((el) => {
      if (panel && (el === panel || el.contains(panel))) return;
      if (el.closest && el.closest('#custom-lobby-panel')) return;
      const txt = el.textContent || '';
      if (/点击加入|点击退出|CLICK TO JOIN|CLICK TO LEAVE/i.test(txt)) hits.push(el);
    });
    hits.forEach((el) => {
      // 只隐藏最外层，避免对子元素重复隐藏
      if (hits.some((other) => other !== el && other.contains(el))) return;
      el.style.display = 'none';
    });
  }

  // ==================== 1. 构建自定义面板 ====================
  function initTeamUI() {
    if (!game.G || !game.G.game || game.G.game.state !== 'title') return;
    if (document.getElementById('custom-lobby-panel')) return;
    if (initRetry > 60) return;

    const titleMain = document.querySelector('.m-title-main');
    if (!titleMain) { initRetry++; setTimeout(initTeamUI, 100); return; }
    initRetry = 0;

    hideNativeTeamBoxes();

    const ui = document.createElement('div');
    ui.id = 'custom-lobby-panel';
    ui.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:100%;max-width:480px;margin-top:10px;position:relative;z-index:10;pointer-events:auto;';

    const selectStyle = 'flex:1;min-width:0;padding:12px 8px;background-color:#0b0d0f !important;'
      + 'border:1px solid rgba(255,255,255,0.1);color:#ffb347 !important;font-family:"Barlow Condensed",sans-serif;'
      + 'font-size:14px;font-weight:600;letter-spacing:1px;outline:none;cursor:pointer;'
      + 'appearance:none;-webkit-appearance:none;text-align:center;text-align-last:center;'
      + 'transition:all 0.2s;box-sizing:border-box;border-radius:0;color-scheme:dark;pointer-events:auto;';

    const btnStyle = 'padding:12px 8px;background:transparent;'
      + 'border:1px solid rgba(255,255,255,0.2);color:#aaa;font-family:"Barlow Condensed",sans-serif;'
      + 'font-size:14px;font-weight:600;letter-spacing:1px;cursor:pointer;transition:all 0.2s;'
      + 'box-sizing:border-box;border-radius:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;';

    const teamColStyle = 'display:flex;flex-direction:column;background:rgba(11,13,15,0.6);'
      + 'border:1px solid rgba(255,255,255,0.1);padding:8px 10px;cursor:pointer;'
      + 'transition:all 0.2s;min-height:84px;pointer-events:auto;';

    // 布局：队伍两列 → 名字 → 三个下拉 → 攻击方 → 操作
    ui.innerHTML = `
      <!-- 第 0 行：队伍列表（两列，点击切换） -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;">
        <div class="team-col" data-team="red" style="${teamColStyle}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:11px;letter-spacing:3px;font-weight:700;color:#ff5555;">RED TEAM</span>
            <span class="team-count" style="font-size:11px;color:#ff5555;">0</span>
          </div>
          <div class="team-members" style="flex:1;font-size:13px;color:#ff8888;line-height:1.4;overflow:hidden;"></div>
          <div class="team-toggle" style="font-size:10px;letter-spacing:1px;color:#ff5555;opacity:0.7;margin-top:4px;">点击加入</div>
        </div>
        <div class="team-col" data-team="blue" style="${teamColStyle}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:11px;letter-spacing:3px;font-weight:700;color:#5588ff;">BLUE TEAM</span>
            <span class="team-count" style="font-size:11px;color:#5588ff;">0</span>
          </div>
          <div class="team-members" style="flex:1;font-size:13px;color:#88aaff;line-height:1.4;overflow:hidden;"></div>
          <div class="team-toggle" style="font-size:10px;letter-spacing:1px;color:#5588ff;opacity:0.7;margin-top:4px;">点击加入</div>
        </div>
      </div>

      <!-- 第 1 行：名字 -->
      <div style="display:flex;gap:8px;width:100%;">
        <input id="name-input" type="text" maxlength="12" placeholder="YOUR NAME" value="${state.getPlayerName()}" 
          style="flex:1;min-width:0;background-color:#0b0d0f;border:1px solid rgba(255,255,255,0.1);color:#fff;padding:12px;font-family:'IBM Plex Mono',monospace;font-size:14px;outline:none;letter-spacing:1px;text-align:center;box-sizing:border-box;pointer-events:auto;">
        <button id="btn-save-name" class="btn" style="padding:0 24px;background:transparent;border:1px solid rgba(255,255,255,0.2);color:#fff;font-size:14px;font-weight:bold;cursor:pointer;pointer-events:auto;">OK</button>
      </div>

      <!-- 第 2 行：三个下拉 -->
      <div style="display:flex;gap:8px;width:100%;">
        <select id="mode-main-select" style="${selectStyle}">
          <option value="vs" style="background:#0b0d0f;">VS</option>
          <option value="kills" style="background:#0b0d0f;">KILLS</option>
          <option value="relays" style="background:#0b0d0f;">RELAYS</option>
        </select>
        <select id="time-select" style="${selectStyle}">
          <option value="short" style="background:#0b0d0f;">SHORT</option>
          <option value="standard" style="background:#0b0d0f;">STANDARD</option>
          <option value="long" style="background:#0b0d0f;">LONG</option>
        </select>
        <select id="mode-sub-select" style="${selectStyle}"></select>
      </div>

      <!-- 第 3 行：攻击方 -->
      <div id="attack-team-selector" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;">
        <button class="atk-btn" data-attack="red" style="${btnStyle}">RED ATTACKS</button>
        <button class="atk-btn" data-attack="blue" style="${btnStyle}">BLUE ATTACKS</button>
      </div>

      <!-- 第 4 行：准备 + DEPLOY + SETTINGS -->
      <div style="display:flex;gap:8px;width:100%;margin-top:4px;">
        <button id="btn-ready" style="${btnStyle} flex:1.8;">准备</button>
        <button id="custom-deploy" class="btn" style="flex:1.8;padding:12px;background:#ffb347;color:#000;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:bold;letter-spacing:2px;cursor:pointer;border:none;pointer-events:auto;">DEPLOY</button>
        <button id="custom-settings" class="btn" style="flex:1;padding:12px;background:transparent;color:#aaa;border:1px solid rgba(255,255,255,0.2);font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:600;letter-spacing:1px;cursor:pointer;pointer-events:auto;">SETTINGS</button>
      </div>
    `;

    titleMain.appendChild(ui);
    hideNativeTeamBoxes();
    setTimeout(hideNativeTeamBoxes, 500);
    setTimeout(hideNativeTeamBoxes, 1500);

    // ---------- 队伍列点击切换 ----------
    ui.querySelectorAll('.team-col').forEach((col) => {
      col.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (game.G.game.state !== 'title') return;
        const team = col.dataset.team;
        const myTeam = state.getMyTeam();
        const newTeam = myTeam === team ? null : team; // 点自己所在队 = 退出
        state.setMyTeam(newTeam);
        if (state.getReady(state.me)) {
          state.setReady(state.me, false);
          net.send({ t: 'ready', ready: false });
        }
        net.send({ t: 'set_team', team: newTeam });
        updateTeamUI();
      });
    });

    // ---------- 名字 ----------
    const input = ui.querySelector('#name-input');
    const btnSave = ui.querySelector('#btn-save-name');
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') btnSave.click(); });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    btnSave.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      state.setPlayerName(input.value.trim() || 'Player');
      if (net.isOpen() && game.G.game.state === 'title') {
        net.send({ t: 'hello', id: state.me, team: state.getMyTeam(), name: state.getPlayerName() });
      }
      updateTeamUI();
    });

    // ---------- 模式下拉 ----------
    const mainSelect = ui.querySelector('#mode-main-select');
    const subSelect = ui.querySelector('#mode-sub-select');
    mainSelect.addEventListener('change', (e) => {
      if (!canSetMode()) { e.target.value = state.getMode().mode; return; }
      const mode = e.target.value;
      const cfg = MODE_CONFIG[mode];
      const target = cfg ? cfg.targets[0] : 1;
      state.patchMode({ mode, target });
      const payload = { t: 'set_mode', mode, target };
      if (mode === 'vs') payload.attackTeam = state.getMode().attackTeam;
      net.send(payload);
    });
    subSelect.addEventListener('change', (e) => {
      if (!canSetMode()) { e.target.value = String(state.getMode().target); return; }
      const target = +e.target.value;
      const curMode = state.getMode().mode;
      state.patchMode({ target });
      if (curMode === 'vs') net.send({ t: 'set_mode', mode: curMode, target, attackTeam: state.getMode().attackTeam });
      else net.send({ t: 'set_mode', mode: curMode, target });
    });

    // ---------- 攻击方 ----------
    ui.querySelectorAll('button[data-attack]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!canSetMode()) return;
        const attackTeam = btn.dataset.attack === 'blue' ? 'blue' : 'red';
        state.patchMode({ attackTeam });
        const m = state.getMode();
        net.send({ t: 'set_mode', mode: m.mode, target: m.target, attackTeam });
      });
    });

    // ---------- 时间下拉 ----------
    const timeSelect = ui.querySelector('#time-select');
    timeSelect.addEventListener('change', (e) => {
      if (!canSetMode()) { e.target.value = state.getMode().timeScale; return; }
      const scale = e.target.value;
      timeSelect.dataset.lastSent = scale;
      state.patchMode({ timeScale: scale });
      net.send({ t: 'set_time', scale });
    });

    // ---------- 准备 ----------
    const btnReady = ui.querySelector('#btn-ready');
    btnReady.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (game.G.game.state !== 'title') return;
      if (!state.getMyTeam()) { game.G.hud?.message?.('请先选择队伍！', 2); return; }
      const isReady = !state.getReady(state.me);
      state.setReady(state.me, isReady);
      net.send({ t: 'ready', ready: isReady });
      updateReadyUI();
    };

    // ---------- DEPLOY（代理原生） ----------
    ui.querySelector('#custom-deploy').onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const btn = document.querySelector('button[data-act="deploy"]');
      if (btn) btn.click();
    };

    // ---------- SETTINGS（代理原生，修复失效） ----------
    ui.querySelector('#custom-settings').onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      // 1) 优先 data-act，避免文本匹配不稳定
      let nativeSet = document.querySelector('button[data-act="settings"]');
      // 2) 回退：文本匹配，且排除自定义面板内的按钮，防止点到自己
      if (!nativeSet) {
        nativeSet = Array.from(document.querySelectorAll('button')).find(
          (b) => !ui.contains(b) && b.textContent.trim().toUpperCase() === 'SETTINGS'
        );
      }
      if (nativeSet) nativeSet.click();
      else game.G.hud?.message?.('SETTINGS 不可用', 2);
    };

    updateTeamUI();
    updateModeUI();
  }

  // ==================== 2. 状态更新 ====================
  function updateReadyUI() {
    const btnReady = document.getElementById('btn-ready');
    if (!btnReady) return;
    const myTeam = state.getMyTeam();
    const isReady = state.getReady(state.me);
    if (!myTeam) {
      btnReady.textContent = '准备';
      btnReady.style.color = '#555'; btnReady.style.borderColor = '#555';
      btnReady.style.background = 'transparent'; btnReady.style.cursor = 'not-allowed';
    } else if (isReady) {
      btnReady.textContent = '已准备';
      btnReady.style.color = '#44ff44'; btnReady.style.borderColor = '#44ff44';
      btnReady.style.background = 'rgba(68,255,68,0.15)'; btnReady.style.cursor = 'pointer';
    } else {
      btnReady.textContent = '准备';
      btnReady.style.color = '#ffb347'; btnReady.style.borderColor = '#ffb347';
      btnReady.style.background = 'rgba(255,179,71,0.1)'; btnReady.style.cursor = 'pointer';
    }
  }

  function updateTeamUI() {
    const ui = document.getElementById('custom-lobby-panel');
    if (!ui) return;
    if (game.G.game.state !== 'title') { ui.style.display = 'none'; return; }
    ui.style.display = 'flex';

    const myTeam = state.getMyTeam();

    // 收集所有玩家（自己 + teamDict）
    const ids = new Set(Object.keys(state.getTeamDict()));
    ids.add(state.me);
    const red = [], blue = [];
    for (const id of ids) {
      const t = id === state.me ? state.getMyTeam() : state.getTeam(id);
      const rawName = id === state.me ? state.getPlayerName() : (state.getName(id) || 'Player');
      const entry = {
        name: escapeHtml(rawName),
        isMe: id === state.me,
        isHost: id === state.getHostId(),
        isReady: state.getReady(id)
      };
      if (t === 'red') red.push(entry);
      else if (t === 'blue') blue.push(entry);
    }

    const renderCol = (team, list) => {
      const col = ui.querySelector(`.team-col[data-team="${team}"]`);
      if (!col) return;
      const color = team === 'red' ? '#ff5555' : '#5588ff';
      const rgb = team === 'red' ? '255,68,68' : '68,136,255';
      const active = myTeam === team;

      col.style.border = active ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.1)';
      col.style.background = active ? `rgba(${rgb},0.1)` : 'rgba(11,13,15,0.6)';

      col.querySelector('.team-count').textContent = list.length;

      const membersEl = col.querySelector('.team-members');
      if (list.length === 0) {
        membersEl.innerHTML = '<span style="opacity:0.4;">—</span>';
      } else {
        membersEl.innerHTML = list.map((p) => `
          <div style="font-size:13px;color:${color};line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${p.isMe ? '▸ ' : ''}${p.name}
            ${p.isReady ? '<span style="font-size:9px;color:#44ff44;">✓</span>' : ''}
            ${p.isHost ? '<span style="font-size:9px;color:#ffb347;">HOST</span>' : ''}
          </div>
        `).join('');
      }

      const toggle = col.querySelector('.team-toggle');
      toggle.textContent = active ? '点击退出' : '点击加入';
      toggle.style.color = color;
      toggle.style.opacity = active ? '1' : '0.7';
    };

    renderCol('red', red);
    renderCol('blue', blue);
    updateReadyUI();
  }

  function updateModeUI() {
    const container = document.getElementById('custom-lobby-panel');
    if (!container) return;
    const host = canSetMode();
    const m = state.getMode();

    const mainSelect = container.querySelector('#mode-main-select');
    if (mainSelect) {
      if (!mainSelect.querySelector(`option[value="${m.mode}"]`)) {
        const opt = document.createElement('option');
        opt.value = m.mode; opt.textContent = m.mode.toUpperCase();
        opt.style.background = '#0b0d0f';
        mainSelect.appendChild(opt);
      }
      mainSelect.value = m.mode;
      mainSelect.disabled = !host;
      mainSelect.style.color = host ? '#ffb347' : '#555';
      mainSelect.style.cursor = host ? 'pointer' : 'not-allowed';
    }

    const subSelect = container.querySelector('#mode-sub-select');
    if (subSelect) {
      const cfg = MODE_CONFIG[m.mode];
      if (!cfg) {
        subSelect.style.display = 'none';
      } else {
        subSelect.style.display = 'block';
        if (subSelect.dataset.sig !== m.mode) {
          subSelect.dataset.sig = m.mode;
          subSelect.innerHTML = cfg.targets.map((t, i) =>
            `<option value="${t}" style="background:#0b0d0f;">${cfg.labels[i]}</option>`
          ).join('');
        }
        subSelect.value = String(m.target);
        subSelect.disabled = !host;
        subSelect.style.color = host ? '#ffb347' : '#555';
        subSelect.style.cursor = host ? 'pointer' : 'not-allowed';
      }
    }

    const atkSel = container.querySelector('#attack-team-selector');
    if (atkSel) {
      atkSel.style.display = m.mode === 'vs' ? 'grid' : 'none';
      atkSel.querySelectorAll('button[data-attack]').forEach((btn) => {
        const active = btn.dataset.attack === m.attackTeam;
        btn.style.border = active ? '1px solid #ffb347' : '1px solid rgba(255,255,255,0.1)';
        btn.style.color = active ? '#ffb347' : '#aaa';
        btn.style.background = active ? 'rgba(255,179,71,0.15)' : 'transparent';
        btn.style.opacity = host && m.mode === 'vs' ? '1' : '0.5';
        btn.style.cursor = host && m.mode === 'vs' ? 'pointer' : 'not-allowed';
      });
    }

    const timeSelect = container.querySelector('#time-select');
    if (timeSelect) {
      if (timeSelect.dataset.lastSent === m.timeScale) delete timeSelect.dataset.lastSent;
      if (!timeSelect.dataset.lastSent && document.activeElement !== timeSelect) {
        timeSelect.value = m.timeScale;
      }
      timeSelect.disabled = !host;
      timeSelect.style.color = host ? '#ffb347' : '#555';
      timeSelect.style.cursor = host ? 'pointer' : 'not-allowed';
    }
  }

  // 保留接口，队伍信息已合并到 updateTeamUI
  function updateLobbyUI() { updateTeamUI(); }

  // ==================== 3. DEPLOY 拦截 ====================
  function initLobbyGate() {
    let lastBlock = 0;
    const tryBlock = (e) => {
      const btn = e.target.closest && e.target.closest('button[data-act="deploy"]');
      if (!btn) return;
      if (!game.G || !game.G.game || game.G.game.state !== 'title') return;
      if (allPlayersReady()) return;

      const now = Date.now();
      if (now - lastBlock < 150) return; // pointerdown 与 click 去重
      lastBlock = now;

      e.preventDefault(); e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      let reason = 'ALL PLAYERS MUST PICK A TEAM';
      const ids = new Set(Object.keys(state.getTeamDict())); ids.add(state.me);
      let allTeams = true, allReady = true;
      for (const id of ids) {
        const t = id === state.me ? state.getMyTeam() : state.getTeam(id);
        if (t !== 'red' && t !== 'blue') allTeams = false;
        if (!state.getReady(id)) allReady = false;
      }
      if (allTeams && !allReady) reason = 'WAITING FOR ALL PLAYERS TO READY UP';

      game.G.hud?.message?.(reason, 2.5);
    };
    document.addEventListener('pointerdown', tryBlock, true);
    document.addEventListener('click', tryBlock, true);
  }

  // 订阅事件
  bus.on('state:teams-changed', updateTeamUI);
  bus.on('state:teams', () => { hideNativeTeamBoxes(); updateTeamUI(); });
  bus.on('state:names', updateTeamUI);
  bus.on('state:name-self', updateTeamUI);
  bus.on('state:team-self', updateTeamUI);
  // 关键修复：host 状态变化时也要刷新模式下拉的 disabled 状态
  bus.on('state:host', () => { hideNativeTeamBoxes(); updateModeUI(); updateTeamUI(); });
  bus.on('state:mode', () => { updateModeUI(); updateTeamUI(); });
  bus.on('state:ready-changed', () => { updateReadyUI(); updateTeamUI(); });

  bus.on('ui:hide-team-selector', () => {
    const el = document.getElementById('custom-lobby-panel');
    if (el) el.style.display = 'none';
  });
  bus.on('ui:reset-title', () => {
    const el = document.getElementById('custom-lobby-panel');
    if (el) el.style.display = 'flex';
    hideNativeTeamBoxes();
    updateTeamUI(); updateModeUI();
  });

  function init() {
    initTeamUI();
    initLobbyGate();
  }

  return { init, initTeamUI, updateTeamUI, updateModeUI, updateLobbyUI, allPlayersReady, canSetMode };
}