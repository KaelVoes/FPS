// features/spectate.js
// 修复内容：
//   A. bob 对称化（sin 取代 abs，镜头不再单向下沉）
//   B. eyeHeight 从目标 buf 读取真实值（蹲下/跳跃高度正确）
//   C. camera 处理父节点旋转（用 worldToLocal + quaternion 转换，不再手算）
//   D. 观战时隐藏本地 viewmodel（假的枪不再显示），删除每帧强制 visible
//   E. bob 相位用 buf 里的真实 vx/vz 驱动（去掉位置差分，消除滞后）
export function installSpectate({ game, bus, state, entities, net }) {
  const G = game.G;

  let active = false;
  let savedState = null;
  let targets = [];
  let targetIndex = 0;
  let ghostTargetId = null;
  let lastScan = 0;

  // viewmodel 隐藏控制（观战时本地 viewmodel 是假的，不显示）
  let viewmodelNode = null;
  let savedViewmodelVisible = null;

  // bob 参数
  const CAM_BOB_X = 0.006;
  const CAM_BOB_Y = 0.010;
  const CAM_ROLL = 0.008;
  const BOB_FREQ = 8;
  const BOB_FREQ_PER_SPEED = 0.6;

  let bobPhase = 0;
  let bobAmp = 0;
  let smoothedSpeed = 0;
  let lastSpeedTime = performance.now();

  function findViewModel() {
    if (G.camera?.children) {
      for (const child of G.camera.children) {
        const n = (child.name || '').toLowerCase();
        if (/^viewmodel[-_]/i.test(n) || /viewmodel/i.test(n)) return child;
      }
    }
    return null;
  }

  function collectTargets() {
    targets = [];
    if (!entities) return;
    for (const [id, r] of entities.getRemotes()) {
      if (!entities.isAlly(id)) continue;
      const last = r.buf && r.buf[r.buf.length - 1];
      if (!last || !last.al) continue;
      if (r.group && r.group.visible === false) continue;
      if (r.ghost) continue;
      targets.push({ id, remote: r });
    }
    if (targetIndex >= targets.length) targetIndex = 0;
  }

  function enterGhost() {
    if (active || !G.player) return;
    active = true;
    window.__spectateActive = true;

    targetIndex = 0;
    collectTargets();

    savedState = {
      pos: G.player.pos ? G.player.pos.clone() : null,
      yaw: G.player.yaw || 0,
      pitch: G.player.pitch || 0,
      alive: G.player.alive,
      enabled: G.player.enabled,
      invulnerable: G.player.invulnerable,
      health: G.player.health,
    };

    G.player.alive = true;
    G.player.enabled = true;
    G.player.invulnerable = true;
    G.player.health = 100;
    if (G.player.vel) G.player.vel.set(0, 0, 0);

    // 清空输入
    if (G.input) {
      ['down', 'keys', 'pressed'].forEach(field => {
        const obj = G.input[field];
        if (!obj || typeof obj !== 'object') return;
        for (const k in obj) { if (typeof obj[k] !== 'function') try { obj[k] = false; } catch (e) {} }
      });
    }

    // 【D】隐藏本地 viewmodel（观战时它是"假"的，显示会误导）
    viewmodelNode = findViewModel();
    if (viewmodelNode) {
      savedViewmodelVisible = viewmodelNode.visible;
      viewmodelNode.visible = false;
    }

    ghostTargetId = targets.length > 0 ? targets[0].id : null;
    lastSpeedTime = performance.now();
    bobAmp = 0; bobPhase = 0; smoothedSpeed = 0;

    bus.emit('ui:spectate-enter', { total: targets.length });
    emitTarget();
  }

  function exitGhost() {
    if (!active) return;
    active = false;
    window.__spectateActive = false;

    // 【D】恢复 viewmodel 可见性（必须在 viewmodelNode = null 之前）
    if (viewmodelNode) {
      viewmodelNode.visible = savedViewmodelVisible !== null ? savedViewmodelVisible : true;
    }
    viewmodelNode = null;
    savedViewmodelVisible = null;

    if (savedState && G.player) {
      if (savedState.pos && G.player.pos) G.player.pos.copy(savedState.pos);
      if (G.player.vel) G.player.vel.set(0, 0, 0);
      G.player.yaw = savedState.yaw;
      if (G.player.pitch !== undefined) G.player.pitch = savedState.pitch;
      G.player.alive = savedState.alive;
      G.player.enabled = savedState.enabled;
      G.player.invulnerable = savedState.invulnerable;
      G.player.health = savedState.health;
    }
    savedState = null;
    ghostTargetId = null;
    targets = [];
    bus.emit('ui:spectate-exit');
  }

  function emitTarget() {
    if (targets.length === 0) {
      bus.emit('ui:spectate-target', { index: 0, total: 0, id: null, name: null });
      return;
    }
    const { id } = targets[targetIndex];
    bus.emit('ui:spectate-target', {
      index: targetIndex, total: targets.length, id,
      name: state.getName(id) || id.slice(0, 5),
    });
  }

  function nextTarget() {
    if (!active || targets.length === 0) return;
    targetIndex = (targetIndex + 1) % targets.length;
    ghostTargetId = targets[targetIndex].id;
    emitTarget();
  }
  function prevTarget() {
    if (!active || targets.length === 0) return;
    targetIndex = (targetIndex - 1 + targets.length) % targets.length;
    ghostTargetId = targets[targetIndex].id;
    emitTarget();
  }

  function sync() {
    if (!active || !G.player || !G.camera) return;
    const target = ghostTargetId ? entities.getRemote(ghostTargetId) : null;
    if (!target || !target.group) return;
    const p = target.group.position;
    const yaw = target.group.rotation.y;
    const pitch = target.pitch || 0;

    // 【E】速度用 buf 尾部的 vx/vz 真实速度，不做位置差分（消除滞后）
    const last = target.buf && target.buf[target.buf.length - 1];
    const vx = last?.vx || 0;
    const vz = last?.vz || 0;
    const rawSpeed = Math.min(6, Math.hypot(vx, vz));
    smoothedSpeed = smoothedSpeed * 0.7 + rawSpeed * 0.3;

    const now = performance.now();
    const dt = Math.max(0.001, Math.min(0.1, (now - lastSpeedTime) / 1000));
    lastSpeedTime = now;

    if (G.player.pos) G.player.pos.set(p.x, p.y, p.z);
    if (G.player.vel) G.player.vel.set(0, 0, 0);
    G.player.yaw = yaw;
    if (G.player.pitch !== undefined) G.player.pitch = pitch;

    const targetAmp = Math.min(1, smoothedSpeed / 3.5);
    bobAmp += (targetAmp - bobAmp) * 0.15;
    if (bobAmp > 0.01) bobPhase += dt * (BOB_FREQ + smoothedSpeed * BOB_FREQ_PER_SPEED);
  }

  function beforeRender() {
    if (!active || !G.player || !G.camera) return;
    const target = ghostTargetId ? entities.getRemote(ghostTargetId) : null;
    if (!target || !target.group) return;

    const p = target.group.position;
    const yaw = target.group.rotation.y;
    const pitch = target.pitch || 0;

    // 【A】bob 对称化：用 sin（不用 abs），镜头上下对称晃动
    const camBobX = Math.sin(bobPhase * 2) * CAM_BOB_X * bobAmp;
    const camBobY = Math.sin(bobPhase) * CAM_BOB_Y * bobAmp;
    const camRoll = Math.sin(bobPhase * 2) * CAM_ROLL * bobAmp;

    // 【B】从目标 buf 读取真实 eyeHeight（蹲下/跳跃时高度正确）
    const last = target.buf && target.buf[target.buf.length - 1];
    const eyeHeight = last?.eh ?? (G.player.eyeHeight ?? 1.6);

    const cam = G.camera;
    const worldPos = new G.THREE.Vector3(
      p.x + camBobX,
      p.y + eyeHeight + camBobY,
      p.z
    );
    const worldQuat = new G.THREE.Quaternion().setFromEuler(
      new G.THREE.Euler(pitch, yaw, camRoll, 'YXZ')
    );

    // 【C】处理 camera 父节点变换：位置 + 旋转都要转到 parent 局部空间
    if (cam.parent && cam.parent !== G.scene) {
      cam.parent.updateMatrixWorld(true);
      const parentQuat = new G.THREE.Quaternion();
      cam.parent.getWorldQuaternion(parentQuat);
      const localPos = worldPos.clone();
      cam.parent.worldToLocal(localPos);
      cam.position.copy(localPos);
      // 局部四元数 = inverse(parentWorldQuat) * worldQuat
      cam.quaternion.copy(parentQuat.clone().invert().multiply(worldQuat));
    } else {
      cam.position.copy(worldPos);
      cam.quaternion.copy(worldQuat);
    }
    cam.updateMatrixWorld(true);
  }

  function afterRender() {
    // 保留空接口，兼容 patches.js 里的调用
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!active) return;
    const now = performance.now();
    if (now - lastScan > 500) {
      lastScan = now;
      collectTargets();
      if (!ghostTargetId && targets.length > 0) {
        targetIndex = 0; ghostTargetId = targets[0].id;
      } else if (ghostTargetId && !targets.some(t => t.id === ghostTargetId)) {
        if (targets.length > 0) { targetIndex = 0; ghostTargetId = targets[0].id; }
        else { ghostTargetId = null; }
      }
      emitTarget();
    }
    sync();
  }
  loop();

  function blockKey(e) {
    if (!active) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.type === 'keydown') {
      if (e.code === 'KeyQ') { prevTarget(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === 'KeyE') { nextTarget(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === 'Space') { nextTarget(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    }
    e.preventDefault(); e.stopImmediatePropagation();
  }
  window.addEventListener('keydown', blockKey, true);
  window.addEventListener('keyup', blockKey, true);
  document.addEventListener('keydown', blockKey, true);
  document.addEventListener('keyup', blockKey, true);

  window.addEventListener('wheel', (e) => {
    if (!active) return;
    if (e.deltaY > 0) nextTarget(); else if (e.deltaY < 0) prevTarget();
    e.preventDefault(); e.stopImmediatePropagation();
  }, { capture: true, passive: false });

  document.addEventListener('pointerlockchange', () => {
    if (active && document.pointerLockElement) document.exitPointerLock?.();
  });

  G.events.on('player:dead', () => enterGhost());
  bus.on('ui:spectate-exit', exitGhost);
  bus.on('game:state', (d) => { if (d.state === 'title' || d.state === 'complete') exitGhost(); });

  function debug() {
    return {
      active, ghostTargetId, targetCount: targets.length,
      playerPos: G.player ? [G.player.pos.x, G.player.pos.y, G.player.pos.z].map(n => +n.toFixed(2)) : null,
      playerAlive: G.player?.alive, gameState: G.game?.state,
      cameraPos: G.camera ? [G.camera.position.x, G.camera.position.y, G.camera.position.z].map(n => +n.toFixed(2)) : null,
      anim: { smoothedSpeed: +smoothedSpeed.toFixed(2), bobAmp: +bobAmp.toFixed(3) },
    };
  }

  return {
    isActive: () => active, enter: enterGhost, exit: exitGhost,
    next: nextTarget, prev: prevTarget, getTargets: () => targets.slice(),
    getGhostTargetId: () => ghostTargetId, sync, beforeRender, afterRender, debug,
  };
}