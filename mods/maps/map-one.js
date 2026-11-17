// mods/map-one.js
const CONFIG = {
  origin: { x: 149, y: 0, z: -21 },
  radius: 30,
  wallHeight: 5,
  cover: [6, 3, 6],
  playerSpawnOffset: { x: 0, y: 1, z: 20 },
  enemyRingRadius: 20,
};

export default {
  name: '新地图生成器',
  version: '1.4.0', // 修复寻路范围污染
  onInit(api) {
    api.log('地图 Mod 已加载，等待进入游戏...');
    let applied = false;
    let lastState = '';

    setInterval(() => {
      const G = api.game.G;
      if (!G || !G.game) return;
      const currentState = G.game.state;

      if (currentState === 'playing' && lastState !== 'playing') {
        applied = false;
        setTimeout(() => {
          if (!applied && G.player && G.physics) {
            const ok = applyNewMap(G);
            if (ok) {
              applied = true;
              console.log('%c[mapmod] ✅ 新地图已加载', 'color:#0f0;font-weight:bold;font-size:16px;');
            }
          }
        }, 1000);
      }
      lastState = currentState;
    }, 300);
  }
};

function applyNewMap(G) {
  if (!G || !G.game || !G.player || !G.physics || !G.enemies) return false;
  const T = G.THREE, P = G.physics;
  if (!T || !P) return false;

  const { x: cx, y: cy, z: cz } = CONFIG.origin;
  const R = CONFIG.radius, H = CONFIG.wallHeight;

  // 1) 扩展物理边界
  P.bounds.min.x = Math.min(P.bounds.min.x, cx - R - 20);
  P.bounds.max.x = Math.max(P.bounds.max.x, cx + R + 20);
  P.bounds.min.z = Math.min(P.bounds.min.z, cz - R - 20);
  P.bounds.max.z = Math.max(P.bounds.max.z, cz + R + 20);

  // 2) 绘制并生成物理碰撞体
  const addBox = (mn, mx, color) => {
    P.addBox(
      new T.Vector3(mn[0], mn[1], mn[2]),
      new T.Vector3(mx[0], mx[1], mx[2]),
      { surface: 'concrete', tag: 'newmap' }
    );
    if (color !== null) {
      const sx = mx[0]-mn[0], sy = mx[1]-mn[1], sz = mx[2]-mn[2];
      const px = (mn[0]+mx[0])/2, py = (mn[1]+mx[1])/2, pz = (mn[2]+mx[2])/2;
      const m = new T.Mesh(
        new T.BoxGeometry(sx, sy, sz),
        new T.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1 })
      );
      m.position.set(px, py, pz);
      m.castShadow = m.receiveShadow = true;
      m.userData.mapmod = true;
      G.scene.add(m);
    }
  };

  addBox([cx-R, cy-1, cz-R], [cx+R, cy, cz+R], 0x2a3a42); // 地板
  addBox([cx-R, cy, cz-R], [cx+R, cy+H, cz-R+1], 0x556066); // 后墙
  addBox([cx-R, cy, cz+R-1], [cx+R, cy+H, cz+R], 0x556066); // 前墙
  addBox([cx-R, cy, cz-R], [cx-R+1, cy+H, cz+R], 0x556066); // 左墙
  addBox([cx+R-1, cy, cz-R], [cx+R, cy+H, cz+R], 0x556066); // 右墙
  
  const [cW, cH, cD] = CONFIG.cover;
  addBox([cx-cW/2, cy, cz-cD/2], [cx+cW/2, cy+cH, cz+cD/2], 0xd2622a); // 中心掩体

  try { P.build(); } catch (e) { console.warn('[mapmod] 物理构建失败', e); }

  // ❌ 删除了原本这里的 nav.isWalkable 劫持逻辑

  // 4) 修改未来的敌人出生点
  const spawns = G.level.enemySpawns || [];
  spawns.forEach((s, i) => {
    const a = (i / spawns.length) * Math.PI * 2;
    s.pos.set(cx + Math.cos(a)*CONFIG.enemyRingRadius, cy+1, cz + Math.sin(a)*CONFIG.enemyRingRadius);
  });

  // 5) 传送玩家
  const sp = new T.Vector3(cx + CONFIG.playerSpawnOffset.x, cy + CONFIG.playerSpawnOffset.y, cz + CONFIG.playerSpawnOffset.z);
  if (G.level.playerStart) {
    if (G.level.playerStart.pos) G.level.playerStart.pos.copy(sp);
    else if (G.level.playerStart.isVector3) G.level.playerStart.copy(sp);
  }
  G.player.pos.copy(sp);
  G.player.vel.set(0, 0, 0);
  G.player.onGround = false;
  G.player.invulnerable = true;
  setTimeout(() => { if (G.player) G.player.invulnerable = false; }, 3000);

  // 6) 传送场上现有的敌人
  if (G.enemies && G.enemies.list) {
    const alive = G.enemies.list.filter(e => e.alive && e.active);
    alive.forEach((e, i) => {
      const a = (i / alive.length) * Math.PI * 2;
      const r = 12 + Math.random() * 8;
      e.pos.set(cx + Math.cos(a) * r, cy + 0.1, cz + Math.sin(a) * r);
      if (e.vel) e.vel.set(0, 0, 0);
      
      // 清空旧地图的寻路路径，让它们在物理碰撞下重新算
      if (e.path) e.path = [];
      if (e.pathIndex !== undefined) e.pathIndex = 0;
      
      if (e.lastKnown && G.player) {
        e.lastKnown.copy(G.player.pos);
      }
    });
  }

  return true;
}