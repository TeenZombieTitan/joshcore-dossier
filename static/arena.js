/* Breach Point — 1v1 top-down shooter, browser to browser.
 *
 * Design steer borrowed from Hypersomnia's own description of itself ("the
 * tactics of Counter-Strike, the dynamics of Hotline Miami"): a very low
 * time-to-kill, so positioning and first contact decide fights rather than
 * sustained aim. Two hits and you're gone. None of their code is used — it's
 * C++ and AGPL-3.0, so a port would both be a rewrite and would force this
 * whole site under AGPL.
 *
 * The low TTK is also the right call technically. Short engagements mean fewer
 * entities in flight and less sustained state to keep in sync over a peer
 * connection.
 *
 * NETWORKING
 * The host runs the entire simulation and is the single source of truth. The
 * guest sends nothing but its input and renders what it is told. Without one
 * authority the two clients inevitably disagree about who shot first, and there
 * is no fair way to resolve that after the fact.
 *
 * The guest still moves itself locally the instant a key goes down, then eases
 * toward the host's position as corrections arrive. Waiting a full round trip
 * before you move feels broken even at 30ms.
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Arena
  // ---------------------------------------------------------------------

  const W = 900;
  const H = 560;

  const PLAYER_R = 13;
  const SPEED = 225;
  const MAX_HP = 100;
  const DAMAGE = 50;          // two hits
  const FIRE_COOLDOWN = 0.34; // deliberate, not a spray
  const BULLET_SPEED = 720;
  const BULLET_R = 3.5;
  const BULLET_LIFE = 1.6;

  const ROUNDS_TO_WIN = 5;
  const FREEZE_TIME = 1.4;
  const ROUND_END_PAUSE = 1.8;

  /* A capture point opens partway through the round. In a 1v1 with a two-hit
   * kill the failure mode is both players refusing to peek, so the round needs
   * something that punishes waiting. */
  const CAPTURE_OPENS_AT = 18;
  const CAPTURE_R = 46;
  const CAPTURE_HOLD = 4;

  const WALLS = [
    { x: 0, y: 0, w: W, h: 12 },
    { x: 0, y: H - 12, w: W, h: 12 },
    { x: 0, y: 0, w: 12, h: H },
    { x: W - 12, y: 0, w: 12, h: H },

    { x: 150, y: 110, w: 22, h: 150 },
    { x: 150, y: 300, w: 22, h: 150 },
    { x: W - 172, y: 110, w: 22, h: 150 },
    { x: W - 172, y: 300, w: 22, h: 150 },

    { x: 330, y: 60, w: 240, h: 20 },
    { x: 330, y: H - 80, w: 240, h: 20 },

    { x: 424, y: 232, w: 52, h: 96 },

    { x: 300, y: 210, w: 20, h: 140 },
    { x: W - 320, y: 210, w: 20, h: 140 },
  ];

  const SPAWNS = [
    { x: 70, y: H / 2 },
    { x: W - 70, y: H / 2 },
  ];

  const CAPTURE_SPOTS = [
    { x: W / 2, y: 120 },
    { x: W / 2, y: H - 120 },
    { x: 230, y: H / 2 },
    { x: W - 230, y: H / 2 },
  ];

  // ---------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------

  function circleHitsRect(cx, cy, r, rect) {
    const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function blocked(x, y, r) {
    for (const wall of WALLS) if (circleHitsRect(x, y, r, wall)) return true;
    return false;
  }

  /* Axis-separated movement, so sliding along a wall works instead of sticking
   * to it — the single biggest thing that makes top-down movement feel bad. */
  function moveWithCollision(entity, dx, dy) {
    if (dx && !blocked(entity.x + dx, entity.y, PLAYER_R)) entity.x += dx;
    if (dy && !blocked(entity.x, entity.y + dy, PLAYER_R)) entity.y += dy;
  }

  // ---------------------------------------------------------------------
  // World
  // ---------------------------------------------------------------------

  function newPlayer(index) {
    return {
      x: SPAWNS[index].x,
      y: SPAWNS[index].y,
      angle: index === 0 ? 0 : Math.PI,
      hp: MAX_HP,
      alive: true,
      cooldown: 0,
      score: 0,
    };
  }

  const world = {
    players: [newPlayer(0), newPlayer(1)],
    bullets: [],
    clock: 0,
    phase: "freeze", // freeze | live | over
    phaseTimer: FREEZE_TIME,
    roundWinner: -1,
    capture: null,
    matchOver: false,
    matchWinner: -1,
  };

  function resetRound(keepScores = true) {
    const scores = world.players.map((p) => p.score);
    world.players = [newPlayer(0), newPlayer(1)];
    if (keepScores) world.players.forEach((p, i) => (p.score = scores[i]));
    world.bullets = [];
    world.clock = 0;
    world.phase = "freeze";
    world.phaseTimer = FREEZE_TIME;
    world.roundWinner = -1;
    world.capture = null;
  }

  function openCapture() {
    const spot = CAPTURE_SPOTS[Math.floor(Math.random() * CAPTURE_SPOTS.length)];
    world.capture = { x: spot.x, y: spot.y, progress: 0, holder: -1 };
  }

  function endRound(winner, cause) {
    // A round can only end once; without this guard every bullet still in the
    // air when someone dies lands during the "over" phase and scores again.
    if (world.phase === "over" || world.matchOver) return;

    roundLog.push({ winner, cause, clock: Number(world.clock.toFixed(1)) });
    world.roundWinner = winner;
    world.phase = "over";
    world.phaseTimer = ROUND_END_PAUSE;
    if (winner >= 0) world.players[winner].score++;

    if (world.players[winner] && world.players[winner].score >= ROUNDS_TO_WIN) {
      world.matchOver = true;
      world.matchWinner = winner;
    }
  }

  // ---------------------------------------------------------------------
  // Simulation (host only)
  // ---------------------------------------------------------------------

  const inputs = [
    { up: 0, down: 0, left: 0, right: 0, aim: 0, fire: 0 },
    { up: 0, down: 0, left: 0, right: 0, aim: Math.PI, fire: 0 },
  ];

  function step(dt) {
    if (world.matchOver) return;

    if (world.phase !== "live") {
      world.phaseTimer -= dt;
      if (world.phaseTimer <= 0) {
        if (world.phase === "freeze") {
          world.phase = "live";
        } else {
          resetRound();
        }
      }
      if (world.phase !== "live") return;
    }

    world.clock += dt;

    if (!world.capture && world.clock >= CAPTURE_OPENS_AT) openCapture();

    // -- players ---------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      const player = world.players[i];
      const input = inputs[i];
      if (!player.alive) continue;

      player.angle = input.aim;
      player.cooldown = Math.max(0, player.cooldown - dt);

      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      if (dx && dy) {
        const inv = Math.SQRT1_2;
        dx *= inv;
        dy *= inv;
      }
      moveWithCollision(player, dx * SPEED * dt, dy * SPEED * dt);

      if (input.fire && player.cooldown <= 0) {
        player.cooldown = FIRE_COOLDOWN;
        world.bullets.push({
          x: player.x + Math.cos(player.angle) * (PLAYER_R + 5),
          y: player.y + Math.sin(player.angle) * (PLAYER_R + 5),
          vx: Math.cos(player.angle) * BULLET_SPEED,
          vy: Math.sin(player.angle) * BULLET_SPEED,
          owner: i,
          life: BULLET_LIFE,
        });
      }
    }

    // -- bullets ---------------------------------------------------------
    for (let b = world.bullets.length - 1; b >= 0; b--) {
      const bullet = world.bullets[b];
      bullet.life -= dt;

      /* Stepped in slices so a fast bullet can't tunnel through a wall or a
       * player between frames — at 720px/s a single 16ms step is 12px, most of
       * a player's radius. */
      const steps = 3;
      let dead = bullet.life <= 0;

      for (let s = 0; s < steps && !dead; s++) {
        bullet.x += (bullet.vx * dt) / steps;
        bullet.y += (bullet.vy * dt) / steps;

        if (blocked(bullet.x, bullet.y, BULLET_R)) {
          dead = true;
          break;
        }
        for (let p = 0; p < 2; p++) {
          const target = world.players[p];
          if (p === bullet.owner || !target.alive) continue;
          const dx = target.x - bullet.x;
          const dy = target.y - bullet.y;
          if (dx * dx + dy * dy < (PLAYER_R + BULLET_R) ** 2) {
            target.hp -= DAMAGE;
            if (p === net.me) flashHit();
            dead = true;
            if (target.hp <= 0) {
              target.alive = false;
              endRound(bullet.owner, "kill");
            }
            break;
          }
        }
      }
      if (dead) world.bullets.splice(b, 1);
    }

    // -- capture ---------------------------------------------------------
    if (world.capture && world.phase === "live") {
      const zone = world.capture;
      const inside = [];
      for (let i = 0; i < 2; i++) {
        const player = world.players[i];
        if (!player.alive) continue;
        const dx = player.x - zone.x;
        const dy = player.y - zone.y;
        if (dx * dx + dy * dy < CAPTURE_R * CAPTURE_R) inside.push(i);
      }

      if (inside.length === 1) {
        if (zone.holder !== inside[0]) {
          zone.holder = inside[0];
          zone.progress = 0;
        }
        zone.progress += dt;
        if (zone.progress >= CAPTURE_HOLD) endRound(zone.holder, "capture");
      } else {
        // Contested or empty: bleed back, don't reset outright.
        zone.progress = Math.max(0, zone.progress - dt * 0.6);
        if (zone.progress === 0) zone.holder = -1;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------

  const ROOM_PREFIX = "joshcore-arena-";
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const net = {
    peer: null,
    conn: null,
    isHost: false,
    room: "",
    me: 0,
    myName: "",
    theirName: "Opponent",
    connected: false,
    lastState: 0,
  };

  function roomCode() {
    let out = "";
    const values = new Uint32Array(5);
    crypto.getRandomValues(values);
    for (const v of values) out += ALPHABET[v % ALPHABET.length];
    return out;
  }

  function send(payload) {
    if (net.conn && net.conn.open) {
      try { net.conn.send(payload); } catch { /* channel closing */ }
    }
  }

  function packState() {
    return {
      t: "s",
      p: world.players.map((p) => [
        Math.round(p.x), Math.round(p.y),
        Number(p.angle.toFixed(2)),
        p.hp, p.alive ? 1 : 0, p.score,
      ]),
      b: world.bullets.map((b) => [Math.round(b.x), Math.round(b.y), b.owner]),
      c: world.capture
        ? [Math.round(world.capture.x), Math.round(world.capture.y),
           Number(world.capture.progress.toFixed(2)), world.capture.holder]
        : null,
      ph: world.phase,
      pt: Number(world.phaseTimer.toFixed(2)),
      rw: world.roundWinner,
      mo: world.matchOver ? 1 : 0,
      mw: world.matchWinner,
      ck: Math.round(world.clock),
    };
  }

  function applyState(s) {
    for (let i = 0; i < 2; i++) {
      const p = world.players[i];
      const [x, y, angle, hp, alive, score] = s.p[i];

      if (i === net.me) {
        /* Our own position is predicted locally. Ease toward the host rather
         * than snapping, unless we've drifted far enough that something is
         * genuinely wrong. */
        const drift = Math.hypot(p.x - x, p.y - y);
        if (drift > 60) { p.x = x; p.y = y; }
        else { p.x += (x - p.x) * 0.25; p.y += (y - p.y) * 0.25; }
      } else {
        p.x = x; p.y = y; p.angle = angle;
      }
      if (i === net.me && hp < p.hp) flashHit();
      p.hp = hp;
      p.alive = !!alive;
      p.score = score;
    }

    world.bullets = s.b.map(([x, y, owner]) => ({ x, y, owner }));
    world.capture = s.c
      ? { x: s.c[0], y: s.c[1], progress: s.c[2], holder: s.c[3] }
      : null;
    world.phase = s.ph;
    world.phaseTimer = s.pt;
    world.roundWinner = s.rw;
    world.matchOver = !!s.mo;
    world.matchWinner = s.mw;
    world.clock = s.ck;
    net.lastState = performance.now();
  }

  function wire(conn) {
    net.conn = conn;

    conn.on("open", () => {
      net.connected = true;
      send({ t: "hi", name: net.myName });
      show();
    });

    conn.on("data", (msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.t) {
        case "hi":
          net.theirName = String(msg.name || "Opponent").slice(0, 20);
          break;
        case "i":
          if (net.isHost) {
            const guest = inputs[1];
            guest.up = msg.u; guest.down = msg.d;
            guest.left = msg.l; guest.right = msg.r;
            guest.aim = msg.a; guest.fire = msg.f;
          }
          break;
        case "s":
          if (!net.isHost) applyState(msg);
          break;
        case "rm":
          world.players.forEach((p) => (p.score = 0));
          world.matchOver = false;
          world.matchWinner = -1;
          resetRound(false);
          break;
        default: break;
      }
    });

    conn.on("close", () => { net.connected = false; setStatus(`${net.theirName} disconnected.`, "bad"); });
    conn.on("error", () => { net.connected = false; setStatus("Connection error.", "bad"); });
  }

  function host() {
    net.isHost = true;
    net.me = 0;
    net.room = roomCode();
    setStatus("Opening a room…", "");

    net.peer = new Peer(ROOM_PREFIX + net.room, { debug: 0 });
    net.peer.on("open", () => { show(); setStatus("Waiting for an opponent.", ""); });
    net.peer.on("connection", wire);
    net.peer.on("error", (e) => setStatus(peerError(e), "bad"));
  }

  function join(code) {
    const room = String(code || "").trim().toUpperCase();
    if (room.length !== 5) { setStatus("Room codes are five characters.", "bad"); return; }

    net.isHost = false;
    net.me = 1;
    net.room = room;
    setStatus("Connecting…", "");

    net.peer = new Peer({ debug: 0 });
    net.peer.on("open", () => { wire(net.peer.connect(ROOM_PREFIX + room, { reliable: false })); show(); });
    net.peer.on("error", (e) => setStatus(peerError(e), "bad"));
  }

  function peerError(err) {
    const type = (err && err.type) || "";
    if (type === "peer-unavailable") return "No room with that code.";
    if (type === "unavailable-id") return "That room is already open.";
    if (type === "network" || type === "server-error") return "Couldn't reach matchmaking. Try again.";
    if (type === "browser-incompatible") return "This browser can't do WebRTC.";
    return "Connection failed: " + (type || "unknown");
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------

  const keys = Object.create(null);
  let mouse = { x: W / 2, y: H / 2, down: false };

  function localInput() {
    const me = inputs[net.me];
    me.up = keys["w"] || keys["arrowup"] ? 1 : 0;
    me.down = keys["s"] || keys["arrowdown"] ? 1 : 0;
    me.left = keys["a"] || keys["arrowleft"] ? 1 : 0;
    me.right = keys["d"] || keys["arrowright"] ? 1 : 0;
    me.fire = mouse.down ? 1 : 0;

    const self = world.players[net.me];
    me.aim = Math.atan2(mouse.y - self.y, mouse.x - self.x);
    return me;
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  const el = {};
  let ctx = null;

  /* Damage feedback. Purely visual: a red vignette on the frame around the
   * canvas for one animation, driven by CSS. Called from both the host's
   * collision check and the client's state apply, so whoever is running the
   * simulation, the player who was hit is the one who sees it.
   *
   * Deliberately outside the canvas. Drawing it into the scene would mean
   * touching the render loop and could obscure the thing that just shot you. */
  let hitClear = 0;
  function flashHit() {
    const frame = el.canvas && el.canvas.closest(".stage-wrap");
    if (!frame) return;
    frame.classList.add("hit");
    clearTimeout(hitClear);
    hitClear = setTimeout(() => frame.classList.remove("hit"), 140);
  }

  const COLOURS = ["#3ba55d", "#e0a458"];

  function setStatus(text, tone) {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.className = "status" + (tone ? " " + tone : "");
  }

  function show() {
    el.lobby.hidden = true;
    el.stage.hidden = false;
    el.roomCode.textContent = net.room;
    el.canvas.focus();
  }

  function draw() {
    ctx.fillStyle = "#0a0b0c";
    ctx.fillRect(0, 0, W, H);

    // Faint grid, same language as the site.
    ctx.strokeStyle = "rgba(255,255,255,0.022)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 45) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 45) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Capture zone
    if (world.capture) {
      const z = world.capture;
      const share = Math.min(1, z.progress / CAPTURE_HOLD);
      ctx.strokeStyle = z.holder >= 0 ? COLOURS[z.holder] : "#5a5751";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(z.x, z.y, CAPTURE_R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      if (share > 0) {
        ctx.strokeStyle = COLOURS[z.holder] || "#5a5751";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(z.x, z.y, CAPTURE_R, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
        ctx.stroke();
      }
    }

    // Walls
    ctx.fillStyle = "#1b1e22";
    ctx.strokeStyle = "#26292e";
    ctx.lineWidth = 1;
    for (const wall of WALLS) {
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);
    }

    // Bullets
    for (const b of world.bullets) {
      ctx.fillStyle = COLOURS[b.owner];
      ctx.beginPath(); ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2); ctx.fill();
    }

    // Players
    for (let i = 0; i < 2; i++) {
      const p = world.players[i];
      if (!p.alive) continue;

      ctx.fillStyle = COLOURS[i];
      ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = COLOURS[i];
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(p.angle) * (PLAYER_R + 9), p.y + Math.sin(p.angle) * (PLAYER_R + 9));
      ctx.stroke();

      if (i === net.me) {
        ctx.strokeStyle = "rgba(232,230,225,0.5)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R + 5, 0, Math.PI * 2); ctx.stroke();
      }

      if (p.hp < MAX_HP) {
        ctx.fillStyle = "#26292e";
        ctx.fillRect(p.x - 16, p.y - PLAYER_R - 12, 32, 4);
        ctx.fillStyle = COLOURS[i];
        ctx.fillRect(p.x - 16, p.y - PLAYER_R - 12, 32 * (p.hp / MAX_HP), 4);
      }
    }

    // Overlays
    ctx.textAlign = "center";
    if (world.matchOver) {
      banner(world.matchWinner === net.me ? "YOU WIN THE MATCH" : "MATCH LOST",
             world.matchWinner === net.me ? COLOURS[net.me] : "#ed4245");
    } else if (world.phase === "freeze") {
      banner(Math.ceil(world.phaseTimer).toString(), "#e8e6e1");
    } else if (world.phase === "over") {
      banner(world.roundWinner === net.me ? "ROUND WON" : "ROUND LOST",
             world.roundWinner === net.me ? COLOURS[net.me] : "#ed4245");
    } else if (!world.capture) {
      ctx.fillStyle = "rgba(90,87,81,0.9)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(
        `BREACH POINT OPENS IN ${Math.max(0, Math.ceil(CAPTURE_OPENS_AT - world.clock))}`,
        W / 2, 30
      );
    }

    updateHud();
  }

  function banner(text, colour) {
    ctx.fillStyle = "rgba(10,11,12,0.72)";
    ctx.fillRect(0, H / 2 - 42, W, 84);
    ctx.fillStyle = colour;
    ctx.font = "600 28px ui-monospace, monospace";
    ctx.fillText(text, W / 2, H / 2 + 10);
  }

  function updateHud() {
    el.youName.textContent = net.myName || "You";
    el.themName.textContent = net.theirName;
    el.youScore.textContent = world.players[net.me].score;
    el.themScore.textContent = world.players[net.me === 0 ? 1 : 0].score;
    el.youDot.style.background = COLOURS[net.me];
    el.themDot.style.background = COLOURS[net.me === 0 ? 1 : 0];
    el.rematch.hidden = !world.matchOver;
  }

  // ---------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------

  const roundLog = [];

  /* Simulation and rendering are driven separately on purpose.
   *
   * requestAnimationFrame is suspended entirely while a tab is in the
   * background, so running the simulation from it means the match freezes for
   * BOTH players the moment the host looks at another window — the guest just
   * watches everything stop, with no indication why.
   *
   * setInterval keeps firing when hidden (throttled to roughly 1Hz), so the
   * host stays authoritative. A fixed timestep with an accumulator keeps the
   * physics identical regardless of how irregularly the ticks arrive, and the
   * catch-up is capped so a long stall can't produce one enormous jump.
   */
  const FIXED_DT = 1 / 60;
  const MAX_CATCHUP = 8; // at most ~133ms of simulation per tick

  let simClock = 0;
  let accumulator = 0;
  let sendAccumulator = 0;

  function tick() {
    const now = performance.now();
    if (!simClock) simClock = now;
    const elapsed = Math.min((now - simClock) / 1000, 0.5);
    simClock = now;

    if (!net.connected) return;

    const input = localInput();

    if (net.isHost) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_CATCHUP) {
        step(FIXED_DT);
        accumulator -= FIXED_DT;
        steps++;
      }
      if (accumulator > FIXED_DT * MAX_CATCHUP) accumulator = 0; // gave up catching up

      sendAccumulator += elapsed;
      if (sendAccumulator >= 1 / 30) { sendAccumulator = 0; send(packState()); }
    } else {
      send({ t: "i", u: input.up, d: input.down, l: input.left, r: input.right, a: input.aim, f: input.fire });

      // Predict our own movement so the controls feel immediate.
      const self = world.players[net.me];
      if (self.alive && world.phase === "live") {
        let dx = input.right - input.left;
        let dy = input.down - input.up;
        if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
        moveWithCollision(self, dx * SPEED * elapsed, dy * SPEED * elapsed);
        self.angle = input.aim;
      }
    }

    if (world.matchOver) setStatus(world.matchWinner === net.me ? "You won." : `${net.theirName} won.`, world.matchWinner === net.me ? "good" : "bad");
    else if (world.phase === "freeze") setStatus("Get ready…", "");
    else setStatus(`First to ${ROUNDS_TO_WIN} rounds.`, "");
  }

  function frame() {
    draw();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    for (const id of ["lobby", "stage", "canvas", "status", "roomCode", "nameInput",
                      "joinInput", "hostBtn", "joinBtn", "copyBtn", "rematch",
                      "youName", "themName", "youScore", "themScore", "youDot", "themDot"]) {
      el[id] = document.getElementById(id);
    }
    if (!el.canvas) return;

    el.canvas.width = W;
    el.canvas.height = H;
    ctx = el.canvas.getContext("2d");

    const saved = localStorage.getItem("joshcore-arena-name");
    if (saved) el.nameInput.value = saved;

    function takeName() {
      net.myName = (el.nameInput.value || "").trim().slice(0, 20) || "Raider";
      localStorage.setItem("joshcore-arena-name", net.myName);
    }

    el.hostBtn.addEventListener("click", () => { takeName(); host(); });
    el.joinBtn.addEventListener("click", () => { takeName(); join(el.joinInput.value); });
    el.joinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") el.joinBtn.click(); });

    el.copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(net.room);
        el.copyBtn.textContent = "Copied";
        setTimeout(() => (el.copyBtn.textContent = "Copy"), 1500);
      } catch { setStatus("Code: " + net.room, ""); }
    });

    el.rematch.addEventListener("click", () => {
      world.players.forEach((p) => (p.score = 0));
      world.matchOver = false;
      world.matchWinner = -1;
      resetRound(false);
      send({ t: "rm" });
    });

    addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      keys[k] = true;
      // Arrows and space scroll the page otherwise, which is fatal mid-fight.
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    });
    addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
    addEventListener("blur", () => { for (const k in keys) keys[k] = false; mouse.down = false; });

    function pointerAt(event) {
      const rect = el.canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * W;
      mouse.y = ((event.clientY - rect.top) / rect.height) * H;
    }
    el.canvas.addEventListener("mousemove", pointerAt);
    el.canvas.addEventListener("mousedown", (e) => { pointerAt(e); mouse.down = true; e.preventDefault(); });
    addEventListener("mouseup", () => { mouse.down = false; });
    el.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    if (new URLSearchParams(location.search).get("debug") === "1") {
      // Diagnostics only. The simulation already lives in this browser, so this
      // reveals nothing a determined client couldn't already reach.
      window.__arena = { world, inputs, net, roundLog, WALLS, SPAWNS };
    }

    const room = new URLSearchParams(location.search).get("room");
    if (room) el.joinInput.value = room.toUpperCase().slice(0, 5);

    setInterval(tick, 1000 / 90);   // survives a backgrounded tab
    requestAnimationFrame(frame);   // rendering only
  });
})();
