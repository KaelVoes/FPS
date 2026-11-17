export function createState({ bus, me, initialPlayerName }) {
  const teams = {}, names = {}, scores = {};
  const readyStates = {};
  let myTeam = (() => {
    const t = localStorage.getItem('saltline_player_team');
    return t === 'red' || t === 'blue' ? t : null;
  })();
  let playerName = initialPlayerName || localStorage.getItem('saltline_player_name') || 'Player';
  let currentMode = { mode: 'vs', target: 10, attackTeam: 'red', timeScale: 'standard' };
  let pendingMode = null, hostId = null, onlineCount = 0;
  let lastAttackerId = null, lastAttackerName = null, deadReported = false;
  const recentDamagers = new Map();
  const visibleEnemies = new Set();

  return {
    me,

    getPlayerName: () => playerName,
    setPlayerName(n) { playerName = n; localStorage.setItem('saltline_player_name', n); bus.emit('state:name-self', n); },
    getMyTeam: () => myTeam,
    setMyTeam(t) { myTeam = t; localStorage.setItem('saltline_player_team', t); bus.emit('state:team-self', t); },

    getTeam: (id) => teams[id],
    getTeamDict: () => teams,
    setTeam(id, t) {
      if (teams[id] === t) return;
      if (t) teams[id] = t; else delete teams[id];
      bus.emit('state:teams', { id, team: t });
    },
    applyTeamSync(newTeams, newNames) {
      let changed = false;
      if (newTeams) {
        for (const id of Object.keys(teams)) if (!(id in newTeams)) { delete teams[id]; changed = true; }
        for (const id in newTeams) if (teams[id] !== newTeams[id]) { teams[id] = newTeams[id]; changed = true; }
      }
      if (newNames) for (const id in newNames) if (names[id] !== newNames[id]) { names[id] = newNames[id]; changed = true; }
      if (changed) bus.emit('state:teams-changed');
      return changed;
    },
    deleteTeam(id) { delete teams[id]; bus.emit('state:teams', { id }); },

    getName: (id) => names[id],
    setName(id, n) { if (names[id] === n) return; names[id] = n; bus.emit('state:names', { id, name: n }); },
    deleteName(id) { delete names[id]; },

    getScore: (id) => scores[id],
    getAllScores: () => scores,
    setScoresBatch(s) { for (const k in scores) delete scores[k]; Object.assign(scores, s || {}); bus.emit('state:scores'); },
    deleteScore(id) { delete scores[id]; bus.emit('state:scores'); },

    getMode: () => currentMode,
    setMode(m) { currentMode = { ...m }; bus.emit('state:mode', currentMode); },
    patchMode(m) { currentMode = { ...currentMode, ...m }; bus.emit('state:mode', currentMode); },
    getPendingMode: () => pendingMode,
    setPendingMode(m) { pendingMode = m; },
    clearPendingMode() { pendingMode = null; },

    isHost: () => hostId === me,
    getHostId: () => hostId,
    setHostId(id) { hostId = id; bus.emit('state:host', id); },
    getOnlineCount: () => onlineCount,
    setOnlineCount(n) { onlineCount = n; bus.emit('state:online', n); },

    getLastAttacker: () => ({ id: lastAttackerId, name: lastAttackerName }),
    setLastAttacker(id, name) { lastAttackerId = id; lastAttackerName = name; },
    clearLastAttacker() { lastAttackerId = null; lastAttackerName = null; },
    isDeadReported: () => deadReported,
    setDeadReported(v) { deadReported = v; },

    getDamagers: (vid) => recentDamagers.get(vid),
    setDamagers: (vid, m) => recentDamagers.set(vid, m),
    deleteDamagers: (vid) => recentDamagers.delete(vid),

    getVisibleEnemies: () => visibleEnemies,
    hasVisible: (id) => visibleEnemies.has(id),
    setVisibleBatch(set) { visibleEnemies.clear(); for (const id of set) visibleEnemies.add(id); },
    addVisible(id) { visibleEnemies.add(id); },
    deleteVisible(id) { visibleEnemies.delete(id); },
    clearVisible() { visibleEnemies.clear(); },
    // core/state.js - 在 team 相关的代码下方
    getReady: (id) => !!readyStates[id],
    setReady(id, r) { 
      if (readyStates[id] === r) return; 
      readyStates[id] = r; 
      bus.emit('state:ready-changed'); 
    },
    applyReadySync(map) {
      let changed = false;
      for (const id in map) {
        if (readyStates[id] !== map[id]) { readyStates[id] = map[id]; changed = true; }
      }
      if (changed) bus.emit('state:ready-changed');
    },
  };
}