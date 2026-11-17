export default {
  name: '真·无敌模式',
  version: '1.0.0',
  onInit(api) {
    api.log('无敌 Mod 初始化成功！');

    // 屏幕左上角提示
    const badge = document.createElement('div');
    badge.textContent = '🛡️ 无敌模式已开启';
    badge.style.cssText = 'position:fixed;top:20px;left:20px;background:rgba(0,255,0,0.8);color:#000;padding:5px 10px;font-weight:bold;border-radius:4px;z-index:99999;pointer-events:none;font-family:sans-serif;';
    document.body.appendChild(badge);

    // 暴力锁血
    setInterval(() => {
      const p = window.__G && window.__G.player;
      if (p) {
        p.health = 9999;
        p.maxHealth = 9999;
        p.alive = true;

        if (!p._isInvincible) {
          p._isInvincible = true;
          const hackFunc = (funcName) => {
            if (typeof p[funcName] === 'function') {
              const orig = p[funcName].bind(p);
              p[funcName] = function(...args) {
                if (p._isInvincible) return; // 阻断伤害
                return orig(...args);
              };
            }
          };
          hackFunc('damage');
          hackFunc('takeDamage');
          hackFunc('die');
          api.log('底层伤害函数已被封印！');
        }
      }
    }, 100);
  }
};