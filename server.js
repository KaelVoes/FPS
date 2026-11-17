import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);

  // 递归扫描 mods 目录的 API（支持子文件夹）并读取配置文件
  if (url === '/api/mods') {
    const modsDir = path.join(__dirname, 'mods');
    const configPath = path.join(__dirname, 'mods.config.json');

    // 1. 读取禁用列表
    let disabledList = [];
    if (fs.existsSync(configPath)) {
      try {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        disabledList = configData.disabled || [];
      } catch (e) {
        console.warn('[Mod Config] mods.config.json 格式错误，将全部加载');
      }
    }

    // 2. 递归扫描文件
    function getJsFilesRecursively(dir, baseDir) {
      let results = [];
      try {
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);

          if (stat && stat.isDirectory()) {
            results = results.concat(getJsFilesRecursively(fullPath, baseDir));
          } else if (file.endsWith('.js') && file !== 'index.js') {
            const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

            // 3. 核心过滤：如果这个文件在禁用列表里，就跳过
            if (disabledList.includes(relPath) || disabledList.includes(file)) {
              console.log(`[Mod Config] 拦截并禁用了: ${relPath}`);
              continue;
            }

            results.push(relPath);
          }
        }
      } catch (e) {
        console.warn('[Mod Scanner] 扫描目录出错:', e);
      }
      return results;
    }

    try {
      const jsFiles = getJsFilesRecursively(modsDir, modsDir).sort();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jsFiles));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify([]));
    }
    return;
  }

  // 静态文件读取逻辑
  if (url === '/') url = '/index.html';
  const file = path.join(__dirname, url);
  if (!file.startsWith(__dirname)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const clients = new Map();
let hostId = null;

let gameMode = 'vs';
let gameTarget = 10;
let gameAttackTeam = 'red';
let gameTimeScale = 'standard';

function allTeamsReady() {
  if (clients.size === 0) return false;
  for (const c of clients.values()) {
    if (c.team !== 'red' && c.team !== 'blue') return false;
  }
  return true;
}

wss.on('connection', (ws) => {
  let myId = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'hello') {
      myId = m.id;
      const existing = clients.get(myId);
      const prev = existing || {};
      if (existing) { try { existing.ws.close(); } catch (e) {} }

      let team = (m.team === 'red' || m.team === 'blue') ? m.team : null;
      let name = m.name || 'Player';

      clients.set(myId, {
        ws, team, name, locked: false,
        ready: false,
        kills: prev.kills || 0,
        aiKills: prev.aiKills || 0,
        deaths: prev.deaths || 0,
        assists: prev.assists || 0, cuts: prev.cuts || 0, repairs: prev.repairs || 0,
      });

      if (!hostId || !clients.has(hostId)) hostId = myId;

      const teams = {}, names = {}, scores = {};
      const readyStates = {};
      for (const [id, c] of clients) {
        teams[id] = c.team; names[id] = c.name;
        readyStates[id] = c.ready;
        scores[id] = {
          name: c.name, team: c.team,
          kills: c.kills || 0,
          aiKills: c.aiKills || 0,
          deaths: c.deaths || 0,
          assists: c.assists || 0, cuts: c.cuts || 0, repairs: c.repairs || 0,
        };
      }

      ws.send(JSON.stringify({
        t: 'welcome', id: myId, team, host: hostId, teams, names, scores,
        readyStates: readyStates,
        mode: gameMode, target: gameTarget, attackTeam: gameAttackTeam, timeScale: gameTimeScale,
        online: clients.size
      }));
      broadcastTeams();
      broadcastOnlineCount();
      return;
    }

    if (m.t === 'set_team') {
      const c = clients.get(myId);
      if (c && !c.locked && (m.team === 'red' || m.team === 'blue')) {
        c.team = m.team; broadcastTeams();
      }
      return;
    }

    if (m.t === 'set_mode') {
      if (myId !== hostId) return;
      const validModes = ['vs', 'kills', 'relays', 'bomb'];
      if (!validModes.includes(m.mode)) return;
      gameMode = m.mode;
      gameTarget = Math.max(1, Math.min(200, +m.target || 10));
      // ✅ 修复：vs 和 bomb 都接受 attackTeam
      if ((m.mode === 'vs' || m.mode === 'bomb') && (m.attackTeam === 'red' || m.attackTeam === 'blue')) {
        gameAttackTeam = m.attackTeam;
      }
      broadcast({ t: 'mode', mode: gameMode, target: gameTarget, attackTeam: gameAttackTeam, from: myId });
      return;
    }

    if (m.t === 'set_time') {
      if (myId !== hostId) return;
      if (!['short', 'standard', 'long'].includes(m.scale)) return;
      gameTimeScale = m.scale;
      broadcast({ t: 'time', scale: gameTimeScale, from: myId });
      return;
    }

    if (m.t === 'ready') {
      const c = clients.get(myId);
      if (c && !c.locked) {
        c.ready = !!m.ready;
        broadcastReadyStates();
      }
      return;
    }

    if (m.t === 'start') {
      if (!allPlayersReady()) {
        try { ws.send(JSON.stringify({ t: 'start_denied', reason: 'teams' })); } catch (e) {}
        return;
      }
      for (const c of clients.values()) c.locked = true;
      broadcastTeams();
      const startMsg = JSON.parse(raw.toString());
      startMsg.mode = gameMode;
      startMsg.target = gameTarget;
      startMsg.attackTeam = gameAttackTeam;
      startMsg.timeScale = gameTimeScale;
      broadcast(JSON.stringify(startMsg), myId);
      return;
    }

    if (m.t === 'pp') {
      const c = clients.get(myId);
      if (c) { m.team = c.team; m.name = c.name; }
      broadcast(JSON.stringify(m), myId);
      return;
    }

    if (m.t === 'shot') {
      m.from = myId;
      broadcast(JSON.stringify(m), myId);
      return;
    }

    if (m.t === 'kill') {
      if (m.killerId) {
        const c = clients.get(m.killerId);
        if (c) {
          if (m.victimId) {
            c.kills = (c.kills || 0) + 1;
          } else {
            c.aiKills = (c.aiKills || 0) + 1;
          }
        }
      }
      if (m.victimId) {
        const c = clients.get(m.victimId);
        if (c) c.deaths = (c.deaths || 0) + 1;
      }
      if (Array.isArray(m.assistIds)) {
        for (const aid of m.assistIds) {
          if (aid === m.killerId || aid === m.victimId) continue;
          const c = clients.get(aid);
          if (c) c.assists = (c.assists || 0) + 1;
        }
      }
      broadcast(JSON.stringify(m));
      broadcastScores();
      return;
    }

    if (m.t === 'cutStat') {
      const c = clients.get(m.id);
      if (c) { c.cuts = (c.cuts || 0) + 1; broadcastScores(); }
      return;
    }

    if (m.t === 'repairStat') {
      const c = clients.get(m.id);
      if (c) { c.repairs = (c.repairs || 0) + 1; broadcastScores(); }
      return;
    }

    if (myId) broadcast(raw.toString(), myId);
  });

  ws.on('close', () => {
    if (!myId) return;
    const current = clients.get(myId);
    if (!current || current.ws !== ws) return;

    clients.delete(myId);
    broadcast({ t: 'leave', id: myId }, myId);
    if (hostId === myId) {
      hostId = clients.keys().next().value || null;
      if (hostId) broadcast({ t: 'host', id: hostId });
    }
    broadcastTeams();
    broadcastOnlineCount();
  });
});

