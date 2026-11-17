// mods/ads-mode.js - ADS 开镜方式切换（精准注入原生设置面板）
export default {
  name: 'ADS 开镜方式',
  version: '4.0.0',
  onInit(api) {
    let adsMode = localStorage.getItem('saltline_ads_mode') || 'hold';
    let toggleAiming = false;
    let justClosed = false;

    // ==================== 右键拦截 ====================
    function dispatchMouse(type) {
      const evt = new MouseEvent(type, {
        button: 2, buttons: type === 'mousedown' ? 2 : 0,
        bubbles: true, cancelable: true, view: window
      });
      document.dispatchEvent(evt);
    }

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      if (adsMode !== 'toggle') return;
      const G = api.game.G;
      if (!G || !G.game || G.game.state !== 'playing') return;

      if (!toggleAiming) {
        toggleAiming = true;
      } else {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleAiming = false;
        justClosed = true;
        dispatchMouse('mouseup');
      }
    }, true);

    document.addEventListener('mouseup', (e) => {
      if (e.button !== 2) return;
      if (adsMode !== 'toggle') return;
      if (justClosed) {
        e.preventDefault();
        e.stopImmediatePropagation();
        justClosed = false;
      } else if (toggleAiming) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    api.bus.on('game:state', (d) => {
      if (d.state !== 'playing') {
        toggleAiming = false;
        justClosed = false;
      }
    });

    // ==================== UI 构建 ====================
    function buildAdsRow() {
      const row = document.createElement('div');
      row.id = 'ads-row';
      // 样式模仿原生设置项
      row.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:100%;margin-top:20px;margin-bottom:20px;';
      row.innerHTML = `
        <div style="font-size:11px;letter-spacing:1px;color:#aaa;font-family:'Barlow Condensed',sans-serif;font-weight:600;text-transform:uppercase;">ADS 开镜方式</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;">
          <button id="ads-hold" class="btn" style="position:relative;z-index:1;min-height:36px;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;letter-spacing:1px;border:1px solid rgba(255,255,255,0.2);color:#aaa;background:transparent;cursor:pointer;box-sizing:border-box;">长按开镜</button>
          <button id="ads-toggle" class="btn" style="position:relative;z-index:1;min-height:36px;padding:6px 10px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;letter-spacing:1px;border:1px solid rgba(255,255,255,0.2);color:#aaa;background:transparent;cursor:pointer;box-sizing:border-box;">点击切换</button>
        </div>
      `;
      return row;
    }

    function wireAdsButtons(row) {
      const holdBtn = row.querySelector('#ads-hold');
      const toggleBtn = row.querySelector('#ads-toggle');
      if (!holdBtn || !toggleBtn) return;

      const updateUI = () => {
        const isHold = adsMode === 'hold';
        [holdBtn, toggleBtn].forEach((b, i) => {
          const active = (i === 0 && isHold) || (i === 1 && !isHold);
          b.style.border = active ? '1px solid #ffb347' : '1px solid rgba(255,255,255,0.2)';
          b.style.color = active ? '#ffb347' : '#aaa';
          b.style.background = active ? 'rgba(255,179,71,0.15)' : 'transparent';
        });
      };

      holdBtn.onclick = (e) => {
        e.stopPropagation();
        adsMode = 'hold';
        localStorage.setItem('saltline_ads_mode', 'hold');
        toggleAiming = false; justClosed = false;
        updateUI();
      };
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        adsMode = 'toggle';
        localStorage.setItem('saltline_ads_mode', 'toggle');
        toggleAiming = false; justClosed = false;
        updateUI();
      };
      
      // 每次注入时同步状态
      updateUI();
    }

    // ==================== 精准注入逻辑 ====================
    function inject() {
      // 如果已经注入过了，直接跳过
      if (document.getElementById('ads-row')) return;

      // 找全屏按钮作为终极锚点
      let anchorBtn = null;
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.trim().toUpperCase().includes('FULLSCREEN')) {
          anchorBtn = btn;
          break;
        }
      }

      if (anchorBtn) {
        // 找到了，插在 FULLSCREEN 按钮所在行的后面
        const displayRow = anchorBtn.closest('div'); 
        if (displayRow && displayRow.parentNode) {
          const row = buildAdsRow();
          // 把 ADS 面板插在 DISPLAY 这一整行的后面
          displayRow.parentNode.insertBefore(row, displayRow.nextSibling);
          wireAdsButtons(row);
          console.log('[ads-mode] ✅ ADS 已精准注入原生设置面板(FULLSCREEN下方)');
          
          // 顺便把左侧暂停菜单里的老 UI 移除（如果存在的话）
          const oldLeftRow = document.querySelector('.m-screen[data-s="paused"] .m-actions #ads-row');
          if (oldLeftRow) oldLeftRow.remove();
        }
      }
    }

    // 500ms 检查一次，因为 DOM 会被引擎重置
    setInterval(inject, 500);
  }
};