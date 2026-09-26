/* Blackbox system layer.
 *
 * The ambient half of the interface: the things that make the site feel like a
 * machine that is running rather than a document that is sitting there.
 *
 * Three rules this file follows.
 *
 * Nothing here is load-bearing. Every element it creates is decorative, and
 * every one is injected from here rather than written into the templates — so
 * a browser with JavaScript off gets a plain, complete, working page instead of
 * a skeleton waiting for a script that never arrives.
 *
 * Motion is CSS. This file sets classes and custom properties; it does not run
 * animation loops. The single rAF in here is a pointer-position throttle, and
 * it parks itself when the pointer stops.
 *
 * It defers to the visitor. prefers-reduced-motion disables the ambient system
 * outright, and everything pauses when the tab is hidden.
 */

(() => {
  "use strict";

  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => calm.matches;

  /* ------------------------------------------------------------------ */
  /* Ambient background                                                  */
  /* ------------------------------------------------------------------ */

  function ambient() {
    if (reduced()) return;

    const layer = document.createElement("div");
    layer.className = "ambient";
    layer.setAttribute("aria-hidden", "true");

    layer.innerHTML =
      '<div class="ambient-grid"></div>' +
      '<div class="ambient-scan"></div>' +
      '<div class="ambient-grain"></div>' +
      '<div class="ambient-cursor"></div>' +
      '<div class="ambient-vignette"></div>';

    /* Data points. Random phase as well as random position — a shared phase
     * would read as a pattern blinking in unison, which is exactly what this
     * is trying not to be. */
    for (let i = 0; i < 14; i++) {
      const dot = document.createElement("i");
      dot.className = "ambient-dot";
      dot.style.left = Math.random() * 100 + "%";
      dot.style.top = Math.random() * 100 + "%";
      dot.style.animationDelay = (Math.random() * 9).toFixed(2) + "s";
      dot.style.animationDuration = (7 + Math.random() * 6).toFixed(2) + "s";
      layer.appendChild(dot);
    }

    document.body.prepend(layer);
    cursorGlow(layer.querySelector(".ambient-cursor"));
  }

  /* Pointer-following warmth. Coalesced into one rAF; the frame is only
   * scheduled when the pointer has actually moved since the last one. */
  function cursorGlow(node) {
    if (!node || window.matchMedia("(hover: none)").matches) return;

    let x = 0, y = 0, queued = false;

    function paint() {
      queued = false;
      node.style.setProperty("--mx", x + "px");
      node.style.setProperty("--my", y + "px");
    }

    addEventListener("pointermove", (event) => {
      x = event.clientX;
      y = event.clientY;
      document.body.classList.add("pointer-live");
      if (!queued) {
        queued = true;
        requestAnimationFrame(paint);
      }
    }, { passive: true });

    addEventListener("pointerleave", () => {
      document.body.classList.remove("pointer-live");
    }, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /* Statistics count-up                                                 */
  /* ------------------------------------------------------------------ */

  /* Counts a figure up to the value already rendered into the page.
   *
   * The number in the HTML is the truth and is never replaced — it is read,
   * animated from zero, and written back in its original form. That keeps the
   * real value in the markup for anyone without JS, and keeps the thousands
   * separators the template applied.
   */
  function countUp() {
    const figures = [...document.querySelectorAll(".card.figure .n")];
    if (!figures.length) return;

    for (const figure of figures) {
      // Only the leading text node. `.n` can contain a nested span (the
      // "/28" on a profile's title count) which must be left alone.
      const node = figure.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;

      const original = node.nodeValue.trim();
      const target = Number(original.replace(/,/g, ""));
      if (!Number.isFinite(target) || target <= 0) continue;

      if (reduced()) continue;

      const grouped = original.includes(",");
      const duration = 620;
      const start = performance.now();

      node.nodeValue = "0";

      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        // Ease out cubic. Fast then settling reads as a readout landing.
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = Math.round(target * eased);
        node.nodeValue = grouped ? value.toLocaleString("en-GB") : String(value);
        if (progress < 1) requestAnimationFrame(step);
        else node.nodeValue = original;
      };

      requestAnimationFrame(step);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Notices                                                             */
  /* ------------------------------------------------------------------ */

  let noticeBox = null;

  function notices() {
    if (noticeBox) return noticeBox;
    noticeBox = document.createElement("div");
    noticeBox.className = "notices";
    noticeBox.setAttribute("aria-hidden", "true");
    document.body.appendChild(noticeBox);
    return noticeBox;
  }

  function notify(text, { done = false, life = 3400 } = {}) {
    const box = notices();
    const note = document.createElement("div");
    note.className = "notice" + (done ? " done" : "");
    note.innerHTML = '<i></i><span></span>';
    note.querySelector("span").textContent = text;
    box.appendChild(note);

    setTimeout(() => {
      note.classList.add("out");
      setTimeout(() => note.remove(), 300);
    }, life);

    return note;
  }

  window.Blackbox = window.Blackbox || {};
  window.Blackbox.notify = notify;

  /* ------------------------------------------------------------------ */
  /* System observation                                                  */
  /* ------------------------------------------------------------------ */

  /* Blackbox occasionally appears to do something. This is the signature bit
   * of the interface, so it has to stay rare — a system that announces itself
   * every thirty seconds reads as a screensaver, not a presence.
   *
   * The tasks are real in the sense that the counts come from the page, and
   * nothing here claims an event happened that didn't.
   */
  function observe() {
    if (reduced()) return;

    const subjects = document.body.dataset.subjects || "";
    const events = document.body.dataset.events || "";

    const tasks = [
      ["BLACKBOX // OBSERVING SERVER", "OBSERVATION COMPLETE"],
      ["BLACKBOX // CROSS-REFERENCING", "ARCHIVE CONSISTENT"],
      ["BLACKBOX // VERIFYING RECORDS", "NO DISCREPANCIES FOUND"],
      ["BLACKBOX // SYNCHRONISING", "SYNC COMPLETE"],
    ];
    if (subjects) tasks.push([`BLACKBOX // INDEXING ${subjects} SUBJECTS`, "INDEX COMPLETE"]);
    if (events) tasks.push([`BLACKBOX // REPLAYING ${events} EVENTS`, "REPLAY COMPLETE"]);

    function run() {
      if (document.hidden) return;
      const [working, finished] = tasks[Math.floor(Math.random() * tasks.length)];
      const note = notify(working, { life: 2600 });
      setTimeout(() => {
        if (!note.isConnected) return;
        note.classList.add("done");
        note.querySelector("span").textContent = finished;
      }, 2000);
    }

    // First one once the page has settled, then rarely.
    setTimeout(run, 7000 + Math.random() * 5000);
    setInterval(() => {
      if (Math.random() < 0.55) run();
    }, 190000);
  }

  /* ------------------------------------------------------------------ */
  /* Clock                                                               */
  /* ------------------------------------------------------------------ */

  function clock() {
    const nodes = [...document.querySelectorAll("[data-clock]")];
    if (!nodes.length) return;

    const tick = () => {
      const now = new Date();
      const text = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
      for (const node of nodes) node.textContent = text;
    };

    tick();
    setInterval(() => { if (!document.hidden) tick(); }, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  function nav() {
    const toggle = document.querySelector(".nav-toggle");
    const menu = document.getElementById("nav");
    if (!toggle || !menu) return;

    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "CLOSE" : "MENU";
    });
  }

  /* Page transition.
   *
   * Deliberately narrow: only a plain left-click, on a same-origin document
   * link, with no modifier held. Anything else — a new tab, a download, an
   * external link, an in-page anchor — is left entirely alone, because
   * hijacking those to play an animation is how navigation gets broken.
   */
  function transitions() {
    if (reduced()) return;

    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = event.target.closest("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return;
      if (url.href === location.href) return;

      event.preventDefault();
      document.body.classList.add("leaving");
      setTimeout(() => { location.href = url.href; }, 150);
    });

    // Coming back via the bfcache restores the faded-out page as it was left.
    addEventListener("pageshow", (event) => {
      if (event.persisted) document.body.classList.remove("leaving");
    });
  }

  /* Button press pulse, originating at the click point. */
  function buttons() {
    document.addEventListener("pointerdown", (event) => {
      if (reduced()) return;
      const button = event.target.closest(".btn");
      if (!button) return;

      const box = button.getBoundingClientRect();
      button.style.setProperty("--px", ((event.clientX - box.left) / box.width * 100) + "%");
      button.style.setProperty("--py", ((event.clientY - box.top) / box.height * 100) + "%");

      button.classList.remove("pulse");
      // Force a reflow so the animation restarts on a rapid second click.
      void button.offsetWidth;
      button.classList.add("pulse");
      setTimeout(() => button.classList.remove("pulse"), 500);
    }, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  /* Shown once per session, never on a repeat navigation — a loading screen
   * on every page view would be theatre that costs the visitor time. It is
   * also created here rather than in the template, so it can never be the
   * thing covering a page whose JS failed to run.
   */
  function boot() {
    if (reduced()) return;
    try {
      if (sessionStorage.getItem("joshcore-booted")) return;
      sessionStorage.setItem("joshcore-booted", "1");
    } catch {
      return; // Private mode: skip rather than show it every single page.
    }

    const screen = document.createElement("div");
    screen.className = "boot";
    screen.setAttribute("aria-hidden", "true");
    screen.innerHTML =
      '<div class="boot-label">Blackbox // Initialising</div>' +
      '<div class="boot-bar"><b></b><span></span></div>';

    const filled = screen.querySelector("b");
    const rest = screen.querySelector("span");
    document.body.appendChild(screen);

    const CELLS = 14;
    let done = 0;

    const timer = setInterval(() => {
      done = Math.min(CELLS, done + 1 + Math.floor(Math.random() * 3));
      filled.textContent = "█".repeat(done);
      rest.textContent = "░".repeat(CELLS - done) +
        "  " + String(Math.round(done / CELLS * 100)).padStart(3) + "%";

      if (done >= CELLS) {
        clearInterval(timer);
        setTimeout(() => {
          screen.classList.add("gone");
          setTimeout(() => screen.remove(), 400);
        }, 180);
      }
    }, 70);
  }

  /* ------------------------------------------------------------------ */
  /* Feed                                                                */
  /* ------------------------------------------------------------------ */

  /* Staggers the entrance of feed lines already rendered by the template.
   * No line is invented and none is added later — the feed shows recorded
   * history, and inventing live events would make the page a lie. */
  function feed() {
    const lines = [...document.querySelectorAll(".feed-line")];
    if (!lines.length || reduced()) return;

    lines.slice(0, 12).forEach((line, index) => {
      line.style.animationDelay = index * 55 + "ms";
      line.classList.add("fresh");
    });
  }

  /* ------------------------------------------------------------------ */

  document.addEventListener("DOMContentLoaded", () => {
    ambient();
    boot();
    countUp();
    feed();
    clock();
    nav();
    buttons();
    transitions();
    observe();
  });
})();
