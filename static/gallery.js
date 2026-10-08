/* Gallery lightbox.
 *
 * Thumbnails on the grid, the larger copy only once something is opened — a
 * page of full-size images would be several megabytes before anyone had clicked
 * anything.
 */

(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const box = document.getElementById("lightbox");
    const image = document.getElementById("lightboxImage");
    const by = document.getElementById("lightboxBy");
    const caption = document.getElementById("lightboxCaption");
    const evidence = document.getElementById("lightboxId");
    if (!box) return;

    const shots = [...document.querySelectorAll(".shot")];
    let index = -1;

    function open(next) {
      if (next < 0 || next >= shots.length) return;
      index = next;

      const shot = shots[index];
      image.src = shot.dataset.full;
      if (evidence) {
        evidence.textContent =
          `Evidence #${shot.dataset.evidence || "----"} · captured ${shot.dataset.time || shot.dataset.when}`;
      }
      by.textContent = `Submitted by ${shot.dataset.by}`;
      caption.textContent = shot.dataset.caption || "";

      box.hidden = false;
      document.body.style.overflow = "hidden";

      // Quietly warm the neighbours so paging through doesn't flash white.
      for (const offset of [1, -1]) {
        const neighbour = shots[index + offset];
        if (neighbour) new Image().src = neighbour.dataset.full;
      }
    }

    function close() {
      box.hidden = true;
      image.src = "";
      document.body.style.overflow = "";
      if (shots[index]) shots[index].focus();
    }

    shots.forEach((shot, position) => {
      shot.addEventListener("click", () => open(position));
    });

    box.querySelector(".lightbox-close").addEventListener("click", close);
    box.querySelector(".lightbox-prev").addEventListener("click", (e) => {
      e.stopPropagation();
      open(index - 1);
    });
    box.querySelector(".lightbox-next").addEventListener("click", (e) => {
      e.stopPropagation();
      open(index + 1);
    });

    // Clicking the backdrop closes; clicking the image itself should not.
    box.addEventListener("click", (event) => {
      if (event.target === box) close();
    });
    image.addEventListener("click", (event) => event.stopPropagation());

    document.addEventListener("keydown", (event) => {
      if (box.hidden) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") open(index - 1);
      if (event.key === "ArrowRight") open(index + 1);
    });
  });
})();
