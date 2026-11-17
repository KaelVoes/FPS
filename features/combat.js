import { raySphere } from '../core/util.js';

export function createCombat({ state, bus, game, net, entities }) {
  function localPvPCheck(origin, dir, shooterId) {
    for (const [id, rem] of entities.getRemotes()) {
      if (id === shooterId || !rem.group.visible || entities.isAlly(id)) continue;
      const center = rem.group.position.clone(); center.y += 0.9;
      if (raySphere(game.G, origin, dir, center, 0.65, 150) > 0) {
        // recordDamage 由 patch 或外部负责，这里直接打 remote 和 notify
        bus.emit('combat:hit-confirmed', { target: id, from: shooterId });
        return true;
      }
    }
    return false;
  }
  function updateVision() {
    const G = game.G;
    if (!G || !G.player || !G.game || G.game.state !== 'playing') { state.clearVisible(); return []; }
    const p = G.player, eye = p.eye;
    const forward = new G.THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    const newSeen = [];
    for (const [id, rem] of entities.getRemotes()) {
      if (entities.isAlly(id) || !rem.group.visible) continue;
      const target = rem.group.position.clone(); target.y += 1.0;
      const dist = eye.distanceTo(target);
      if (dist > 70) continue;
      const dir = target.clone().sub(eye).normalize();
      if (forward.dot(dir) < 0.4) continue;
      const hit = G.physics.raycast(eye, dir, dist);
      if (!hit || hit.dist >= dist - 0.5) newSeen.push(id);
    }
    const set = new Set(newSeen);
    for (const [id, rem] of entities.getRemotes()) {
      if (entities.isAlly(id) && rem.seen) for (const eid of rem.seen) if (eid !== state.me) set.add(eid);
    }
    state.setVisibleBatch(set);
    return newSeen;
  }
  return { localPvPCheck, updateVision };
}