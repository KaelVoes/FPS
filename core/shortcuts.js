// core/shortcuts.js - 禁用浏览器烦人的 Ctrl 快捷键，但不影响游戏操作
export function installShortcuts() {
  // 需要拦截的 Ctrl 快捷键（只拦浏览器默认行为，不拦游戏事件）
  const BLOCKED_CTRL = new Set([
    's', 'p', 'o', 'f', 'g', 'd', 'u', 'h', 'j', 'k', 'l', 'n', 't', 'b', 'e', 'i', 'm', 'y', 'w'
  ]);

  window.addEventListener('keydown', (e) => {
    // 1. 如果目标是输入框，完全不干预
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    // 2. 单独按 Alt 会激活 Firefox/Chrome 的菜单栏，需要防一下
    if (e.key === 'Alt') {
      e.preventDefault();
      return;
    }

    // 3. 组合键拦截（Ctrl 或 Cmd）
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (BLOCKED_CTRL.has(key)) {
        // ✅ 只阻止浏览器的默认行为（保存、打印等）
        // ❌ 绝对不要用 e.stopPropagation()，否则游戏引擎收不到 W/A/S/D，角色会卡死！
        e.preventDefault();
      }
    }
  }, { passive: false }); // 使用冒泡阶段，让游戏引擎先处理

  // 顺便把 Ctrl+滚轮 页面缩放也拦了
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  }, { passive: false });

  console.log('[shortcuts] 浏览器快捷键拦截已启用（不影响游戏按键）');
}