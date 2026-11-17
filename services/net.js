export function createNet({ bus, server }) {
  let ws = null, ready = false;

  function connect() {
    ws = new WebSocket(server);
    ws.onopen = () => { ready = true; bus.emit('net:open'); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      bus.emit('net:' + m.t, m);
    };
    ws.onclose = () => { ready = false; bus.emit('net:close'); setTimeout(connect, 1200); };
    ws.onerror = () => {};
  }
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
  function isOpen() { return !!(ws && ws.readyState === 1); }

  return { connect, send, isOpen };
}