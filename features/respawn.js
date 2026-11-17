// features/respawn.js
// 核心复活控制器：劫持 player.reset，死亡状态下拦截外部自动复活，
// 只有"5 秒倒计时结束"才允许 reset。
// 复活前自动退出幽灵观战。
export function installRespawn({ game, bus, state }) {
  const G = game.G;
  const RESPAWN_DELAY = 5;

  let deadState = false;
  let allowReset = false;
  let countdownTimer = null;
  let countdownLeft = 0;

  // ============ UI ============
  const ui = document.createElement('div');
  ui.id = 'respawn-countdown';
  ui.style.cssText = 'position:fixed;top:18%;left:50%;transform:translateX(-50%);font-family:"Big Shoulders Display",sans-serif;font-size:42px;font-weight:900;color:#ffcc00;text-shadow:0 0 20px #000,0 0 40px rgba(255,204,0,0.4);letter-spacing:4px;pointer-events:none;z-index:99999;display:none;text-align:center;';
  ui.innerHTML = `<div style="font-size:14px;letter-spacing:6px;color:#ff4444;margin-bottom:8px;">REDEPLOY</div><div id="respawn-num">5</div><div style="font-size:11px;letter-spacing:2px;color:#aaa;margin-top:6px;">秒后复活</div>`;
  document.body.appendChild(ui);

  function showCountdown() {
    ui.style.display = 'block';
    const num = document.getElementById('respawn-num');
    if (num) num.textContent = String(Math.max(0, countdownLeft));
  }

  function hideCountdown() {
    ui.style.display = 'none';
  }

  // ============ 劫持 player.reset ============
  const origReset = G.player.reset.bind(G.player);
  G.player.reset = function(...args) {
    if (deadState && !allowReset) {
      return;
    }
    return origReset(...args);
  };

  // ============ 监听死亡 ============
  G.events.on('player:dead', () => {
    deadState = true;
    cancelCountdown();
    console.log('[respawn] 进入死亡状态，等待玩家点击部署');
  });

  // ============ 倒计时 ============
  function startCountdown() {
    if (!deadState) return false;
    if (countdownTimer) return true;
    countdownLeft = RESPAWN_DELAY;
    showCountdown();
    countdownTimer = setInterval(() => {
      countdownLeft -= 1;
      if (countdownLeft <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        doRespawn();
      } else {
        showCountdown();
      }
    }, 1000);
    return true;
  }

  function cancelCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownLeft = 0;
    hideCountdown();
  }

  function doRespawn() {
    hideCountdown();

    // 👻 先退出幽灵观战，恢复 player 状态（alive/enabled/invulnerable）
    if (window.__spectate?.isActive?.()) {
      try { window.__spectate.exit(); } catch (e) { console.error('[respawn] exit spectate', e); }
    }

    allowReset = true;
    try {
      const spawn = G.level && G.level.playerStart ? G.level.playerStart : undefined;
      origReset(spawn);
    } finally {
      allowReset = false;
    }
    deadState = false;
    bus.emit('ui:spectate-exit'); // 保险再发一次
    console.log('[respawn] ✅ 复活完成');
  }

  // ============ 状态机重置 ============
  bus.on('game:state', (d) => {
    if (d.state !== 'playing') {
      deadState = false;
      cancelCountdown();
      if (d.state === 'title') {
        allowReset = true;
        setTimeout(() => { allowReset = false; }, 500);
      }
    } else if (d.state === 'playing' && d.prev !== 'playing') {
      deadState = false;
      cancelCountdown();
      allowReset = true;
      setTimeout(() => { allowReset = false; }, 500);
    }
  });

  return {
    deadState: () => deadState,
    isCountingDown: () => !!countdownTimer,
    startCountdown,
    cancelCountdown,
  };
}