```md
---

# Saltline FPS - 模块化联机版

这是一个经过彻底解耦重构的 FPS 游戏项目。采用了现代化的 **事件总线 (Event Bus)** 和 **依赖注入 (DI)** 架构，并内置了强大的 **Mod API** 以及**服务端权威同步**，允许你以插件的形式无限扩展游戏功能（如自定义地图、新玩法模式、深度 UI 定制），而**无需修改任何核心引擎代码**。

## 📂 目录结构

```text
FPS/
├── core/               # 核心底座（无依赖）
│   ├── bus.js          # 事件总线（全局通信）
│   ├── state.js        # 全局状态管理（队伍、分数、准备状态、模式）
│   ├── constants.js    # 常量与配置
│   ├── util.js         # 通用工具函数
│   ├── mod-api.js      # Mod 统一注入器（负责扫描并加载 mods/ 目录）
│   ├── pointer-lock.js # 鼠标锁定与解锁管理（支持外部临时抑制提示）
│   └── shortcuts.js    # 浏览器快捷键拦截（屏蔽 Ctrl+S 等）
├── services/           # 外部服务
│   └── net.js          # WebSocket 网络连接
├── features/           # 玩法逻辑（互相解耦）
│   ├── match.js        # 比赛流程、计分(PvP/AI分离)、胜负判定
│   ├── combat.js       # 战斗、射线检测、视野
│   ├── relay.js        # 中继器交互、主机权威同步
│   ├── entities.js     # 远程玩家模型、插值、血条
│   └── scoring.js      # 伤害记账、助攻计算
├── ui/                 # 界面渲染（只订阅事件，不干涉逻辑）
│   ├── hud.js          # 倒计时、击杀播报、Tab计分板
│   ├── lobby.js        # 大厅：红蓝双列队伍选择、模式/时间/子目标、准备/DEPLOY/SETTINGS
│   └── ingame.js       # 小地图、小队面板、全屏控制
├── mods/               # Mod 插件目录（自动扫描加载）
│   ├── mods.config.json  # Mod 配置：禁用列表
│   ├── dust2-map.js      # 示例：沙漠灰地图生成 & AI禁用/恢复逻辑
│   ├── bomb-mod.js       # 示例：C4爆破模式（下包/拆包/观战/回合结算）
│   ├── ads-mode.js       # 示例：开镜方式切换（原生UI注入）
│   └── maps/             # 支持子目录，路径在配置中用相对路径
│       └── map-one.js
├── patches.js          # 引擎底层 Hook（注入游戏主循环、网络包拦截）
├── router.js           # 网络消息路由分发
├── main.js             # 组装与启动入口
├── server.js           # WebSocket + 静态文件托管服务端（一站式）
└── index.html          # 游戏主页面
```

---

## 🚀 如何运行

**⚠️ 注意：项目使用 ES Module (ESM)，必须通过 HTTP 服务器运行。`server.js` 已内置了静态文件托管，所以只需启动这一个服务即可。**

1. **启动服务端**：
   ```bash
   node server.js
   ```
   *(默认监听 8787 端口，同时提供 WebSocket 联机和 HTML/JS 静态文件)*

2. **在浏览器中访问**：
   ```text
   http://localhost:8787/index.html?net=ws://localhost:8787
   ```
   *(局域网联机时，将 `localhost` 换成本机的局域网 IP 即可)*

---

## 🛠️ 如何开发 Mod

现在的 Mod 加载是 **目录扫描式**：`mods/` 下的所有 `.js` 文件（含子目录）都会被自动加载。**不需要手动 import，也不需要维护注册清单。**

### 1. 编写一个 Mod (`mods/my-mod.js`)

一个标准的 Mod 是一个导出的对象。`onInit` 会在游戏引擎完全加载、API 准备好后自动调用。

```javascript
export default {
  name: '我的酷炫 Mod',
  version: '1.0.0',
  
  onInit(api) {
    api.log('Mod 已加载！');

    // 示例：开局强制改血量，并在击杀时播报
    api.bus.on('game:state', (d) => {
      if (d.state === 'playing' && api.game.G.player) {
        api.game.G.player.health = 9999;
      }
    });

    api.bus.on('net:kill', (m) => {
      if (m.killerId === api.state.me) {
        api.game.G.hud.message('你击杀了一个目标！', 2);
      }
    });
  }
};
```

### 2. 配置加载（`mods.config.json`）

默认 **全部加载**。如果某个 Mod 你暂时不想加载（调试、A/B 测试、某个 mod 冲突临时停掉），把它加入 `disabled` 列表即可。路径写相对于 `mods/` 目录的路径：

```json
{
  "disabled": [
    "my-mod.js",
    "maps/map-one.js",
    "custom-lobby.js"
  ]
}
```

*   **新增文件**：直接丢进 `mods/`（或子目录），下次刷新页面自动加载，无需改任何代码。
*   **临时禁用**：把相对路径加进 `disabled`。
*   **恢复启用**：从 `disabled` 里删掉即可。
*   **依赖顺序**：加载顺序由 `mod-api.js` 的扫描逻辑决定（文件系统扫描顺序）。如果某个 Mod 依赖另一个 Mod 已建好的对象（比如 `bomb-mod.js` 依赖 `dust2-map.js` 已经建好地图），建议在开发时通过 `api.bus` 事件协调（例如 `state:mode` 触发时再建图），而不是依赖模块加载顺序。

---

## 📖 核心 API 参考手册

在 Mod 的 `onInit(api)` 中，你可以使用以下接口（所有接口均已适配联机环境）：

### 1. `api.state` - 全局状态读写
负责同步服务端的玩家、队伍、比赛状态。
*   `api.state.me`：自己客户端的唯一 UUID。
*   `api.state.getPlayerName()` / `.setPlayerName(n)`：获取/设置玩家名。
*   `api.state.getMyTeam()`：自己的队伍 (`'red'` / `'blue'` / `null`)。
*   `api.state.getTeam(id)`：获取某人的队伍。
*   `api.state.getMode()`：获取当前模式 `{ mode, target, attackTeam, timeScale }`。
*   `api.state.isHost()`：是否为房主。
*   `api.state.getReady(id)` / `.setReady(id, bool)`：获取/设置准备状态。

### 2. `api.bus` - 事件总线（极其重要）
用于模块间通信，监听网络事件或自定义事件。

**常用监听事件 (`api.bus.on`)：**
*   `'game:state'`：游戏状态改变 `{ state, prev }` （如 title/playing/complete）。
*   `'net:kill'`：击杀发生 `{ killerId, killerName, victimId, victimName, assistIds }`。
    *(注：如果 `victimId` 为空，说明击杀的是 AI)*
*   `'net:p_hit'`：玩家被击中 `{ target, dmg, from }`。
*   `'net:ph'`：玩家受伤害 `{ target, a, f }`。
*   `'net:pd'`：玩家死亡 `{ target }`。
*   `'state:mode'`：模式切换。
*   `'state:ready-changed'`：玩家准备状态改变。

**常用触发事件 (`api.bus.emit`)：**
*   `'kill:feed'`：产生一条击杀播报 `{ killer, victim, assists }`。
*   `'objective:refresh'`：强制刷新 HUD 目标文字。
*   `'ui:scoreboard-refresh'`：强制刷新 Tab 计分板。

### 3. `api.game` - 底层引擎操作（慎用，但极其强大）
直接访问底层 Three.js 实例和物理引擎，可以自由创造地图、修改模型等。
*   `api.game.G.player`：玩家对象（可改 `pos`, `vel`, `health`, `alive` 等）。
*   `api.game.G.physics`：物理引擎（包含 `addBox`, `bounds`, `raycast`）。
*   `api.game.G.scene`：Three.js 场景（可 `add()` 自定义 Mesh 几何体）。
*   `api.game.G.hud.message(text, seconds)`：屏幕上方黄字提示。
*   `api.game.G.hud.warn(text, seconds)`：屏幕中央红字警告。

### 4. `api.match` - 比赛控制（主机权威）
只有在 `api.state.isHost()` 为 `true` 时才生效。用于控制胜负和计分。
*   `api.match.hostApplyKill(killerId, isAi)`：结算击杀分（PvP加比赛分，AI不加）。
*   `api.match.hostApplyCut(cutterId)`：给指定玩家加 1 切断分。
*   `api.match.endMatch(winnerTeam, source)`：强制结束比赛。
*   `api.match.resetToTitle()`：全员退回主菜单。

### 5. `api.net` - 网络通信
*   `api.net.send({ t: '自定义指令', ... })`：发送自定义数据包给服务器。
*(注：如果需要在联机中同步，需在 `server.js` 添加对应的白名单和转发逻辑)*。

### 6. `window.__pointerLockHint` - 鼠标锁定提示抑制（UI 层专用）

在 `core/pointer-lock.js` 中挂载的全局单例。任何需要**临时接管鼠标**的全屏 UI（结算页、死亡观战、自定义暂停菜单、非原生设置面板）都可以用它来屏蔽"点击画面锁定鼠标"提示，避免提示常驻在屏幕上。

```javascript
// 进入需要独占鼠标的 UI 时调用
window.__pointerLockHint?.suppress();

