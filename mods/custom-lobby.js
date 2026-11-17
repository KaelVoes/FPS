// mods/custom-lobby.js - 完全接管大厅 UI
export default {
  name: '自定义大厅 UI',
  version: '1.0.0',
  onInit(api) {
    // ==================== 1. 创建自定义的 UI 容器 ====================
    const customLobby = document.createElement('div');
    customLobby.id = 'custom-lobby-root';
    // 默认隐藏，进入 title 状态时再显示
    customLobby.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9000;display:none;background:url("https://images.unsplash.com/photo-1552820728-8b83bb6b773f?q=80&w=2070&auto=format&fit=crop") center/cover; font-family:"Barlow Condensed",sans-serif;';
    
    // 你的自定义 HTML 结构
    customLobby.innerHTML = `
      <div style="position:absolute;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(5px);"></div>
      
      <!-- 左侧：个人信息与队伍 -->
      <div style="position:absolute;left:5%;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:20px;width:300px;z-index:10;">
        <div style="font-size:40px;color:#fff;font-weight:900;letter-spacing:2px;text-shadow:0 0 10px #000;">SALTLINE FPS</div>
        
        <div style="display:flex;gap:10px;">
          <input id="cust-name" type="text" value="${api.state.getPlayerName()}" style="flex:1;padding:10px;background:rgba(255,255,255,0.1);border:1px solid #555;color:#fff;font-size:16px;">
          <button id="cust-save-name" style="padding:0 15px;background:#ffb347;border:none;cursor:pointer;font-weight:bold;">保存</button>
        </div>

        <div style="display:flex;gap:10px;">
          <button id="cust-team-red" class="team-btn" style="flex:1;padding:15px;border:2px solid #444;background:transparent;color:#888;cursor:pointer;font-size:18px;font-weight:bold;transition:0.2s;">RED</button>
          <button id="cust-team-blue" class="team-btn" style="flex:1;padding:15px;border:2px solid #444;background:transparent;color:#888;cursor:pointer;font-size:18px;font-weight:bold;transition:0.2s;">BLUE</button>
        </div>

        <button id="cust-ready" style="padding:15px;font-size:20px;font-weight:900;cursor:pointer;border:none;transition:0.2s;">准备状态</button>
      </div>

      <!-- 右侧：玩家列表 -->
      <div style="position:absolute;right:5%;top:50%;transform:translateY(-50%);width:250px;background:rgba(11,13,15,0.8);border:1px solid #555;padding:20px;z-index:10;">
        <div style="font-size:24px;color:#ffcc00;margin-bottom:15px;text-align:center;letter-spacing:2px;">ONLINE</div>
        <div id="cust-player-list" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>

      <!-- 底部：模式选择与部署 -->
      <div style="position:absolute;bottom:5%;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:15px;z-index:10;width:800px;">
        <div id="cust-mode-list" style="display:flex;gap:10px;justify-content:center;"></div>
        <button id="cust-deploy" style="padding:15px 80px;font-size:28px;font-weight:900;background:#ff4444;color:#fff;border:none;cursor:pointer;letter-spacing:4px;box-shadow:0 0 20px rgba(255,68,68,0.5);">DEPLOY</button>
      </div>
    `;
    document.body.appendChild(customLobby);

    // ==================== 2. 隐藏/显示 原生 UI ====================
    function toggleNativeUI(hide) {
      // 原生大厅的元素 ID 我们非常清楚，直接隐藏它们
      const ids = ['team-selector', 'lobby-players', 'online-ui'];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = hide ? 'none' : '';
      });
      
      // 隐藏原生的主菜单按钮容器（部署按钮等）
      const titleActions = document.querySelector('.m-screen[data-s="title"] .m-actions');
      if (titleActions) {
        titleActions.style.opacity = hide ? '0' : '1';
        titleActions.style.pointerEvents = hide ? 'none' : 'auto';
      }
    }

    // ==================== 3. 绑定事件 ====================
    // 3.1 名字保存
    document.getElementById('cust-save-name').onclick = () => {
      const name = document.getElementById('cust-name').value.trim() || 'Player';
      api.state.setPlayerName(name);
      if (api.net) api.net.send({ t: 'hello', id: api.state.me, team: api.state.getMyTeam(), name });
    };

    // 3.2 选队
    document.getElementById('cust-team-red').onclick = () => {
      api.state.setMyTeam('red');
      api.net.send({ t: 'set_team', team: 'red' });
      if (api.state.getReady(api.state.me)) {
        api.state.setReady(api.state.me, false);
        api.net.send({ t: 'ready', ready: false });
      }
    };
    document.getElementById('cust-team-blue').onclick = () => {
      api.state.setMyTeam('blue');
      api.net.send({ t: 'set_team', team: 'blue' });
      if (api.state.getReady(api.state.me)) {
        api.state.setReady(api.state.me, false);
        api.net.send({ t: 'ready', ready: false });
      }
    };

    // 3.3 准备
    document.getElementById('cust-ready').onclick = () => {
      const isReady = !api.state.getReady(api.state.me);
      api.state.setReady(api.state.me, isReady);
      api.net.send({ t: 'ready', ready: isReady });
      updateCustomUI(); // 立即刷新
    };

    // 3.4 模式选择
    // (这里为了演示，硬编码了VS/RELAYS/BOMB，你可以根据 MODE_CONFIG 动态生成)
    const modes = ['vs', 'kills', 'relays', 'bomb'];
    const modeLabels = { vs: 'VS', kills: 'KILLS', relays: 'RELAYS', bomb: 'BOMB' };
    document.getElementById('cust-mode-list').innerHTML = modes.map(m => 
      `<button class="cust-mode-btn" data-mode="${m}" style="padding:10px 20px;font-size:18px;background:transparent;color:#fff;border:1px solid #555;cursor:pointer;">${modeLabels[m]}</button>`
    ).join('');

    document.querySelectorAll('.cust-mode-btn').forEach(btn => {
      btn.onclick = () => {
        if (!api.state.isHost()) return;
        const mode = btn.dataset.mode;
        api.state.patchMode({ mode, target: 10 });
        api.net.send({ t: 'set_mode', mode, target: 10 });
      };
    });

    // 3.5 部署（点击原生部署按钮，利用原生逻辑防呆）
    document.getElementById('cust-deploy').onclick = () => {
      const deployBtn = document.querySelector('button[data-act="deploy"]');
      if (deployBtn) deployBtn.click();
    };

    // ==================== 4. 数据同步与 UI 刷新 ====================
    function updateCustomUI() {
      // 4.1 更新队伍按钮高亮
      const myTeam = api.state.getMyTeam();
      const rBtn = document.getElementById('cust-team-red');
      const bBtn = document.getElementById('cust-team-blue');
      
      rBtn.style.background = myTeam === 'red' ? 'rgba(255,68,68,0.2)' : 'transparent';
      rBtn.style.borderColor = myTeam === 'red' ? '#ff4444' : '#444';
      rBtn.style.color = myTeam === 'red' ? '#ff4444' : '#888';

      bBtn.style.background = myTeam === 'blue' ? 'rgba(68,136,255,0.2)' : 'transparent';
      bBtn.style.borderColor = myTeam === 'blue' ? '#4488ff' : '#444';
      bBtn.style.color = myTeam === 'blue' ? '#4488ff' : '#888';

      // 4.2 更新准备按钮
      const readyBtn = document.getElementById('cust-ready');
      const isReady = api.state.getReady(api.state.me);
      readyBtn.textContent = isReady ? '已准备 (点击取消)' : '点击准备';
      readyBtn.style.background = isReady ? '#44ff44' : '#ffb347';
      readyBtn.style.color = '#000';
      readyBtn.style.display = myTeam ? 'block' : 'none';

      // 4.3 更新玩家列表
      const pList = document.getElementById('cust-player-list');
      const teams = api.state.getTeamDict();
      pList.innerHTML = '';
      
      const allIds = new Set(Object.keys(teams));
      allIds.add(api.state.me);

      allIds.forEach(id => {
        const team = id === api.state.me ? myTeam : teams[id];
        const name = id === api.state.me ? api.state.getPlayerName() : (api.state.getName(id) || 'Player');
        const isReady = api.state.getReady(id);
        const isHost = id === api.state.getHostId();

        const item = document.createElement('div');
        item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:16px;padding:5px;border-bottom:1px solid rgba(255,255,255,0.1);';
        item.innerHTML = `
          <div style="color:${team === 'red' ? '#ff4444' : (team === 'blue' ? '#4488ff' : '#aaa')};">
            ${isHost ? '👑 ' : ''}${name}
          </div>
          <div style="color:#44ff44;font-size:12px;">${isReady ? 'READY' : ''}</div>
        `;
        pList.appendChild(item);
      });

      // 4.4 更新模式按钮
      const curMode = api.state.getMode().mode;
      document.querySelectorAll('.cust-mode-btn').forEach(btn => {
        const isActive = btn.dataset.mode === curMode;
        btn.style.borderColor = isActive ? '#ffcc00' : '#555';
        btn.style.color = isActive ? '#ffcc00' : '#fff';
        btn.style.opacity = api.state.isHost() ? '1' : '0.5';
      });
    }

    // ==================== 5. 监听状态与游戏流程 ====================
    
    // 当所有相关状态改变时，刷新自定义 UI
    api.bus.on('state:teams-changed', updateCustomUI);
    api.bus.on('state:team-self', updateCustomUI);
    api.bus.on('state:ready-changed', updateCustomUI);
    api.bus.on('state:mode', updateCustomUI);
    api.bus.on('state:names', updateCustomUI);

    // 处理进入/退出大厅
    api.bus.on('game:state', (d) => {
      if (d.state === 'title') {
        customLobby.style.display = 'block';
        // 延迟一点隐藏原生 UI，防止被原生代码重置
        setTimeout(() => toggleNativeUI(true), 50);
        updateCustomUI();
      } else {
        customLobby.style.display = 'none';
        toggleNativeUI(false);
      }
    });

    // 拦截原生 DOM 重建
    setInterval(() => {
      if (api.game.G && api.game.G.game && api.game.G.game.state === 'title') {
        toggleNativeUI(true);
      }
    }, 500);

    api.log('🎨 自定义大厅 UI 已接管！');
  }
};