export function installRouter({ bus, state }) {
  // ============ 状态类消息 ============
  bus.on('net:welcome', (m) => {
    if (typeof m.online === 'number') state.setOnlineCount(m.online);
    if (m.teams) state.applyTeamSync(m.teams, m.names);
    if (m.team) state.setMyTeam(m.team);
    if (m.mode) state.setMode({ mode: m.mode, target: m.target || 10, attackTeam: m.attackTeam || 'red', timeScale: m.timeScale || 'standard' });
    if (m.scores) state.setScoresBatch(m.scores);
    if (m.readyStates) state.applyReadySync(m.readyStates); 
    state.setHostId(m.host || null);
    bus.emit('net:welcome-applied', m);
  });
  bus.on('net:host', (m) => state.setHostId(m.id || null));
  bus.on('net:teams', (m) => state.applyTeamSync(m.teams, m.names));
  bus.on('net:scores', (m) => { if (m?.scores) state.setScoresBatch(m.scores); });
  bus.on('net:online', (m) => { if (typeof m.count === 'number') state.setOnlineCount(m.count); });
  bus.on('net:mode', (m) => {
    if (m.from === state.me) return;
    state.patchMode({ mode: m.mode || 'vs', target: m.target || 10, attackTeam: m.attackTeam || 'red' });
  });
  bus.on('net:time', (m) => { if (m.from === state.me) return; state.patchMode({ timeScale: m.scale || 'standard' }); });

  // ============ 事件类消息（大部分直接透传 bus，各 feature 订阅自己关心的） ============
  // 只做极少需要合并处理的：
  bus.on('net:leave', (m) => {
    state.setTeam(m.id, null);
    state.deleteName(m.id);
    state.deleteScore(m.id);
    state.deleteDamagers(m.id);
    state.deleteVisible(m.id);
    bus.emit('leave:player', m.id);
  });
  bus.on('net:start', (m) => {
    if (!state.isHost()) {
      state.setPendingMode({ mode: m.mode || 'vs', target: m.target || 10, attackTeam: m.attackTeam || 'red', timeScale: m.timeScale || 'standard' });
      bus.emit('game:start-request', m.o || {});
    }
    bus.emit('ui:hide-team-selector');
  });
  bus.on('net:start_denied', () => bus.emit('game:start-denied'));
  bus.on('net:back_title', () => bus.emit('game:reset-title-request'));
  // router.js - 在 installRouter 里的 net:teams 下方添加
  bus.on('net:ready_states', (m) => {
    if (m && m.readyStates) state.applyReadySync(m.readyStates);
  });
}