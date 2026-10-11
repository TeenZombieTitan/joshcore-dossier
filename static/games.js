/* Lobby and match presentation, shared by Supply Drop and Breach Point.
 *
 * This file contains no game logic and never touches game state. It watches
 * the two elements the games already write to — the room code and the status
 * line — and reacts to what it sees there.
 *
 * Observing the DOM rather than hooking the games keeps the netcode and the
 * rules in one place. Both games are host-authoritative and peer to peer, and
 * decorating them from the inside would mean a presentation bug could become a
 * desync. Watching from outside, the worst this file can do is fail to animate.
 */

(() => {
  "use strict";

  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

  document.addEventListener("DOMContentLoaded", () => {
    const code = document.getElementById("roomCode");
    const status = document.getElementById("status");
    if (!code && !status) return;

    /* -- room code ---------------------------------------------------- */

    /* Scramble-in: the code cycles random glyphs and settles character by
     * character. Nothing is invented — the settled value is exactly the text
     * the game wrote, and if this is interrupted the real code is restored. */
    let scrambling = false;

    function reveal(target) {
      if (calm.matches || scrambling || target.length < 2) return;

      scrambling = true;
      const letters = [...target];
      let settled = 0;

      const timer = setInterval(() => {
        const shown = letters.map((character, index) =>
          index < settled ? character : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        );
        code.textContent = shown.join("");

        if (settled >= letters.length) {
          clearInterval(timer);
          code.textContent = target;
          scrambling = false;
          code.classList.add("settled");
          setTimeout(() => code.classList.remove("settled"), 700);

          if (window.Blackbox && window.Blackbox.notify) {
            window.Blackbox.notify("Room established · " + target);
          }
        }
        settled += 1;
      }, 55);
    }

    if (code) {
      let last = code.textContent.trim();
      new MutationObserver(() => {
        const now = code.textContent.trim();
        if (scrambling || now === last || now === "—" || !now) {
          if (!scrambling) last = now;
          return;
        }
        last = now;
        reveal(now);
      }).observe(code, { childList: true, characterData: true, subtree: true });
    }

    /* -- status line -------------------------------------------------- */

    /* A short flash when the status text changes, so a message that arrives
     * while you're looking at the board still registers. */
    if (status) {
      let previous = status.textContent.trim();
      new MutationObserver(() => {
        const now = status.textContent.trim();
        if (now === previous) return;
        previous = now;

        if (calm.matches) return;
        status.classList.remove("changed");
        void status.offsetWidth;
        status.classList.add("changed");

        // "Opponent detected" is worth surfacing away from the status strip:
        // it is the one moment the player is most likely to be in Discord
        // rather than looking at the page.
        if (/joined|connected|opponent/i.test(now) && window.Blackbox?.notify) {
          window.Blackbox.notify("Opponent detected");
        }
      }).observe(status, { childList: true, characterData: true, subtree: true });
    }
  });
})();