// 回到正常游戏（新回合开始）时调用
window.__pointerLockHint?.resume();
```

**行为说明：**
*   `suppress()`：设置 `window.__suppressPointerLockHint = true`，并立即移除已存在的 `#pointer-lock-tip` 元素。之后 `pointer-lock.js` 在 `playing` 状态下会跳过提示逻辑。
*   `resume()`：清除标志，并重置内部 `hasWarned` 标志，下一次 `game:state = playing` 时会重新走显示逻辑。
*   **引用计数注意**：目前是布尔开关，多个 UI 同时使用需要约定"谁先 suppress 谁负责 resume"；如果将来出现多个消费者，建议改为计数式。

**典型用法（参考 `mods/bomb-mod.js`）：**
```javascript
api.bus.on('game:state', (d) => {
  if (d.state === 'playing') {
    window.__pointerLockHint?.resume();
    // ...其他恢复逻辑
  }
});

// 结算 overlay 显示时：
window.__pointerLockHint?.suppress();
```

---

## 🚀 进阶实战教程

### 实战 1：如何生成一张新地图？
利用 `api.game.G.physics.addBox` 可以动态添加物理碰撞箱，利用 `api.game.G.scene.add()` 添加对应的 Three.js 视觉模型。
参考代码见 `mods/dust2-map.js`：
```javascript
const T = api.game.G.THREE;
const P = api.game.G.physics;
// 添加一个物理墙壁
P.addBox(new T.Vector3(-10, 0, -10), new T.Vector3(10, 5, 10), { surface: 'concrete' });
// 注意：添加完需要调用 P.build() 重新烘焙物理
```

