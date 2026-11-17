// mods/dust2-map.js - 职责：地图生成 + 出生点备份/恢复 + AI 禁用/恢复
export default {
  name: '沙漠灰地图',
  version: '12.0.0',
  onInit(api) {
    let mapBuilt = false;
    let buildRequested = false;

    // 原始数据快照
    let originalSpawns = null;
    let originalPlayerStart = null;
    let snapshotDone = false;

    // ==================== 快照 / 恢复 ====================
    function snapshotOriginal(G) {
      if (snapshotDone) return;
      if (!G || !G.level) return;
      if (G.level.enemySpawns) {
        originalSpawns = G.level.enemySpawns.map(s => ({
          type: s.type,
          pos: s.pos.clone()
        }));
      }
      if (G.level.playerStart) {
        const ps = G.level.playerStart;
        if (ps.pos) originalPlayerStart = { kind: 'pos', pos: ps.pos.clone() };
        else if (ps.isVector3) originalPlayerStart = { kind: 'v3', pos: ps.clone() };
      }
      snapshotDone = true;
      console.log('[mapmod] 已备份原始出生点数据');
    }

    function restoreOriginal(G) {
      if (!G || !G.level) return;
      if (originalSpawns && G.level.enemySpawns) {
        G.level.enemySpawns.length = 0;
        for (const s of originalSpawns) {
          G.level.enemySpawns.push({ type: s.type, pos: s.pos.clone() });
        }
      }
      if (originalPlayerStart && G.level.playerStart) {
        const ps = G.level.playerStart;
        if (originalPlayerStart.kind === 'pos' && ps.pos) ps.pos.copy(originalPlayerStart.pos);
        else if (originalPlayerStart.kind === 'v3' && ps.isVector3) ps.copy(originalPlayerStart.pos);
      }
    }

    // ==================== AI 禁用 / 恢复 ====================
    function disableAI(G) {
      if (!G || !G.level) return;

      // 1. 清空 enemySpawns —— 引擎遍历它生成怪物时，读到的就是空数组
      if (G.level.enemySpawns) {
        G.level.enemySpawns.length = 0;
      }

      // 2. 清空场上现有怪物（防止上一局残留）
      if (G.enemies && G.enemies.list) {
        G.enemies.list.forEach(e => {
          if (e.alive) {
            e.alive = false;
            if (e.rig && e.rig.group) e.rig.group.visible = false;
          }
        });
        G.enemies.list = [];
      }

      // 3. 劫持刷怪函数（只做一次）
      if (G.enemies && !G.enemies._aiDisabled) {
        G.enemies._aiDisabled = true;
        G.enemies._origSpawn = G.enemies.spawn;
        G.enemies._origSpawnWave = G.enemies.spawnWave;
        if (typeof G.enemies.spawn === 'function') G.enemies.spawn = () => null;
        if (typeof G.enemies.spawnWave === 'function') G.enemies.spawnWave = () => null;
        console.log('[mapmod] 🚫 已禁用 AI 生成');
      }
    }

    function enableAI(G) {
      if (!G) return;

      // 1. 恢复 enemySpawns
      if (originalSpawns && G.level && G.level.enemySpawns) {
        G.level.enemySpawns.length = 0;
        for (const s of originalSpawns) {
          G.level.enemySpawns.push({ type: s.type, pos: s.pos.clone() });
        }
      }

      // 2. 恢复刷怪函数
      if (G.enemies && G.enemies._aiDisabled) {
        G.enemies._aiDisabled = false;
        if (G.enemies._origSpawn) G.enemies.spawn = G.enemies._origSpawn;
        if (G.enemies._origSpawnWave) G.enemies.spawnWave = G.enemies._origSpawnWave;
        console.log('[mapmod] ✅ 已恢复 AI 生成');
      }
    }

    // ==================== 大厅：选 BOMB 立刻建图 ====================
    function ensureBuild() {
      if (mapBuilt || buildRequested) return;
      buildRequested = true;
      const G = api.game.G;
      if (!G || !G.physics || !G.scene) {
        setTimeout(() => { buildRequested = false; ensureBuild(); }, 200);
        return;
      }
      try {
        generateDust2(G);
        mapBuilt = true;
        api.log('✅ 沙漠灰地图已在大厅预加载');
      } catch (e) {
        console.warn('[mapmod] 大厅预加载失败:', e);
        buildRequested = false;
      }
    }

    // ==================== 模式切换：数据 + AI 双向同步 ====================
    api.bus.on('state:mode', () => {
      const G = api.game.G;
      if (!G) return;
      
      // 先备份（第一次触发时才真正执行）
      snapshotOriginal(G);

      const mode = api.state.getMode().mode;
      if (mode === 'bomb') {
        ensureBuild();
        patchSpawnPoints(G);
        disableAI(G);
      } else {
        restoreOriginal(G);
        enableAI(G);
        console.log(`[mapmod] 已切回 ${mode} 模式，恢复出生点和 AI`);
      }
    });

    // ==================== 轮询兜底 ====================
    setInterval(() => {
      if (api.state.getMode().mode === 'bomb') ensureBuild();
    }, 500);

    // ==================== 进入游戏时数据同步 ====================
    api.bus.on('game:state', (d) => {
      const G = api.game.G;
      if (!G) return;
      const mode = api.state.getMode().mode;

      if (mode === 'bomb') {
        if (d.state === 'intro' || d.state === 'playing') {
          if (!mapBuilt) ensureBuild();
          patchSpawnPoints(G);
          disableAI(G); // 兜底再禁一次
        }
      } else {
        if (d.state === 'intro' || d.state === 'playing') {
          restoreOriginal(G);
          enableAI(G);
          // 如果玩家还卡在爆破地图范围，拉回原图
          if (d.state === 'playing' && G.player && G.level.playerStart) {
            const p = G.player.pos;
            if (Math.hypot(p.x - 500, p.z - 500) < 500) {
              const ps = G.level.playerStart;
              const spawnPos = ps.pos || (ps.isVector3 ? ps : null);
              if (spawnPos) {
                G.player.pos.set(spawnPos.x, spawnPos.y, spawnPos.z);
                if (G.player.vel) G.player.vel.set(0, 0, 0);
              }
            }
          }
        }
      }
    });

    // ==================== 爆破模式高频坐标守卫 ====================
    function guardLoop() {
      const G = api.game.G;
      if (G && G.game && api.state.getMode().mode === 'bomb') {
        const st = G.game.state;
        if ((st === 'intro' || st === 'playing') && mapBuilt && G.player) {
          const p = G.player.pos;
          if (Math.hypot(p.x - 500, p.z - 500) > 200) {
            G.player.pos.set(500, 2, 600);
            if (G.player.vel) G.player.vel.set(0, 0, 0);
          }
          patchSpawnPoints(G);
        }
      }
      requestAnimationFrame(guardLoop);
    }
    guardLoop();
  }
};

