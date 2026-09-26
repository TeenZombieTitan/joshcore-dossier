/* Supply Drop — 1v1, browser to browser.
 *
 * Two design constraints shaped this.
 *
 * There is no server. The site is static, so the two browsers talk directly over
 * WebRTC. One player hosts under a short room code, the other joins it. Nothing
 * passes through anything we run.
 *
 * And because there is no server, there is nobody to keep a secret. A game with
 * hidden information would be trivially cheatable — a modified client could read
 * the opponent's pending move before committing its own. So this is a
 * perfect-information game: everything either player knows is on the board. The
 * only cheat available is an illegal move, and both clients independently
 * validate every move against the same rules, so an illegal one is simply
 * rejected by the other side.
 */

(() => {
  "use strict";

  const ROWS = 6;
  const COLS = 7;
  const EMPTY = 0;

  // ---------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------

  function emptyBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
  }

  function lowestEmpty(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === EMPTY) return r;
    return -1;
  }

  function canDrop(board, col) {
    return col >= 0 && col < COLS && lowestEmpty(board, col) !== -1;
  }

  function applyDrop(board, col, player) {
    const row = lowestEmpty(board, col);
    if (row === -1) return null;
    board[row][col] = player;
    return row;
  }

  /* A breach blows out the bottom crate of a column, collapsing the stack down
   * one. You may only breach a column whose bottom crate is yours, which stops
   * it being a pure "delete their best move" button — you have to have
   * committed to that column first. */
  function canBreach(board, col, player) {
    return col >= 0 && col < COLS && board[ROWS - 1][col] === player;
  }

  function applyBreach(board, col) {
    for (let r = ROWS - 1; r > 0; r--) board[r][col] = board[r - 1][col];
    board[0][col] = EMPTY;
  }

  const DIRECTIONS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  /* Returns every four-in-a-row on the board, as {player, cells}. A breach can
   * complete lines for both players at once, so this finds all of them rather
   * than stopping at the first. */
  function findLines(board) {
    const found = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const player = board[r][c];
        if (player === EMPTY) continue;
        for (const [dr, dc] of DIRECTIONS) {
          const cells = [[r, c]];
          for (let step = 1; step < 4; step++) {
            const nr = r + dr * step;
            const nc = c + dc * step;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
            if (board[nr][nc] !== player) break;
            cells.push([nr, nc]);
          }
          if (cells.length === 4) found.push({ player, cells });
        }
      }
    }
    return found;
  }

  function boardFull(board) {
    return board[0].every((cell) => cell !== EMPTY);
  }

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------

  const game = {
    board: emptyBoard(),
    turn: 1,
    breaches: { 1: 1, 2: 1 },
    over: false,
    winner: 0,
    winningCells: [],
    moves: 0,
  };

  function resetGame() {
    game.board = emptyBoard();
    game.turn = 1;
    game.breaches = { 1: 1, 2: 1 };
    game.over = false;
    game.winner = 0;
    game.winningCells = [];
    game.moves = 0;
  }

  /* Resolve the position after a move by `mover`. The unusual case is a breach
   * that completes lines for both players: the player who pulled the crate is
   * held responsible, so the opponent takes it. */
  function resolve(mover) {
    const lines = findLines(game.board);
    if (lines.length) {
      const mine = lines.filter((l) => l.player === mover);
      const theirs = lines.filter((l) => l.player !== mover);

      const winner = theirs.length ? theirs[0].player : mine[0].player;
      game.winner = winner;
      game.winningCells = lines
        .filter((l) => l.player === winner)
        .flatMap((l) => l.cells);
      game.over = true;
      return;
    }
    if (boardFull(game.board)) {
      game.over = true;
      game.winner = 0;
    }
  }

  function performDrop(col, player) {
    if (game.over || game.turn !== player || !canDrop(game.board, col)) return false;
    applyDrop(game.board, col, player);
    game.moves++;
    resolve(player);
    if (!game.over) game.turn = player === 1 ? 2 : 1;
    return true;
  }

  function performBreach(col, player) {
    if (game.over || game.turn !== player) return false;
    if (game.breaches[player] <= 0) return false;
    if (!canBreach(game.board, col, player)) return false;
    applyBreach(game.board, col);
    game.breaches[player]--;
    game.moves++;
    resolve(player);
    if (!game.over) game.turn = player === 1 ? 2 : 1;
    return true;
  }

  // ---------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------

  const ROOM_PREFIX = "joshcore-duel-";
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

  function newRoomCode() {
    let code = "";
    const values = new Uint32Array(5);
    crypto.getRandomValues(values);
    for (const value of values) code += ALPHABET[value % ALPHABET.length];
    return code;
  }

  const net = {
    peer: null,
    conn: null,
    isHost: false,
    room: "",
    me: 0,
    myName: "",
    theirName: "Opponent",
    connected: false,
    breachArmed: false,
  };

  function send(payload) {
    if (net.conn && net.conn.open) net.conn.send(payload);
  }

  function wireConnection(conn) {
    net.conn = conn;

    conn.on("open", () => {
      net.connected = true;
      send({ type: "hello", name: net.myName });
      setStatus(`Connected to ${net.theirName}.`, "good");
      render();
    });

    conn.on("data", (msg) => {
      if (!msg || typeof msg !== "object") return;

      switch (msg.type) {
        case "hello":
          net.theirName = String(msg.name || "Opponent").slice(0, 24);
          setStatus(`${net.theirName} is here.`, "good");
          render();
          break;

        case "drop":
          // Validated against our own board, so a tampered client can't force
          // an illegal move through.
          if (!performDrop(msg.col, opponentOf(net.me))) {
            setStatus("They sent an illegal move. Ignored.", "bad");
            return;
          }
          render();
          break;

        case "breach":
          if (!performBreach(msg.col, opponentOf(net.me))) {
            setStatus("They sent an illegal breach. Ignored.", "bad");
            return;
          }
          render();
          break;

        case "rematch":
          resetGame();
          net.breachArmed = false;
          setStatus(`${net.theirName} wants another. Go.`, "good");
          render();
          break;

        default:
          break;
      }
    });

    conn.on("close", () => {
      net.connected = false;
      setStatus(`${net.theirName} disconnected.`, "bad");
      render();
    });

    conn.on("error", () => {
      net.connected = false;
      setStatus("Connection error.", "bad");
      render();
    });
  }

  function opponentOf(player) {
    return player === 1 ? 2 : 1;
  }

  function host() {
    net.isHost = true;
    net.me = 1;
    net.room = newRoomCode();

    setStatus("Opening a room…", "");
    net.peer = new Peer(ROOM_PREFIX + net.room, { debug: 0 });

    net.peer.on("open", () => {
      showRoom(net.room);
      setStatus("Waiting for someone to join.", "");
      render();
    });
    net.peer.on("connection", (conn) => wireConnection(conn));
    net.peer.on("error", (err) => {
      setStatus(peerError(err), "bad");
    });
  }

  function join(code) {
    const room = String(code || "").trim().toUpperCase();
    if (room.length !== 5) {
      setStatus("Room codes are five characters.", "bad");
      return;
    }

    net.isHost = false;
    net.me = 2;
    net.room = room;

    setStatus("Connecting…", "");
    net.peer = new Peer({ debug: 0 });

    net.peer.on("open", () => {
      wireConnection(net.peer.connect(ROOM_PREFIX + room, { reliable: true }));
      showRoom(room);
      render();
    });
    net.peer.on("error", (err) => {
      setStatus(peerError(err), "bad");
    });
  }

  function peerError(err) {
    const type = err && err.type ? err.type : "";
    if (type === "peer-unavailable") return "No room with that code. Check it and try again.";
    if (type === "unavailable-id") return "That room is already open. Try hosting again.";
    if (type === "network" || type === "server-error")
      return "Couldn't reach the matchmaking server. Try again in a moment.";
    if (type === "browser-incompatible") return "This browser can't do WebRTC.";
    return "Connection failed: " + (type || "unknown");
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  const el = {};

  function setStatus(text, tone) {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.className = "status" + (tone ? " " + tone : "");
  }

  function showRoom(code) {
    el.lobby.hidden = true;
    el.table.hidden = false;
    el.roomCode.textContent = code;
  }

  function buildGrid() {
    el.grid.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("button");
        cell.className = "cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}`);
        cell.addEventListener("click", () => onCellClick(c));
        el.grid.appendChild(cell);
      }
    }
  }

  function render() {
    const winning = new Set(game.winningCells.map(([r, c]) => r + ":" + c));

    for (const cell of el.grid.children) {
      const r = Number(cell.dataset.row);
      const c = Number(cell.dataset.col);
      const value = game.board[r][c];
      cell.className =
        "cell" +
        (value === 1 ? " p1" : value === 2 ? " p2" : "") +
        (winning.has(r + ":" + c) ? " win" : "");
    }

    const myTurn = net.connected && !game.over && game.turn === net.me;
    el.grid.classList.toggle("active", myTurn);

    el.you.textContent = net.myName || "You";
    el.them.textContent = net.theirName;
    el.youChip.className = "chip " + (net.me === 1 ? "p1" : "p2");
    el.themChip.className = "chip " + (net.me === 1 ? "p2" : "p1");
    el.youBreach.textContent = "◈".repeat(game.breaches[net.me] || 0) || "—";
    el.themBreach.textContent = "◈".repeat(game.breaches[opponentOf(net.me)] || 0) || "—";

    el.breachBtn.disabled = !myTurn || game.breaches[net.me] <= 0;
    el.breachBtn.classList.toggle("armed", net.breachArmed);
    el.breachBtn.textContent = net.breachArmed ? "Pick a column" : "Breach";

    el.rematchBtn.hidden = !game.over;

    if (game.over) {
      if (game.winner === 0) setStatus("Board full. Nobody extracted.", "");
      else if (game.winner === net.me) setStatus("You win.", "good");
      else setStatus(`${net.theirName} wins.`, "bad");
    } else if (net.connected) {
      setStatus(myTurn ? "Your move." : `Waiting for ${net.theirName}…`, myTurn ? "good" : "");
    }
  }

  function onCellClick(col) {
    if (!net.connected || game.over || game.turn !== net.me) return;

    if (net.breachArmed) {
      if (!canBreach(game.board, col, net.me)) {
        setStatus("You can only breach a column with your crate at the bottom.", "bad");
        return;
      }
      if (performBreach(col, net.me)) {
        send({ type: "breach", col });
        net.breachArmed = false;
        render();
      }
      return;
    }

    if (!canDrop(game.board, col)) {
      setStatus("That column is full.", "bad");
      return;
    }
    if (performDrop(col, net.me)) {
      send({ type: "drop", col });
      render();
    }
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    for (const id of [
      "lobby", "table", "grid", "status", "roomCode", "nameInput", "joinInput",
      "hostBtn", "joinBtn", "breachBtn", "rematchBtn", "copyBtn",
      "you", "them", "youChip", "themChip", "youBreach", "themBreach",
    ]) {
      el[id] = document.getElementById(id);
    }
    if (!el.grid) return;

    buildGrid();

    const saved = localStorage.getItem("joshcore-duel-name");
    if (saved) el.nameInput.value = saved;

    function takeName() {
      net.myName = (el.nameInput.value || "").trim().slice(0, 24) || "Raider";
      localStorage.setItem("joshcore-duel-name", net.myName);
    }

    el.hostBtn.addEventListener("click", () => {
      takeName();
      host();
    });

    el.joinBtn.addEventListener("click", () => {
      takeName();
      join(el.joinInput.value);
    });

    el.joinInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") el.joinBtn.click();
    });

    el.breachBtn.addEventListener("click", () => {
      net.breachArmed = !net.breachArmed;
      render();
    });

    el.rematchBtn.addEventListener("click", () => {
      resetGame();
      net.breachArmed = false;
      send({ type: "rematch" });
      render();
    });

    el.copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(net.room);
        el.copyBtn.textContent = "Copied";
        setTimeout(() => (el.copyBtn.textContent = "Copy"), 1500);
      } catch {
        setStatus("Copy the code manually: " + net.room, "");
      }
    });

    // Deep link: /duel?room=ABCDE prefills the code so a link posted in Discord
    // drops straight into the right game.
    const room = new URLSearchParams(location.search).get("room");
    if (room) el.joinInput.value = room.toUpperCase().slice(0, 5);

    render();
  });
})();