### 实战 2：如何深度定制 UI？
你可以直接使用 `document.createElement` 创建任意 HTML 元素，因为游戏是跑在浏览器里的。
**如果要向原生的菜单中注入：**
1. 找到原生 DOM（例如通过 `document.querySelector('.m-actions')`）。
2. 利用 `appendChild` 把你的按钮塞进去。
参考代码见 `mods/ads-mode.js`（精准定位到了 `FULLSCREEN` 按钮旁边）。

**如果要做全屏接管型 UI（如结算、暂停）：**
1. 用 `fixed` + 高 `z-index` 覆盖层。
2. 调用 `window.__pointerLockHint?.suppress()` 释放鼠标并屏蔽锁定提示。
3. 用 `document` 捕获阶段拦截键盘/鼠标事件，防止穿透到游戏。
4. 关闭时调用 `window.__pointerLockHint?.resume()` 恢复。

### 实战 3：如何做一个新玩法模式（如爆破）？
1. 在大厅模式下，发送 `api.net.send({ t: 'set_mode', mode: 'bomb', target: 1 })`。
2. 监听 `api.bus.on('game:state')`，当状态变为 `playing` 且当前是 `bomb` 模式时，启动你的状态机（如定时器、下包逻辑）。
3. 如果是主机，借用 `api.match` 或自定义逻辑结算输赢。
4. 需要回合结算 UI 时，参考 `mods/bomb-mod.js` 的指针锁定 + 输入拦截 + 冻结玩家写法。

