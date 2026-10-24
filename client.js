(() => {
  const $ = id => document.getElementById(id);
  const home = $("home"), game = $("game"), playBtn = $("playBtn");
  const createRoomBtn = $("createRoomBtn"), joinRoomBtn = $("joinRoomBtn"), roomCodeInput = $("roomCode"), roomInfo = $("roomInfo");
  const connection = $("connection"), boardEl = $("board"), statusEl = $("status"), instruction = $("instruction");
  const rematchBtn = $("rematchBtn"), leaveBtn = $("leaveBtn");
  let socket, state = null, pendingRemove = null, connected = false;

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${proto}//${location.host}`);
    socket.onopen = () => { connected = true; connection.textContent = "متصل بالخادم وجاهز للعب."; playBtn.disabled = false; };
    socket.onclose = () => { connected = false; connection.textContent = "انقطع الاتصال. حدّث الصفحة للمحاولة مجددًا."; playBtn.disabled = true; };
    socket.onerror = () => { connection.textContent = "تعذّر الاتصال بالخادم."; };
    socket.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "waiting") { playBtn.disabled = true; playBtn.textContent = "نبحث عن لاعب..."; connection.textContent = msg.text; }
      if (msg.type === "roomCreated") {
        roomInfo.innerHTML = `تم إنشاء الغرفة! أرسل هذا الرمز لصديقك:<br><span class="room-code">${msg.code}</span><br>ننتظر انضمامه...`;
        playBtn.disabled = false; playBtn.textContent = "ابحث عن لاعب عشوائي";
        createRoomBtn.disabled = false; joinRoomBtn.disabled = false;
      }
      if (msg.type === "matched") {
        home.classList.add("hidden"); game.classList.remove("hidden");
        $("status").textContent = "تم الاتصال! تبدأ الجولة الآن.";
      }
      if (msg.type === "state") { state = msg; pendingRemove = null; render(); }
      if (msg.type === "error") { instruction.textContent = msg.text; pendingRemove = null; render(); }
      if (msg.type === "notice") { statusEl.textContent = msg.text; }
      if (msg.type === "opponentLeft") { home.classList.remove("hidden"); game.classList.add("hidden"); resetHome(); }
    };
  }
  function send(obj) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj)); }
  function resetHome() {
    state=null; playBtn.disabled=!connected; playBtn.textContent="ابحث عن لاعب عشوائي";
    createRoomBtn.disabled=!connected; joinRoomBtn.disabled=!connected;
    roomInfo.textContent="";
  }
  playBtn.addEventListener("click", () => { if (connected) { playBtn.disabled=true; roomInfo.textContent=""; send({type:"find"}); } });
  createRoomBtn.addEventListener("click", () => {
    if (connected) { roomInfo.textContent="جارٍ إنشاء الغرفة..."; createRoomBtn.disabled=true; send({type:"createRoom"}); }
  });
  joinRoomBtn.addEventListener("click", () => {
    const code=roomCodeInput.value.trim().toUpperCase();
    if (!code) { roomInfo.textContent="اكتب رمز الغرفة أولًا."; return; }
    if (connected) { roomInfo.textContent="جارٍ دخول الغرفة..."; joinRoomBtn.disabled=true; send({type:"joinRoom",code}); }
  });
  leaveBtn.addEventListener("click", () => { send({type:"leave"}); home.classList.remove("hidden"); game.classList.add("hidden"); resetHome(); });
  rematchBtn.addEventListener("click", () => { send({type:"rematch"}); rematchBtn.disabled=true; rematchBtn.textContent="بانتظار الخصم..."; });

  function render() {
    if (!state) return;
    const me = state.player, opp = 1-me, mark = me===0?"X":"O";
    $("youName").textContent = "أنت ("+mark+")";
    $("oppName").textContent = "الخصم ("+(opp===0?"X":"O")+")";
    $("youCount").textContent = `${state.stones[me].length}/3 أحجار`;
    $("oppCount").textContent = `${state.stones[opp].length}/3 أحجار`;
    $("youCard").classList.toggle("active", state.turn===me && state.status==="playing");
    $("oppCard").classList.toggle("active", state.turn===opp && state.status==="playing");
    if (state.status==="won") {
      statusEl.textContent = state.winner===me ? "🎉 فزت!" : "انتهت الجولة";
    } else {
      statusEl.textContent = state.turn===me ? "دورك الآن" : "دور الخصم...";
    }
    boardEl.innerHTML = "";
    const myMark = me===0?"X":"O";
    const canAct = state.turn===me && state.status==="playing";
    state.board.forEach((v,i) => {
      const b=document.createElement("button");
      b.className="cell"+(v==="X"?" x":v==="O"?" o":"");
      b.textContent=v==="X"?"✕":v==="O"?"○":"";
      b.disabled=!(canAct && v===null);
      if (pendingRemove!==null && state.stones[me].includes(i)) {
        b.classList.add("selectable"); b.disabled=false;
        b.onclick=()=>{ const rm=i; send({type:"move",index:pendingRemove,removeIndex:rm}); pendingRemove=null; };
      } else if (canAct && v===null) {
        b.onclick=()=> {
          if (state.stones[me].length<3) send({type:"move",index:i});
          else { pendingRemove=i; instruction.textContent="اختر الآن الحجر الذي تريد حذفه (المربعات المظللة)."; renderSelection(); }
        };
      }
      boardEl.appendChild(b);
    });
    if (state.status==="won") {
      instruction.textContent="يمكنكما إعادة اللعب عند موافقة الطرفين.";
      rematchBtn.classList.remove("hidden"); rematchBtn.disabled=false; rematchBtn.textContent="العب مرة أخرى";
    } else {
      rematchBtn.classList.add("hidden");
      instruction.textContent = pendingRemove!==null ? "اختر حجرًا من أحجارك الثلاثة لحذفه." :
        (state.turn===me ? (state.stones[me].length<3 ? "ضع حجرًا في مربع فارغ." : "اختر مربعًا فارغًا، ثم اختر أي حجر تحذفه.") : "انتظر دورك.");
    }
  }
  function renderSelection() {
    const buttons=[...boardEl.children];
    buttons.forEach((b,i)=>{
      if(state.stones[state.player].includes(i)){b.classList.add("selectable");b.disabled=false;b.onclick=()=>{const rm=i;send({type:"move",index:pendingRemove,removeIndex:rm});pendingRemove=null;};}
      else b.disabled=true;
    });
  }
  connect();
})();