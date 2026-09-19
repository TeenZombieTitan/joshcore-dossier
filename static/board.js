/* Standings re-ranking.
 *
 * Every column the controls sort by is already rendered into each row as a
 * data attribute, so re-ranking is a sort of nodes rather than a request. The
 * server-rendered order is XP descending, which is what the page shows before
 * this script runs and what it falls back to if the script never does.
 *
 * Rank numbers are rewritten on sort. Leaving "1, 2, 3" pinned to the original
 * XP order while the rows moved underneath would be actively misleading.
 */

(() => {
  "use strict";

  const LABELS = {
    xp:       "RANKED BY EXPERIENCE",
    level:    "RANKED BY LEVEL",
    rep:      "RANKED BY REPUTATION",
    crowns:   "RANKED BY CROWNS HELD",
    activity: "RANKED BY MESSAGES SENT",
  };

  document.addEventListener("DOMContentLoaded", () => {
    const board = document.getElementById("board");
    const group = document.getElementById("sortGroup");
    const note = document.getElementById("sortNote");
    if (!board || !group) return;

    const rows = [...board.querySelectorAll(".board-row")];
    if (!rows.length) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

    function rank(key) {
      const sorted = [...rows].sort((a, b) => {
        const difference = Number(b.dataset[key] || 0) - Number(a.dataset[key] || 0);
        // Ties fall back to XP so the order is stable and meaningful rather
        // than whatever the sort happened to leave behind.
        return difference || Number(b.dataset.xp || 0) - Number(a.dataset.xp || 0);
      });

      sorted.forEach((row, index) => {
        row.querySelector(".pos").textContent = String(index + 1);
        row.classList.toggle("rank-1", index === 0);
        row.classList.toggle("rank-2", index === 1);
        row.classList.toggle("rank-3", index === 2);
        board.appendChild(row);

        if (!calm.matches && index < 24) {
          row.style.animation = "none";
          void row.offsetWidth;
          row.style.animation = `rise 380ms cubic-bezier(0.16,1,0.3,1) ${index * 22}ms both`;
        }
      });

      if (note) note.textContent = `${LABELS[key] || "RANKED"} · ${rows.length} SUBJECTS`;
    }

    group.addEventListener("click", (event) => {
      const button = event.target.closest(".chip-btn");
      if (!button) return;

      for (const other of group.querySelectorAll(".chip-btn")) {
        other.classList.toggle("on", other === button);
      }
      rank(button.dataset.value);
    });

    // Mark the podium on first paint without disturbing the server's order.
    rows.forEach((row, index) => {
      row.classList.toggle("rank-1", index === 0);
      row.classList.toggle("rank-2", index === 1);
      row.classList.toggle("rank-3", index === 2);
    });
  });
})();
