// mods/bomb-mod.js
// v5.3.0：观战系统已移入核心（features/spectate.js），本 mod 仅保留 C4 逻辑。
export default {
  name: '爆破模式',
  version: '5.3.0',
  onInit(api) {
    // ==================== 常量 ====================
    const PLANT_TIME = 3.0;
    const BOMB_TIME = 40.0;
    const DEFUSE_TIME = 5.0;
    const DEFUSE_RANGE = 4.0;
    const siteA = { x: 580, z: 420, r: 15 };
    const siteB = { x: 420, z: 420, r: 15 };

    // ==================== 状态 ====================
    let currentPhase = 'idle';
    let bombTimer = 0;
    let plantTimer = 0;
    let defuseTimer = 0;
    let bombPos = null;
    let holdingF = false;
    let isDead = false;
    let roundEnded = false;

    function getAttackTeam() {
      const raw = api.state.getMode().attackTeam;
      return (raw === 'red' || raw === 'blue') ? raw : 'red';
    }
    function getRole() {
      const myTeam = api.state.getMyTeam();
      if (myTeam !== 'red' && myTeam !== 'blue') return 'spectator';
      return myTeam === getAttackTeam() ? 'attacker' : 'defender';
    }

    // ==================== 攻击方兜底同步 ====================
    let lastSyncedAttack = null;
    function syncAttackTeam() {
      if (!api.state.isHost()) return;
      const m = api.state.getMode();
      if (m.mode !== 'bomb') return;
      const raw = m.attackTeam;
      if (raw === 'red' || raw === 'blue') { lastSyncedAttack = raw; return; }
      if (lastSyncedAttack === 'red') return;
      lastSyncedAttack = 'red';
      api.state.patchMode({ attackTeam: 'red' });
      api.net.send({ t: 'set_mode', mode: 'bomb', target: m.target, attackTeam: 'red' });
      api.log('🔧 房主补发 attackTeam=red');
    }

    // ==================== 结算冻结 / 指针守护 ====================
    let frozen = false;
    let savedPlayerPos = null;
    let lockGuardTimer = null;

    function freezePlayer() {
      if (frozen) return;
      frozen = true;
      holdingF = false;
      const G = api.game.G;
      if (G && G.player) {
        if (G.player.pos && G.player.pos.clone) savedPlayerPos = G.player.pos.clone();
        if (G.player.vel) G.player.vel.set(0, 0, 0);
      }
    }
    function unfreezePlayer() { frozen = false; savedPlayerPos = null; }

    function freezeLoop() {
      if (frozen && api.game.G && api.game.G.player) {
        const p = api.game.G.player;
        if (p.vel) p.vel.set(0, 0, 0);
        if (savedPlayerPos && p.pos && p.pos.copy) p.pos.copy(savedPlayerPos);
      }
      requestAnimationFrame(freezeLoop);
    }
    freezeLoop();

    function startPointerLockGuard() {
      if (lockGuardTimer) return;
      if (document.pointerLockElement) document.exitPointerLock();
      lockGuardTimer = setInterval(() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }, 80);
    }
    function stopPointerLockGuard() {
      if (lockGuardTimer) { clearInterval(lockGuardTimer); lockGuardTimer = null; }
    }

    document.addEventListener('pointerlockchange', () => {
      if (roundOverlay.style.display !== 'none' && roundOverlay.style.display !== '') {
        if (document.pointerLockElement) document.exitPointerLock();
      }
    });

    // ==================== BOMB 选项注入 ====================
    function injectBombOption() {
      const mainSelect = document.getElementById('mode-main-select');
      if (!mainSelect) return;
      const existing = mainSelect.querySelector('option[value="bomb"]');
      if (!existing) {
        const opt = document.createElement('option');
        opt.value = 'bomb';
        opt.textContent = 'BOMB 爆破模式';
        if (!api.state.isHost()) opt.style.color = '#555';
        mainSelect.appendChild(opt);
        if (api.state.getMode().mode === 'bomb') mainSelect.value = 'bomb';
      } else if (existing.textContent !== 'BOMB 爆破模式') {
        existing.textContent = 'BOMB 爆破模式';
        if (!api.state.isHost()) existing.style.color = '#555';
        if (api.state.getMode().mode === 'bomb') mainSelect.value = 'bomb';
      }
    }
    setInterval(injectBombOption, 1500);
    setTimeout(injectBombOption, 100);

    // ==================== 大厅：进攻方选择器 ====================
    function initLobbyAttackSelector() {
      const tryInject = () => {
        const panel = document.getElementById('custom-lobby-panel');
        if (!panel) { setTimeout(tryInject, 300); return; }
        if (panel.querySelector('#bomb-attack-selector')) return;

        const wrap = document.createElement('div');
        wrap.id = 'bomb-attack-selector';
        wrap.style.cssText = 'display:none;flex-direction:column;gap:6px;width:100%;margin-top:4px;pointer-events:auto;';

        const btnBase = 'padding:10px 8px;background:transparent;'
          + 'border:1px solid rgba(255,255,255,0.1);color:#aaa;'
          + 'font-family:"Barlow Condensed",sans-serif;font-size:14px;font-weight:600;'
          + 'letter-spacing:1px;cursor:pointer;transition:all 0.2s;box-sizing:border-box;'
          + 'border-radius:0;display:flex;flex-direction:column;gap:2px;align-items:center;'
          + 'justify-content:center;pointer-events:auto;';

        wrap.innerHTML = `
          <div style="text-align:center;font-size:11px;letter-spacing:2px;color:#ffb347;opacity:0.8;">
            BOMB · 选择进攻方（另一方自动防守）
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button class="bomb-atk-btn" data-attack="red" style="${btnBase}">
              <span style="font-size:15px;font-weight:700;letter-spacing:2px;">RED 进攻</span>
              <span class="bomb-atk-sub" style="font-size:10px;opacity:0.6;letter-spacing:1px;">BLUE 防守</span>
            </button>
            <button class="bomb-atk-btn" data-attack="blue" style="${btnBase}">
              <span style="font-size:15px;font-weight:700;letter-spacing:2px;">BLUE 进攻</span>
              <span class="bomb-atk-sub" style="font-size:10px;opacity:0.6;letter-spacing:1px;">RED 防守</span>
            </button>
          </div>
        `;

        const readyBtn = panel.querySelector('#btn-ready');
        const anchor = readyBtn ? readyBtn.parentElement : null;
        if (anchor && anchor.parentElement === panel) panel.insertBefore(wrap, anchor);
        else panel.appendChild(wrap);

        wrap.querySelectorAll('.bomb-atk-btn').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!api.state.isHost()) return;
            if (api.state.getMode().mode !== 'bomb') return;
            const attackTeam = btn.dataset.attack;
            api.state.patchMode({ attackTeam });
            lastSyncedAttack = attackTeam;
            const m = api.state.getMode();
            api.net.send({ t: 'set_mode', mode: m.mode, target: m.target, attackTeam });
            updateBombAttackUI();
          });
        });

        updateBombAttackUI();
      };
      tryInject();
    }

    function updateBombAttackUI() {
      const wrap = document.getElementById('bomb-attack-selector');
      if (!wrap) return;
      const m = api.state.getMode();
      const isTitle = api.game.G?.game?.state === 'title';
      const show = m.mode === 'bomb' && isTitle;
      wrap.style.display = show ? 'flex' : 'none';
      if (!show) return;

      const host = api.state.isHost();
      const activeAttack = getAttackTeam();

      wrap.querySelectorAll('.bomb-atk-btn').forEach((btn) => {
        const team = btn.dataset.attack;
        const active = team === activeAttack;
        const color = team === 'red' ? '#ff5555' : '#5588ff';
        const rgb = team === 'red' ? '255,68,68' : '68,136,255';
        btn.style.border = active ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.1)';
        btn.style.background = active ? `rgba(${rgb},0.15)` : 'transparent';
        btn.style.color = active ? color : '#aaa';
        btn.style.opacity = host ? '1' : '0.5';
        btn.style.cursor = host ? 'pointer' : 'not-allowed';
        const sub = btn.querySelector('.bomb-atk-sub');
        if (sub) sub.style.color = active ? color : '#aaa';
      });
    }

    // ==================== 游戏内 UI ====================
    const ui = document.createElement('div');
    ui.style.cssText = 'position:fixed;top:15%;left:50%;transform:translateX(-50%);font-family:sans-serif;color:#fff;text-align:center;z-index:9999;pointer-events:none;display:none;';
    ui.innerHTML = `
      <div style="font-size:16px;color:#ff4444;letter-spacing:2px;margin-bottom:5px;">BOMB DEFUSAL</div>
      <div id="bomb-timer" style="font-size:56px;font-weight:900;text-shadow:0 0 15px #000;color:#fff;">--</div>
      <div id="bomb-status" style="font-size:22px;font-weight:bold;margin-top:5px;color:#44ff44;"></div>
      <div id="bomb-defuse-bar" style="display:none;width:240px;height:8px;background:rgba(255,255,255,0.2);margin:10px auto 0;border-radius:2px;overflow:hidden;">
        <div id="bomb-defuse-fill" style="width:0%;height:100%;background:#44ff44;transition:width 0.1s linear;"></div>
      </div>
    `;
    document.body.appendChild(ui);

    const roundOverlay = document.createElement('div');
    roundOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:none;align-items:center;justify-content:center;flex-direction:column;font-family:sans-serif;z-index:99999;pointer-events:auto;';
    roundOverlay.innerHTML = `
      <div id="round-result-title" style="font-size:64px;font-weight:900;margin-bottom:20px;pointer-events:none;"></div>
      <div id="round-result-sub" style="color:#fff;font-size:20px;pointer-events:none;"></div>
      <button id="round-restart-btn" style="margin-top:30px;padding:15px 40px;font-size:20px;background:#ff4444;border:none;color:#fff;cursor:pointer;font-weight:bold;letter-spacing:2px;pointer-events:auto;">重新部署</button>
    `;
    document.body.appendChild(roundOverlay);

    const timerEl = document.getElementById('bomb-timer');
    const statusEl = document.getElementById('bomb-status');
    const defuseBar = document.getElementById('bomb-defuse-bar');
    const defuseFill = document.getElementById('bomb-defuse-fill');
    const titleEl = document.getElementById('round-result-title');
    const subEl = document.getElementById('round-result-sub');
    const restartBtn = document.getElementById('round-restart-btn');

    // ==================== 结算冻结：输入拦截 ====================
    const isOnRestartBtn = (e) =>
      e.target === restartBtn || (restartBtn.contains && restartBtn.contains(e.target));

    function blockKeyDown(e) {
      if (!frozen) return;
      if (e.code === 'Escape' || e.key === 'Escape') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
    }
    function blockMouse(e) {
      if (!frozen) return;
      if (isOnRestartBtn(e)) return;
      e.preventDefault(); e.stopPropagation();
    }
    ['keydown', 'keypress'].forEach((type) => document.addEventListener(type, blockKeyDown, true));
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'contextmenu'].forEach((type) => document.addEventListener(type, blockMouse, true));

    // ==================== 隐藏/恢复原生 UI ====================
    const hiddenScreens = new Map();
    function hideAllScreens() {
      document.querySelectorAll('.m-screen').forEach(el => {
        if (el.style.display !== 'none') {
          if (!hiddenScreens.has(el)) hiddenScreens.set(el, el.style.display || '');
          el.style.display = 'none';
          el.style.pointerEvents = 'none';
        }
      });
    }
    function restoreAllScreens() {
      hiddenScreens.forEach((origDisplay, el) => {
        el.style.display = origDisplay;
        el.style.pointerEvents = '';
      });
      hiddenScreens.clear();
    }

    // ==================== 重开 ====================
    let isRestarting = false;
    function doRestart() {
      if (isRestarting) return;
      if (!api.state.isHost()) return;
      isRestarting = true;

      stopPointerLockGuard();
      unfreezePlayer();

      bombTimer = 0; plantTimer = 0; defuseTimer = 0; bombPos = null;
      currentPhase = 'idle'; holdingF = false; roundEnded = false; isDead = false;

      restoreAllScreens();
      roundOverlay.style.display = 'none';
      roundOverlay.style.pointerEvents = 'none';
      ui.style.display = 'none';
      defuseBar.style.display = 'none';

      if (api.match && typeof api.match.resetToTitle === 'function') {
        api.match.resetToTitle();
      } else {
        const G = api.game.G;
        if (G && G.game) {
          G.game.state = 'title';
          if (G.game.menus) {
            if (G.game.menus.closePanel) G.game.menus.closePanel();
            G.game.menus.show('title');
          }
        }
      }

      if (api.net) api.net.send({ t: 'back_title' });
      setTimeout(() => { isRestarting = false; }, 500);
    }

    document.addEventListener('pointerdown', (e) => {
      if (roundOverlay.style.display === 'none' || roundOverlay.style.display === '') return;
      if (isOnRestartBtn(e)) {
        e.preventDefault(); e.stopPropagation();
        doRestart();
      }
    }, true);

    window.addEventListener('keydown', (e) => { if (e.code === 'KeyF') holdingF = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'KeyF') holdingF = false; });

    // ==================== 观战事件联动（核心接管观战，这里只隐藏 C4 UI） ====================
    api.bus.on('ui:spectate-enter', () => {
      isDead = true;
      holdingF = false;
      ui.style.display = 'none';
      defuseBar.style.display = 'none';
      hideAllScreens();
    });
    api.bus.on('ui:spectate-exit', () => {
      isDead = false;
      // 不重置 C4 状态（可能观战者回来时炸弹已经拆了），只恢复 HUD 显示
    });

    // net:pd 兜底：如果 spectate 系统因为 alive 没被设为 false 而漏判，这里也能进入观战隐藏
    api.bus.on('net:pd', () => {
      if (api.state.getMode().mode !== 'bomb') return;
      const G = api.game.G;
      if (!G || !G.player) return;
      if (G.player.alive === false) {
        isDead = true;
        holdingF = false;
        ui.style.display = 'none';
        defuseBar.style.display = 'none';
      }
    });

    // ==================== 回合全灭判定 ====================
    setInterval(() => {
      if (api.state.getMode().mode !== 'bomb') return;
      if (roundEnded) return;
      const G = api.game.G;
      if (!G || !G.game || G.game.state !== 'playing') return;

      let allyAlive = (G.player && G.player.alive) ? 1 : 0;
      let enemyAlive = 0;

      try {
        const remotes = api.entities?.getRemotes?.();
        if (remotes) {
          remotes.forEach((r, id) => {
            const last = r.buf[r.buf.length - 1];
            if (!last || !last.al) return;
            if (api.entities.isAlly(id)) allyAlive++;
            else enemyAlive++;
          });
        }
      } catch (e) {}

      if (enemyAlive === 0 && allyAlive <= 1) return;

      if (allyAlive === 0 || enemyAlive === 0) {
        roundEnded = true;

        if (allyAlive === 0 && enemyAlive === 0) {
          titleEl.textContent = '平局'; titleEl.style.color = '#ffcc00';
        } else if (allyAlive === 0) {
          titleEl.textContent = '💀 敌方获胜'; titleEl.style.color = '#ff4444';
        } else {
          titleEl.textContent = '🏆 我方获胜'; titleEl.style.color = '#44ff44';
        }

        if (api.state.isHost()) {
          subEl.textContent = '你是房主，点击下方按钮重开';
          restartBtn.style.display = 'block';
        } else {
          subEl.textContent = '等待房主重新部署...';
          restartBtn.style.display = 'none';
        }

        roundOverlay.style.display = 'flex';
        roundOverlay.style.zIndex = '2147483647';
        roundOverlay.style.pointerEvents = 'auto';
        restartBtn.style.zIndex = '2147483647';
        restartBtn.style.pointerEvents = 'auto';

        startPointerLockGuard();
        freezePlayer();
        window.__pointerLockHint?.suppress();

        api.log(`回合结束：${titleEl.textContent}`);
      }
    }, 1500);

    // ==================== 状态重置 ====================
    api.bus.on('game:state', (d) => {
      if (d.state === 'playing') {
        window.__pointerLockHint?.resume();
        stopPointerLockGuard();
        unfreezePlayer();
        roundEnded = false; isDead = false;
        currentPhase = 'idle';
        bombTimer = 0; plantTimer = 0; defuseTimer = 0; bombPos = null;
        holdingF = false;
        roundOverlay.style.display = 'none';
        roundOverlay.style.pointerEvents = 'none';
        defuseBar.style.display = 'none';
        syncAttackTeam();
      } else if (d.state === 'title') {
        stopPointerLockGuard();
        unfreezePlayer();
        restoreAllScreens();
        roundOverlay.style.display = 'none';
        roundOverlay.style.pointerEvents = 'none';
        ui.style.display = 'none';
        defuseBar.style.display = 'none';
        isDead = false; roundEnded = false;
        currentPhase = 'idle';
        bombTimer = 0; plantTimer = 0; defuseTimer = 0; bombPos = null;
        holdingF = false;
      }
    });

    api.bus.on('net:back_title', () => {
      stopPointerLockGuard(); unfreezePlayer(); restoreAllScreens();
      roundOverlay.style.display = 'none';
      roundOverlay.style.pointerEvents = 'none';
      ui.style.display = 'none';
      defuseBar.style.display = 'none';
      isDead = false; roundEnded = false;
      currentPhase = 'idle';
      bombTimer = 0; plantTimer = 0; defuseTimer = 0; bombPos = null;
      holdingF = false;

      if (api.match && typeof api.match.resetToTitle === 'function') api.match.resetToTitle();
      else {
        const G = api.game.G;
        if (G && G.game) {
          G.game.state = 'title';
          if (G.game.menus) {
            if (G.game.menus.closePanel) G.game.menus.closePanel();
            G.game.menus.show('title');
          }
        }
      }
    });

    api.bus.on('game:reset-title-request', () => {
      stopPointerLockGuard(); unfreezePlayer(); restoreAllScreens();
      roundOverlay.style.display = 'none';
      roundOverlay.style.pointerEvents = 'none';
      ui.style.display = 'none';
      defuseBar.style.display = 'none';
      isDead = false; roundEnded = false;
      currentPhase = 'idle';
      bombTimer = 0; plantTimer = 0; defuseTimer = 0; bombPos = null;
      holdingF = false;
    });

    // ==================== 主逻辑 ====================
    let lastTick = performance.now();
    setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - lastTick) / 1000, 0.5);
      lastTick = now;

      const G = api.game.G;
      const mode = api.state.getMode().mode;

      if (mode !== 'bomb' || !G || !G.player || G.game.state !== 'playing') {
        ui.style.display = 'none';
        defuseBar.style.display = 'none';
        currentPhase = 'idle';
        return;
      }

      if (roundEnded) hideAllScreens();
      ui.style.display = (isDead || roundEnded) ? 'none' : 'block';
      if (isDead || roundEnded) return;

      const role = getRole();
      if (role === 'spectator') {
        timerEl.textContent = '--';
        statusEl.textContent = '未选择队伍';
        statusEl.style.color = '#888';
        defuseBar.style.display = 'none';
        return;
      }

      const p = G.player.pos;
      const inA = Math.hypot(p.x - siteA.x, p.z - siteA.z) < siteA.r;
      const inB = Math.hypot(p.x - siteB.x, p.z - siteB.z) < siteB.r;
      const inSite = inA || inB;

      if (currentPhase === 'idle') {
        timerEl.textContent = '--'; timerEl.style.color = '#fff';
        defuseBar.style.display = 'none';
        if (role === 'defender') {
          statusEl.textContent = '防守方：等待敌人下包';
          statusEl.style.color = '#4488ff';
        } else {
          if (inSite) {
            statusEl.textContent = '按住 F 安装 C4';
            statusEl.style.color = '#ffcc00';
            if (holdingF) { currentPhase = 'planting'; plantTimer = PLANT_TIME; }
          } else {
            statusEl.textContent = '前往 A 或 B 点';
            statusEl.style.color = '#fff';
          }
        }
      }
      else if (currentPhase === 'planting') {
        plantTimer -= dt;
        timerEl.textContent = Math.max(0, plantTimer).toFixed(1);
        timerEl.style.color = '#ffcc00';
        statusEl.textContent = '正在安装...';
        statusEl.style.color = '#ffcc00';
        if (!holdingF) { currentPhase = 'idle'; plantTimer = 0; }
        else if (plantTimer <= 0) {
          currentPhase = 'planted';
          bombTimer = BOMB_TIME;
          defuseTimer = DEFUSE_TIME;
          bombPos = { x: p.x, y: p.y, z: p.z };
          api.log('💣 炸弹已安装！');
        }
      }
      else if (currentPhase === 'planted') {
        bombTimer -= dt;
        timerEl.textContent = Math.max(0, bombTimer).toFixed(1);
        timerEl.style.color = bombTimer < 10 ? '#ff4444' : '#fff';
        defuseBar.style.display = 'none';

        if (bombTimer <= 0) {
          currentPhase = 'exploded';
          statusEl.textContent = '💥 炸弹爆炸';
          statusEl.style.color = '#ff4444';
          timerEl.textContent = '0.0';
          if (G.player && G.player.alive) G.player.damage(9999, null);
          return;
        }

        const dist = bombPos ? Math.hypot(p.x - bombPos.x, p.z - bombPos.z) : 999;
        if (role === 'defender' && dist < DEFUSE_RANGE) {
          statusEl.textContent = '按住 F 拆除 C4';
          statusEl.style.color = '#44ff44';
          if (holdingF) { currentPhase = 'defusing'; defuseTimer = DEFUSE_TIME; }
        } else if (role === 'attacker') {
          statusEl.textContent = '保卫 C4！';
          statusEl.style.color = '#ffcc00';
        } else {
          statusEl.textContent = '前往炸弹位置';
          statusEl.style.color = '#44ff44';
        }
      }
      else if (currentPhase === 'defusing') {
        bombTimer -= dt;
        defuseTimer -= dt;
        timerEl.textContent = Math.max(0, bombTimer).toFixed(1);
        timerEl.style.color = bombTimer < 10 ? '#ff4444' : '#ffaa00';

        defuseBar.style.display = 'block';
        const progress = Math.max(0, Math.min(100, (1 - defuseTimer / DEFUSE_TIME) * 100));
        defuseFill.style.width = progress.toFixed(1) + '%';
        statusEl.textContent = `拆除中... ${(DEFUSE_TIME - defuseTimer).toFixed(1)}/${DEFUSE_TIME.toFixed(1)}s`;
        statusEl.style.color = '#44ff44';

        if (bombTimer <= 0) {
          currentPhase = 'exploded';
          statusEl.textContent = '💥 炸弹爆炸';
          statusEl.style.color = '#ff4444';
          timerEl.textContent = '0.0';
          if (G.player && G.player.alive) G.player.damage(9999, null);
          return;
        }

        const dist = bombPos ? Math.hypot(p.x - bombPos.x, p.z - bombPos.z) : 999;
        if (!holdingF || dist >= DEFUSE_RANGE) {
          currentPhase = 'planted';
          defuseTimer = DEFUSE_TIME;
          defuseBar.style.display = 'none';
          return;
        }
        if (defuseTimer <= 0) {
          currentPhase = 'defused';
          statusEl.textContent = '✅ C4 已拆除';
          statusEl.style.color = '#4488ff';
          timerEl.textContent = '0.0';
          defuseBar.style.display = 'none';
        }
      }
      else if (currentPhase === 'defused' || currentPhase === 'exploded') {
        defuseBar.style.display = 'none';
      }
    }, 100);

    // ==================== 爆破模式禁用 AI ====================
    setInterval(() => {
      const G = api.game.G;
      if (api.state.getMode().mode !== 'bomb' || !G || !G.game || G.game.state !== 'playing') return;
      if (G.enemies && G.enemies.list && G.enemies.list.length > 0) {
        G.enemies.list.forEach(e => {
          if (e.alive) {
            e.alive = false;
            if (e.rig && e.rig.group) e.rig.group.visible = false;
          }
        });
        G.enemies.list = [];
      }
    }, 1000);

    // ==================== 大厅选择器 + attackTeam 同步 ====================
    initLobbyAttackSelector();

    api.bus.on('state:mode', () => {
      updateBombAttackUI();
      if (api.state.getMode().mode === 'bomb') {
        lastSyncedAttack = null;
        setTimeout(syncAttackTeam, 100);
      }
    });
    api.bus.on('state:host', () => { updateBombAttackUI(); syncAttackTeam(); });
    api.bus.on('state:teams', updateBombAttackUI);
    api.bus.on('ui:reset-title', () => { updateBombAttackUI(); syncAttackTeam(); });

    setInterval(() => {
      if (api.state.getMode().mode !== 'bomb') return;
      if (api.game.G?.game?.state !== 'title') return;
      syncAttackTeam();
    }, 3000);

    api.log('💣 爆破模式 Mod v5.3.0 已加载');
  }
};