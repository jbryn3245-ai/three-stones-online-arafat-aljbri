const $ = (id) => document.getElementById(id);

let socket;
let myPlayer = 0;
let board = Array(9).fill(0);
let pieces = { 1: [], 2: [] };
let turn = 1;
let status = "waiting";
let winner = 0;
let selectedRemoval = null;

function connect() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) return;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.onopen = () => {
    $("status").textContent = "تم الاتصال بالخادم.";
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "welcome" || msg.type === "waiting") {
      $("status").textContent = msg.message;
    }

    if (msg.type === "created") {
      $("roomInfo").classList.remove("hidden");
      $("code").textContent = msg.code;
      $("status").textContent = msg.message;
    }

    if (msg.type === "error") {
      $("status").textContent = msg.message;
    }

    if (msg.type === "opponent_left") {
      $("status").textContent = msg.message;
      status = "finished";
      render();
    }

    if (msg.type === "state") {
      board = msg.board;
      pieces = msg.pieces;
      turn = msg.turn;
      myPlayer = msg.myPlayer;
      status = msg.status;
      winner = msg.winner;

      if (msg.code) {
        $("roomInfo").classList.remove("hidden");
        $("code").textContent = msg.code;
      }

      selectedRemoval = null;
      $("cancelRemoveBtn").classList.add("hidden");

      if (status === "waiting") {
        $("status").textContent = "انتظر انضمام اللاعب الآخر.";
      } else if (status === "finished" && winner) {
        $("status").textContent =
          winner === myPlayer ? "🎉 لقد فزت!" : "انتهت المباراة.";
      } else if (status === "playing") {
        $("status").textContent =
          turn === myPlayer ? "دورك الآن!" : "انتظر دور اللاعب الآخر.";
      }

      render();
    }
  };

  socket.onclose = () => {
    $("status").textContent = "انقطع الاتصال بالخادم.";
  };

  socket.onerror = () => {
    $("status").textContent = "تعذر الاتصال بالخادم.";
  };
}

function send(data) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    $("status").textContent = "انتظر اتصال الخادم.";
    return;
  }

  socket.send(JSON.stringify(data));
}

function connectThen(action) {
  connect();

  const timer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      clearInterval(timer);
      action();
    } else if (!socket || socket.readyState === WebSocket.CLOSED) {
      clearInterval(timer);
    }
  }, 200);
}

$("matchBtn").onclick = () =>
  connectThen(() => send({ type: "matchmake" }));

$("createBtn").onclick = () =>
  connectThen(() => send({ type: "create" }));

$("joinBtn").onclick = () => {
  const code = $("roomCode").value.trim();

  if (!code) {
    $("status").textContent = "اكتب رمز الغرفة أولًا.";
    return;
  }

  connectThen(() => send({ type: "join", code }));
};

$("copyBtn").onclick = async () => {
  const code = $("code").textContent;

  try {
    await navigator.clipboard.writeText(code);
    $("status").textContent = "تم نسخ رمز الغرفة.";
  } catch {
    $("status").textContent = "رمز الغرفة: " + code;
  }
};

$("cancelRemoveBtn").onclick = () => {
  selectedRemoval = null;
  $("cancelRemoveBtn").classList.add("hidden");
  render();
};

$("restartBtn").onclick = () => {
  if (socket) socket.close();
  socket = null;
  myPlayer = 0;
  board = Array(9).fill(0);
  pieces = { 1: [], 2: [] };
  turn = 1;
  status = "waiting";
  winner = 0;
  selectedRemoval = null;

  $("roomInfo").classList.add("hidden");
  $("cancelRemoveBtn").classList.add("hidden");
  $("status").textContent = "اختر طريقة اللعب للبدء.";
  render();
};

document.querySelectorAll(".cell").forEach((cell) => {
  cell.onclick = () => {
    const index = Number(cell.dataset.index);

    if (status !== "playing" || turn !== myPlayer) return;

    const mine = pieces[myPlayer] || [];

    if (mine.length >= 3 && selectedRemoval === null) {
      if (mine.includes(index)) {
        selectedRemoval = index;
        $("cancelRemoveBtn").classList.remove("hidden");
        $("status").textContent =
          "اختر الآن مربعًا فارغًا لوضع الحجر الجديد.";
        render();
      } else {
        $("status").textContent =
          "اختر أحد أحجارك الثلاثة لحذفه أولًا.";
      }
      return;
    }

    if (board[index] !== 0) return;

    send({
      type: "move",
      index,
      ...(selectedRemoval !== null
        ? { removeIndex: selectedRemoval }
        : {})
    });
  };
});

function render() {
  document.querySelectorAll(".cell").forEach((cell) => {
    const index = Number(cell.dataset.index);
    const value = board[index];

    cell.textContent = value === 1 ? "❌" : value === 2 ? "⭕" : "";

    cell.classList.toggle(
      "mine",
      value !== 0 && value === myPlayer
    );

    cell.classList.toggle("selected", selectedRemoval === index);

    cell.disabled =
      status !== "playing" ||
      turn !== myPlayer ||
      value !== 0;
  });

  const mine = pieces[myPlayer] || [];

  $("help").textContent =
    status === "playing" &&
    turn === myPlayer &&
    mine.length >= 3
      ? "اضغط على أحد أحجارك الثلاثة لحذفه، ثم اضغط على مربع فارغ."
      : "لكل لاعب ثلاثة أحجار، وأنت تختار الحجر الذي تريد حذفه.";
}

render();