function broadcastTeams() {
  const teams = {}, names = {};
  for (const [id, c] of clients) { teams[id] = c.team; names[id] = c.name; }
  broadcast({ t: 'teams', teams, names });
}

function broadcastScores() {
  const scores = {};
  for (const [id, c] of clients) {
    scores[id] = {
      name: c.name, team: c.team,
      kills: c.kills || 0,
      aiKills: c.aiKills || 0,
      deaths: c.deaths || 0,
      assists: c.assists || 0, cuts: c.cuts || 0, repairs: c.repairs || 0,
    };
  }
  broadcast({ t: 'scores', scores });
}

function broadcastOnlineCount() {
  broadcast({ t: 'online', count: clients.size });
}

function broadcast(data, exceptId) {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  for (const [id, c] of clients) {
    if (id !== exceptId && c.ws.readyState === 1) c.ws.send(s);
  }
}

function allPlayersReady() {
  if (clients.size === 0) return false;
  for (const c of clients.values()) {
    if (c.team !== 'red' && c.team !== 'blue') return false;
    if (!c.ready) return false;
  }
  return true;
}

function broadcastReadyStates() {
  const readyStates = {};
  for (const [id, c] of clients) {
    readyStates[id] = c.ready;
  }
  broadcast({ t: 'ready_states', readyStates });
}

server.listen(PORT, () => {
  console.log(`[saltline] open:  http://localhost:${PORT}/index.html?net=ws://localhost:${PORT}`);
});