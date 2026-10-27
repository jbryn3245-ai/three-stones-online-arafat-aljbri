const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname
  );

  if (pathname === "/") pathname = "/index.html";

  const file = path.join(PUBLIC, pathname.replace(/^\/+/, ""));

  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const ext = path.extname(file);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };

    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();
const waiting = [];

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room) {
  room.players.forEach((player) => {
    send(player.ws, {
      type: "state",
      board: room.board,
      turn: room.turn,
      myPlayer: player.id,
      pieces: room.pieces,
      status: room.status,
      winner: room.winner,
      code: room.code
    });
  });
}

function makeRoom(p1, p2, code = "") {
  const room = {
    code,
    players: [
      { ws: p1, id: 1 },
      { ws: p2, id: 2 }
    ],
    board: Array(9).fill(0),
    pieces: { 1: [], 2: [] },
    turn: 1,
    status: "playing",
    winner: 0
  };

  rooms.set(code || String(Date.now()), room);

  room.players.forEach((player) => {
    player.ws.room = room;
    player.ws.playerId = player.id;
  });

  broadcast(room);
  return room;
}

function removeWaiting(ws) {
  const index = waiting.indexOf(ws);
  if (index !== -1) waiting.splice(index, 1);
}

function findRoom(ws, code) {
  for (const room of rooms.values()) {
    if (room.code === code && room.players.length < 2) {
      return room;
    }
  }
  return null;
}

function hasWon(board, player) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  return lines.some((line) =>
    line.every((index) => board[index] === player)
  );
}

function closeRoom(room, disconnectedPlayer) {
  room.status = "finished";

  room.players.forEach((player) => {
    send(player.ws, {
      type: "opponent_left",
      message: "غادر اللاعب الآخر المباراة."
    });

    player.ws.room = null;
  });

  for (const [key, value] of rooms.entries()) {
    if (value === room) rooms.delete(key);
  }
}

wss.on("connection", (ws) => {
  send(ws, {
    type: "welcome",
    message: "مرحبًا بك في لعبة XO!"
  });

  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "matchmake") {
      removeWaiting(ws);

      if (ws.room) return;

      const opponent = waiting.find(
        (player) =>
          player.readyState === WebSocket.OPEN && !player.room
      );

      if (opponent) {
        removeWaiting(opponent);
        makeRoom(opponent, ws);
      } else {
        waiting.push(ws);
        send(ws, {
          type: "waiting",
          message: "نبحث عن لاعب آخر..."
        });
      }

      return;
    }

    if (msg.type === "create") {
      if (ws.room) return;

      const code = Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();

      const room = {
        code,
        players: [{ ws, id: 1 }],
        board: Array(9).fill(0),
        pieces: { 1: [], 2: [] },
        turn: 1,
        status: "waiting",
        winner: 0
      };

      rooms.set(code, room);
      ws.room = room;
      ws.playerId = 1;

      send(ws, {
        type: "created",
        code,
        message: "أرسل رمز الغرفة لصديقك."
      });

      return;
    }

    if (msg.type === "join") {
      const code = String(msg.code || "")
        .trim()
        .toUpperCase();

      const room = rooms.get(code);

      if (!room || room.players.length !== 1) {
        send(ws, {
          type: "error",
          message: "رمز الغرفة غير صحيح أو الغرفة ممتلئة."
        });
        return;
      }

      if (ws.room) return;

      room.players.push({ ws, id: 2 });
      room.status = "playing";
      ws.room = room;
      ws.playerId = 2;

      broadcast(room);
      return;
    }

    if (msg.type === "move") {
      const room = ws.room;
      if (!room || room.status !== "playing") return;

      const player = ws.playerId;
      const index = Number(msg.index);
      const removeIndex =
        msg.removeIndex === undefined
          ? null
          : Number(msg.removeIndex);

      if (room.turn !== player) return;
      if (!Number.isInteger(index) || index < 0 || index > 8) return;
      if (room.board[index] !== 0) return;

      const ownPieces = room.pieces[player];

      if (ownPieces.length >= 3) {
        if (
          !Number.isInteger(removeIndex) ||
          !ownPieces.includes(removeIndex) ||
          removeIndex === index
        ) {
          send(ws, {
            type: "error",
            message: "اختر حجرًا من أحجارك الثلاثة لحذفه أولًا."
          });
          return;
        }

        room.board[removeIndex] = 0;
        room.pieces[player] = ownPieces.filter(
          (piece) => piece !== removeIndex
        );
      } else if (removeIndex !== null) {
        return;
      }

      room.board[index] = player;
      room.pieces[player].push(index);

      if (hasWon(room.board, player)) {
        room.status = "finished";
        room.winner = player;
      } else {
        room.turn = player === 1 ? 2 : 1;
      }

      broadcast(room);
    }
  });

  ws.on("close", () => {
    removeWaiting(ws);

    if (ws.room) {
      closeRoom(ws.room, ws.playerId);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Game server running on port ${PORT}`);
});
