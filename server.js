const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const full = path.join(publicDir, file);
  if (!full.startsWith(publicDir)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(full);
    const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const waiting = [];
const rooms = new Map();
let nextRoom = 1;

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function roomFor(ws) {
  return ws.roomId ? rooms.get(ws.roomId) : null;
}
function broadcast(room, obj) {
  room.players.forEach(p => send(p, obj));
}
function freshRoom(id, a, b) {
  return {
    id, players:[a,b], turn:0, board:Array(9).fill(null),
    placed:[0,0], stones:[[],[]], phase:"placing", status:"playing",
    names:["اللاعب 1","اللاعب 2"]
  };
}
function publicState(room, recipient) {
  const player = room.players.indexOf(recipient);
  return {
    type:"state", roomId:room.id, player, turn:room.turn,
    board:room.board, placed:room.placed, stones:room.stones,
    phase:room.phase, status:room.status, winner: room.winner,
    names:room.names,
    message: room.status === "won" ? (room.winner === player ? "لقد فزت!" : "خسرت الجولة") : ""
  };
}
function updateRoom(room) {
  room.players.forEach(p => send(p, publicState(room,p)));
}
function winCheck(board, mark) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  return lines.some(line => line.every(i => board[i] === mark));
}
function endIfWon(room, player) {
  const mark = player === 0 ? "X" : "O";
  if (winCheck(room.board, mark)) {
    room.status = "won"; room.winner = player;
    broadcast(room, {type:"notice", text:`${room.names[player]} فاز!`});
    updateRoom(room);
    return true;
  }
  return false;
}
function resetRoom(room) {
  room.turn = 0; room.board = Array(9).fill(null); room.placed = [0,0];
  room.stones = [[],[]]; room.phase = "placing"; room.status = "playing";
  delete room.winner;
  updateRoom(room);
}
function reject(ws, text) { send(ws, {type:"error", text}); }

wss.on("connection", ws => {
  ws.roomId = null;
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return reject(ws, "طلب غير صالح."); }

    if (msg.type === "find") {
      if (ws.roomId) return reject(ws, "أنت داخل غرفة بالفعل.");
      while (waiting.length && waiting[0].readyState !== WebSocket.OPEN) waiting.shift();
      if (!waiting.length) {
        waiting.push(ws);
        send(ws, {type:"waiting", text:"نبحث عن لاعب آخر..."});
        return;
      }
      const opponent = waiting.shift();
      if (opponent === ws) { waiting.push(ws); return; }
      const id = String(nextRoom++);
      const room = freshRoom(id, opponent, ws);
      rooms.set(id, room);
      opponent.roomId = id; ws.roomId = id;
      send(opponent, {type:"matched"});
      send(ws, {type:"matched"});
      updateRoom(room);
      return;
    }

    if (msg.type === "createRoom") {
      if (ws.roomId) return reject(ws, "أنت داخل غرفة بالفعل.");
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code;
      do {
        code = Array.from({length:5}, () => alphabet[Math.floor(Math.random()*alphabet.length)]).join("");
      } while (rooms.has(code));
      const room = {
        id:code, players:[ws], turn:0, board:Array(9).fill(null),
        placed:[0,0], stones:[[],[]], phase:"placing", status:"waiting",
        names:["أنت","الصديق"]
      };
      rooms.set(code, room);
      ws.roomId = code;
      send(ws, {type:"roomCreated", code});
      return;
    }

    if (msg.type === "joinRoom") {
      if (ws.roomId) return reject(ws, "أنت داخل غرفة بالفعل.");
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room || room.status !== "waiting" || room.players.length !== 1) {
        return reject(ws, "رمز الغرفة غير صحيح أو أن الغرفة ممتلئة.");
      }
      room.players.push(ws);
      room.status = "playing";
      room.turn = 0;
      ws.roomId = code;
      room.players.forEach(p => send(p, {type:"matched", roomId:code}));
      updateRoom(room);
      return;
    }

    if (msg.type === "move") {
      const room = roomFor(ws);
      if (!room || room.status !== "playing") return reject(ws, "لا توجد جولة نشطة.");
      const player = room.players.indexOf(ws);
      if (player < 0 || room.turn !== player) return reject(ws, "ليس دورك الآن.");
      const idx = Number(msg.index);
      if (!Number.isInteger(idx) || idx < 0 || idx > 8 || room.board[idx] !== null) return reject(ws, "هذا المربع غير متاح.");

      const mark = player === 0 ? "X" : "O";
      const currentCount = room.stones[player].length;
      if (currentCount < 3) {
        room.board[idx] = mark;
        room.stones[player].push(idx);
        room.placed[player]++;
      } else {
        const removeIdx = Number(msg.removeIndex);
        if (!Number.isInteger(removeIdx) || !room.stones[player].includes(removeIdx)) {
          return reject(ws, "اختر حجرًا من أحجارك الثلاثة ليُحذف أولًا.");
        }
        room.board[removeIdx] = null;
        room.stones[player] = room.stones[player].filter(i => i !== removeIdx);
        room.board[idx] = mark;
        room.stones[player].push(idx);
        room.placed[player]++;
      }
      if (!endIfWon(room, player)) {
        room.turn = 1 - room.turn;
        updateRoom(room);
      }
      return;
    }

    if (msg.type === "rematch") {
      const room = roomFor(ws);
      if (!room) return reject(ws, "لا توجد غرفة.");
      room.rematch = room.rematch || new Set();
      room.rematch.add(ws);
      if (room.rematch.size === 2) { room.rematch = new Set(); resetRoom(room); }
      else send(ws, {type:"notice", text:"طلبت إعادة اللعب. ننتظر موافقة اللاعب الآخر."});
      return;
    }

    if (msg.type === "leave") {
      const room = roomFor(ws);
      if (room) {
        const other = room.players.find(p => p !== ws);
        if (other) {
          send(other, {type:"notice", text:"غادر اللاعب الآخر. يمكنك البحث عن مباراة جديدة."});
          send(other, {type:"opponentLeft"});
          other.roomId = null;
        }
        rooms.delete(room.id);
      }
      ws.roomId = null;
      return;
    }
  });
  ws.on("close", () => {
    const wi = waiting.indexOf(ws);
    if (wi >= 0) waiting.splice(wi,1);
    const room = roomFor(ws);
    if (room) {
      const other = room.players.find(p => p !== ws);
      send(other, {type:"notice", text:"انقطع اتصال اللاعب الآخر."});
      send(other, {type:"opponentLeft"});
      if (other) other.roomId = null;
      rooms.delete(room.id);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Three Stones Online running on ${PORT}`));
