// core/pointer-lock.js - 修复暂停菜单失效问题 + 支持外部抑制锁定提示
export function installPointerLock({ game, bus }) {
  const G = game.G;

  function getCanvas() {
    if (G.canvas) return G.canvas;
    if (G.renderer && G.renderer.domElement) return G.renderer.domElement;
    const all = document.querySelectorAll('canvas');
    for (const c of all) {
      if (c.width > 400 || c.height > 300) return c;
    }
    return document.querySelector('canvas') || document.body;
  }

  let hasWarned = false;

  // ==================== 外部抑制接口 ====================
  // 结算、死亡观战、全屏 UI 等场景可以调用：
  //   window.__pointerLockHint.suppress()  暂停提示并移除已存在的 tip
  //   window.__pointerLockHint.resume()    恢复提示（下一次 playing 检查时生效）
  window.__pointerLockHint = {
    suppress() {
      window.__suppressPointerLockHint = true;
      const t = document.getElementById('pointer-lock-tip');
      if (t) t.remove();
    },
    resume() {
      window.__suppressPointerLockHint = false;
      // 重置"本轮已提示"标记，让下一次检查重新走显示逻辑
      hasWarned = false;
    }
  };

  function tryLock() {
    if (document.pointerLockElement) return;
    if (!G.game || G.game.state !== 'playing') return;

    const target = getCanvas();
    if (target && target.requestPointerLock) {
      try {
        target.requestPointerLock();
      } catch (e) {
        console.warn('[pointer-lock] 锁定失败:', e);
      }
    }
  }

  // 1. 状态变为 playing 时，提示用户点击画面
  bus.on('game:state', (d) => {
    if (d.state === 'playing') {
      hasWarned = false;
      tryLock(); // 尝试在用户点击部署的瞬间直接锁（有时能成功）

      setTimeout(() => {
        if (
          !document.pointerLockElement &&
          G.game.state === 'playing' &&
          !hasWarned &&
          !window.__suppressPointerLockHint   // ← 新增抑制判断
        ) {
          hasWarned = true;
          console.log('%c🎯 请点击游戏画面以锁定鼠标', 'color: #ffb347; font-size: 16px; font-weight: bold; background: #222; padding: 4px;');
          const tip = document.createElement('div');
          tip.id = 'pointer-lock-tip';
          tip.textContent = '点击画面锁定鼠标';
          tip.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);color:#fff;font-family:sans-serif;font-size:24px;font-weight:bold;text-shadow:0 0 10px #000;z-index:99999;pointer-events:none;';
          document.body.appendChild(tip);
        }
      }, 500);
    } else {
      // 退出 playing（回到大厅、结算、死亡观战），释放鼠标
      if (document.pointerLockElement) document.exitPointerLock?.();
      const t = document.getElementById('pointer-lock-tip');
      if (t) t.remove();
    }
  });

  // 2. 核心修复：只有在点击 Canvas 时，才尝试锁定鼠标
  document.addEventListener('click', (e) => {
    if (G.game && G.game.state === 'playing' && !document.pointerLockElement) {
      const canvas = getCanvas();
      // 如果点击的目标是 Canvas 本身，或者 Canvas 包含它，才去锁定
      if (e.target === canvas || (canvas && canvas.contains(e.target))) {
        tryLock();
      }
    }
  }, { capture: true });

  // 3. 指针锁定变更（按了 ESC）
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) {
      // 锁定成功，移除提示
      const t = document.getElementById('pointer-lock-tip');
      if (t) t.remove();
    } else {
      // 用户按了 ESC 释放鼠标
      // 注意：不要在这里主动调用 G.game.pause()
      // 原版引擎在丢锁时会自动弹出暂停菜单
    }
  });

  // 4. 恢复游戏（点“继续”）时，重新锁定
  bus.on('game:resume', () => {
    setTimeout(tryLock, 100);
  });

  console.log('[pointer-lock] 鼠标锁定系统已安装');
}