---

## 🔍 调试与诊断

如果在游玩过程中发现联机状态异常，或者想做测试，可以按 `F12` 打开控制台：

1. **查看全局运行状态**：输入 `__relay_state()`，返回当前房主、模式、比分、在线人数。
2. **查看 Mod 系统状态**：输入 `window.SaltlineAPI`，查看你注入的 API 结构。
3. **强制解锁鼠标**：如果因报错导致鼠标无法点击菜单，在控制台输入 `document.exitPointerLock()`。
4. **抑制/恢复鼠标锁定提示**：`window.__pointerLockHint.suppress()` / `.resume()`。
5. **检查鼠标锁定状态**：`document.pointerLockElement` 为 `null` 说明未锁定，非 `null` 说明已锁定。

### 常见问题

**Q：我新建的 mod 没有加载？**  
A：检查 `mods/mods.config.json` 的 `disabled` 列表里是否包含它。路径相对于 `mods/` 目录，子目录要带上前缀，例如 `maps/map-one.js`。同时确认文件确实导出 `default { onInit(api) {} }`，控制台查看是否有解析错误。

**Q：我禁用某个 mod 后，另一个 mod 报错？**  
A：说明两个 mod 存在依赖关系（例如 `bomb-mod.js` 依赖 `dust2-map.js` 建的地图）。禁用依赖方之前，先确认被依赖方还能独立工作，或者调整 `bomb-mod.js` 的逻辑让它能容忍地图未加载。

**Q：结算页出现后，"点击游戏画面以锁定鼠标"提示常驻在屏幕上？**  
A：这是 `pointer-lock.js` 在 `playing` 状态下检测到鼠标未锁定而弹出的提示。结算类 UI 需要在显示时调用 `window.__pointerLockHint?.suppress()`，并在新回合 `game:state = playing` 时调用 `.resume()`。参考 `mods/bomb-mod.js`。

**Q：结算页出现后，玩家仍能用键盘移动/射击？**  
A：`pointer-lock` 只管理鼠标，键盘输入需要 UI 层自己拦截。需要在冻结期间：1) 监听 `document` 捕获阶段 `keydown/keyup/pointerdown/click` 并 `stopPropagation`；2) 每帧强制 `player.vel.set(0,0,0)` 并复位 `player.pos`，防止位置漂移。

**Q：点击结算页的"重新部署"没反应，需要先按 ESC？**  
A：说明鼠标仍处于锁定状态，光标不可见。解决方法是结算出现时立即 `document.exitPointerLock()`，并用 `setInterval` 持续检查（80ms 一次）防止游戏重新请求锁定。
```

### 改动摘要

| 章节 | 改动 |
|---|---|
| 目录结构 | `mods/index.js` → `mods/mods.config.json`；增加 `mods/maps/` 子目录示例 |
| 「如何开发 Mod」 | 第 2 步从"手动 import 注册"改为"放到目录 + 用 `disabled` 排除"；补充加载顺序说明 |
| 其余章节 | 保持上一版内容（含 `window.__pointerLockHint`、常见问题等） |
| FAQ | 新增「mod 没加载」「禁用后另一个 mod 报错」两条 |