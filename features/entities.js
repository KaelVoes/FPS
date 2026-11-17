import { tint } from '../core/util.js';

export function createEntities({ state, bus, game }) {
  const remotes = new Map();
  const ME = state.me;

  function isAlly(id) {
    if (id === ME) return true;
    const serverTeam = state.getTeam(id);
    if (serverTeam === 'red' || serverTeam === 'blue') return serverTeam === state.getMyTeam();
    const rem = remotes.get(id);
    if (rem && (rem.team === 'red' || rem.team === 'blue')) return rem.team === state.getMyTeam();
    return false;
  }

  function makeNameSprite(id, isAllyFlag) {
    const G = game.G;
    const text = state.getName(id) || id.slice(0, 5);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256; canvas.height = 64;
    ctx.font = 'bold 32px "IBM Plex Mono", monospace';
    ctx.fillStyle = isAllyFlag ? '#44ff44' : '#ff4444';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillText(text, 128, 32);
    const tex = new G.THREE.CanvasTexture(canvas);
    const mat = new G.THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sprite = new G.THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.375, 1); sprite.position.y = 0.4;
    return sprite;
  }

  function getRemote(id) {
    let r = remotes.get(id);
    if (r) return r;
    const G = game.G, THREE = G.THREE;
    const mat = G.mats.get('polymer_black', { triplanar: true, vertexColors: true });
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    const body = new THREE.Mesh(tint(G, new THREE.CapsuleGeometry(0.32, 1.1, 4, 8), 0.55, 0.58, 0.6), mat);
    body.position.y = 0.9; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(tint(G, new THREE.SphereGeometry(0.15, 12, 8), 0.7, 0.72, 0.74), mat);
    head.position.y = 1.62; head.castShadow = true; g.add(head);
    g.visible = false; G.scene.add(g);
    const billboard = new THREE.Group(); billboard.visible = false; G.scene.add(billboard);
    const nameSprite = makeNameSprite(id, false); billboard.add(nameSprite);
    const hpBgMat = new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false, transparent: true, opacity: 0.8, depthWrite: false });
    const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.1), hpBgMat); hpBg.renderOrder = 998; billboard.add(hpBg);
    const hpFillMat = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, transparent: true, depthWrite: false });
    const hpFillGeo = new THREE.PlaneGeometry(1.0, 0.1); hpFillGeo.translate(0.5, 0, 0);
    const hpFill = new THREE.Mesh(hpFillGeo, hpFillMat); hpFill.position.set(-0.5, 0, 0.01); hpFill.renderOrder = 999; billboard.add(hpFill);
    r = { group: g, billboard, buf: [], last: 0, maxHp: 100, hpFill, nameSprite, team: null, seen: [], lastHp: 100, pitch: 0, ghost: false };
    remotes.set(id, r);
    return r;
  }

  function refreshSprites() {
    remotes.forEach((r, id) => {
      r.billboard.remove(r.nameSprite);
      r.nameSprite = makeNameSprite(id, isAlly(id));
      r.billboard.add(r.nameSprite);
    });
  }

  function updateRemotes(dt) {
    const G = game.G;
    const k = 1 - Math.exp(-16 * dt);
    remotes.forEach((r, id) => {
      // 👻 幽灵玩家：完全隐藏，跳过所有更新
      if (r.ghost) {
        r.group.visible = false;
        r.billboard.visible = false;
        return;
      }
      const l = r.buf[r.buf.length - 1];
      if (!l) { r.group.visible = false; r.billboard.visible = false; return; }
      r.group.visible = !!l.al;
      r.billboard.visible = !!l.al && (isAlly(id) || state.hasVisible(id));
      const p = r.group.position;
      p.x += (l.x - p.x) * k; p.y += (l.y - p.y) * k; p.z += (l.z - p.z) * k;

      // yaw 平滑 + 归一化
      let dy = l.yaw - r.group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.group.rotation.y += dy * k;
      r.group.rotation.y = Math.atan2(Math.sin(r.group.rotation.y), Math.cos(r.group.rotation.y));
      r.group.rotation.order = 'YXZ';
      r.group.rotation.x = 0;

      // pitch 独立字段
      const targetPitch = l.pitch || 0;
      r.pitch = (r.pitch || 0) + (targetPitch - (r.pitch || 0)) * k;

      if (l.hp !== r.lastHp) {
        r.lastHp = l.hp;
        const ratio = Math.max(0, Math.min(1, l.hp / r.maxHp));
        r.hpFill.scale.x = ratio;
        r.hpFill.material.color.setHSL(isAlly(id) ? 0.33 : ratio * 0.3, 1, 0.5);
      }
      r.billboard.position.set(p.x, p.y + 2.1, p.z);
      r.billboard.quaternion.copy(G.camera.quaternion);
      if (r.buf.length > 8) r.buf.shift();
      if (performance.now() - r.last > 4000) { r.group.visible = false; r.billboard.visible = false; }
    });
  }

  bus.on('state:teams-changed', refreshSprites);
  bus.on('state:names', () => refreshSprites());
  bus.on('state:team-self', () => refreshSprites());
  bus.on('net:pp', (m) => {
    if (m.id === ME) return;
    const r = getRemote(m.id);
    r.last = performance.now();
    r.seen = Array.isArray(m.seen) ? m.seen : [];
    r.ghost = !!m.ghost;
    if (m.name && state.getName(m.id) !== m.name) { state.setName(m.id, m.name); }
    if ((m.team === 'red' || m.team === 'blue') && (r.team !== m.team || state.getTeam(m.id) !== m.team)) {
      r.team = m.team;
      state.setTeam(m.id, m.team);
    }
    if (isAlly(m.id)) for (const eid of r.seen) if (eid !== ME) state.addVisible(eid);
    // 【B/E】带上 eh（eyeHeight）和 vx/vz（速度），供观战/动画使用
    r.buf.push({
      x: m.x, y: m.y, z: m.z,
      yaw: m.yaw, pitch: m.pitch || 0,
      al: m.al, hp: m.hp,
      eh: m.eh, vx: m.vx || 0, vz: m.vz || 0,
    });
  });
  bus.on('leave:player', (id) => {
    const r = remotes.get(id);
    if (r) { game.G.scene.remove(r.group); game.G.scene.remove(r.billboard); remotes.delete(id); }
  });

  return { isAlly, getRemote, makeNameSprite, updateRemotes, getRemotes: () => remotes };
}