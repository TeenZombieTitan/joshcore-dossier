/* Subject file panel.
 *
 * Clicking someone on the directory opens their file in place rather than
 * navigating. Everything it shows is already on the card as data attributes,
 * put there by the template, so opening a file costs no request and works
 * offline once the page is loaded.
 *
 * The cards stay real links. This only intercepts a plain left-click, which
 * leaves middle-click, ctrl-click, "open in new tab", keyboard activation with
 * a modifier, crawlers, and browsers with JS disabled all navigating to the
 * full profile exactly as before. The panel is an enhancement on top of a
 * working link, not a replacement for one.
 */

(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.getElementById("subjectFile");
    const grid = document.getElementById("fileGrid");
    const nameEl = document.getElementById("fileName");
    const avatar = document.getElementById("fileAvatar");
    const status = document.getElementById("fileStatus");
    const seen = document.getElementById("fileSeen");
    const open = document.getElementById("fileOpen");
    const peopleGrid = document.getElementById("peopleGrid");
    if (!panel || !peopleGrid) return;

    let lastFocused = null;

    const number = (value) => Number(value || 0).toLocaleString("en-GB");

    function cell(label, value, lit) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      if (lit) dd.className = "on";
      const wrap = document.createElement("div");
      wrap.className = "file-cell";
      wrap.append(dt, dd);
      return wrap;
    }

    function show(card) {
      const d = card.dataset;

      nameEl.textContent = d.display || "Unknown subject";
      open.href = card.getAttribute("href");

      if (d.avatar) {
        avatar.src = d.avatar;
        avatar.hidden = false;
      } else {
        avatar.hidden = true;
        avatar.removeAttribute("src");
      }

      // Somebody with no XP has a file but no record in it. Saying ACTIVE
      // would be a claim the data doesn't support.
      const ranked = Number(d.xp || 0) > 0;
      status.textContent = ranked ? "ACTIVE" : "NO ACTIVITY ON RECORD";
      status.className = ranked ? "mono tiny green" : "mono tiny faint";

      grid.replaceChildren(
        cell("Level", String(d.level || 0).padStart(2, "0"), ranked),
        cell("XP", number(d.xp)),
        cell("Rep", number(d.rep)),
        cell("Titles", number(d.titles), Number(d.titles || 0) > 0),
        cell("Crowns", number(d.crowns), Number(d.crowns || 0) > 0),
        cell("Messages", number(d.messages)),
        cell("Region", d.region || "—"),
        cell("Playstyle", d.playstyle || "—"),
        cell("Platform", d.platform || "—"),
      );

      seen.textContent = d.seen ? `LAST OBSERVED ${d.seen}` : "";

      lastFocused = card;
      panel.hidden = false;
      document.body.style.overflow = "hidden";
      panel.querySelector(".file-close").focus();
    }

    function close() {
      panel.hidden = true;
      document.body.style.overflow = "";
      if (lastFocused) lastFocused.focus();
    }

    peopleGrid.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;

      const card = event.target.closest(".person");
      if (!card) return;

      event.preventDefault();
      // Stop system.js's page-transition handler seeing this click too.
      event.stopPropagation();
      show(card);
    });

    for (const button of panel.querySelectorAll(".file-close")) {
      button.addEventListener("click", close);
    }

    panel.addEventListener("click", (event) => {
      if (event.target === panel) close();
    });

    document.addEventListener("keydown", (event) => {
      if (panel.hidden) return;
      if (event.key === "Escape") close();
    });
  });
})();
