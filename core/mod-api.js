// core/mod-api.js
export function createModAPI({ state, bus, game, net, match, relay, combat, entities, scoring, hud, lobby, ingame }) {
  // 暴露给 Mod 的基础 API
  return {
    version: '1.0.0',
    state,    // 读写玩家、队伍、分数
    bus,      // 事件总线（监听/触发事件）
    game,     // 底层引擎 G (慎用，G.game, G.player 等)
    net,      // 网络发送 net.send(...)
    match,    // 比赛逻辑 (hostApplyKill 等)
    relay,    // 中继器逻辑
    combat,   // 战斗逻辑
    entities, // 玩家实体模型
    scoring,  // 伤害/助攻记账
    hud,      // UI 界面
    lobby,    // 大厅界面
    ingame,   // 游戏内界面

    // 一个方便 Mod 输出日志的工具
    log: (msg) => console.log(`%c[Mod] ${msg}`, 'color: #ffb347; font-weight: bold;'),
    
    // 注册接口
    register(mod) {
      if (!mod || !mod.name) return console.warn('无效的 Mod');
      console.log(`[System] 正在加载 Mod: ${mod.name} v${mod.version || '1.0.0'}`);
      if (typeof mod.onInit === 'function') {
        try { mod.onInit(this); } catch (e) { console.error(`[Mod Error] ${mod.name} 初始化失败:`, e); }
      }
    }
  };
}