function patchSpawnPoints(G) {
  if (!G || !G.level) return;
  const spawn = new G.THREE.Vector3(500, 2, 600);
  if (G.level.playerStart) {
    if (G.level.playerStart.pos) G.level.playerStart.pos.copy(spawn);
    else if (G.level.playerStart.isVector3) G.level.playerStart.copy(spawn);
    else if (G.level.playerStart.set) G.level.playerStart.set(500, 2, 600);
  }
  if (G.level.enemySpawns && Array.isArray(G.level.enemySpawns)) {
    G.level.enemySpawns.forEach((s, i) => {
      const a = (i / Math.max(1, G.level.enemySpawns.length)) * Math.PI * 2;
      s.pos.set(500 + Math.cos(a) * 25, 2, 500 + Math.sin(a) * 25);
    });
  }
}

function generateDust2(G) {
  const T = G.THREE, P = G.physics;
  const CX = 500, CZ = 500, CY = 0;

  if (G.camera) { G.camera.far = 2000; G.camera.updateProjectionMatrix(); }
  P.bounds.min.x = Math.min(P.bounds.min.x, CX - 300);
  P.bounds.max.x = Math.max(P.bounds.max.x, CX + 300);
  P.bounds.min.z = Math.min(P.bounds.min.z, CZ - 300);
  P.bounds.max.z = Math.max(P.bounds.max.z, CZ + 300);

  const MAT = {
    floor: new T.MeshBasicMaterial({ color: 0xC2B280 }),
    wall:  new T.MeshBasicMaterial({ color: 0xFF4444 }),
    box:   new T.MeshBasicMaterial({ color: 0x44FF44 }),
    site:  new T.MeshBasicMaterial({ color: 0xFFFF00 }),
    doors: new T.MeshBasicMaterial({ color: 0x4444FF })
  };
  const unitBoxGeo = new T.BoxGeometry(1, 1, 1);

  const addBox = (x, z, w, h, d, type = 'wall') => {
    P.addBox(
      new T.Vector3(CX + x - w/2, CY, CZ + z - d/2),
      new T.Vector3(CX + x + w/2, CY + h, CZ + z + d/2),
      { surface: 'concrete', tag: 'dust2' }
    );
    const m = new T.Mesh(unitBoxGeo, MAT[type]);
    m.position.set(CX + x, CY + h/2, CZ + z);
    m.scale.set(w, h, d);
    G.scene.add(m);
  };

  addBox(0, 0, 300, 1, 300, 'floor');
  addBox(0, 150, 300, 6, 4);
  addBox(0, -150, 300, 6, 4);
  addBox(-150, 0, 4, 6, 300);
  addBox(150, 0, 4, 6, 300);
  addBox(-30, 0, 40, 6, 100);
  addBox(30, 0, 40, 6, 100);
  addBox(-8, 30, 14, 6, 4, 'doors');
  addBox(8, 30, 14, 6, 4, 'doors');
  addBox(80, -80, 40, 0.1, 40, 'site');
  addBox(80, -80, 10, 4, 10, 'box');
  addBox(-80, -80, 40, 0.1, 40, 'site');
  addBox(-80, -80, 10, 4, 10, 'box');

  try { P.build(); } catch (e) { console.warn('build error', e); }
  console.log('[mapmod] ✅ 沙漠灰地图物理数据已写入引擎');
}