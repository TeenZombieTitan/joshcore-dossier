/* Directory filtering.
 *
 * Everyone is rendered into the page at build time and filtering just toggles
 * visibility. With a server this would be a query; without one it could have
 * been a fetch-and-render, but for a few dozen people that would mean the page
 * shows nothing until JavaScript runs — worse for sharing, worse for search
 * engines, and worse on a bad connection. Rendering everything and hiding some
 * of it is the right trade at this size.
 */

(() => {
  "use strict";

  const state = { region: "", playstyle: "", platform: "", search: "" };

  document.addEventListener("DOMContentLoaded", () => {
    const grid = document.getElementById("peopleGrid");
    const search = document.getElementById("search");
    const count = document.getElementById("matchCount");
    const empty = document.getElementById("noMatches");
    if (!grid) return;

    const people = [...grid.querySelectorAll(".person")];

    function apply() {
      let shown = 0;

      for (const person of people) {
        const matches =
          (!state.region || person.dataset.region === state.region) &&
          (!state.playstyle || person.dataset.playstyle === state.playstyle) &&
          (!state.platform || person.dataset.platform === state.platform) &&
          (!state.search || person.dataset.name.includes(state.search));

        person.hidden = !matches;
        if (matches) shown++;
      }

      count.textContent = `${shown} OF ${people.length} SHOWN`;
      empty.hidden = shown !== 0;
    }

    for (const group of document.querySelectorAll(".filter-group")) {
      const facet = group.dataset.facet;
      group.addEventListener("click", (event) => {
        const button = event.target.closest(".chip-btn");
        if (!button) return;

        for (const other of group.querySelectorAll(".chip-btn")) {
          other.classList.toggle("on", other === button);
        }
        state[facet] = button.dataset.value;
        apply();
      });
    }

    search.addEventListener("input", () => {
      state.search = search.value.trim().toLowerCase();
      apply();
    });

    apply();
  });
})();
