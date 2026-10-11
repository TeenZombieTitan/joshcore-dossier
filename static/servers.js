/* Remembering which dossiers this browser holds links to.
 *
 * Each server's pages live under an unguessable path, and there is no index of
 * them anywhere on the site — that absence is what stops one community
 * browsing into another's. The cost is that arriving somewhere means having
 * been handed a link, every time.
 *
 * This closes that gap without reopening the hole: when you open a dossier,
 * the browser keeps a note of it, and the masthead can then offer to take you
 * back — or, once you hold more than one, to switch between them.
 *
 * The list lives in localStorage and is never published, never sent anywhere
 * and never part of the build. It holds only what this browser was already
 * given. Nothing here can discover a server you have not been shown, which is
 * exactly the property the published site has to keep.
 *
 * A signed-in account is deliberately *not* what drives this. Proving who you
 * are to Discord cannot be checked by a static host, so tying the list to an
 * account would mean publishing a file that maps people to servers — and that
 * file would hand every token to whoever fetched it. Until there is a server
 * that can keep a secret, the browser's own history is the honest basis.
 */

(() => {
  "use strict";

  /* Internal key, so it keeps the joshcore prefix the others use. Renaming it
   * would silently drop everyone's remembered servers. */
  const STORE = "joshcore-servers";

  /* Matches a bundle prefix in the address: /s/<token>. The token is hex and
   * at least eight characters; the length is not pinned so a future rotation
   * to a longer one keeps working. */
  const BUNDLE = /^\/s\/([0-9a-f]{8,})(?=\/|$)/;

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((s) => s && s.token) : [];
    } catch {
      return [];
    }
  }

  function save(list) {
    try {
      localStorage.setItem(STORE, JSON.stringify(list));
    } catch {
      /* private mode, or a full quota. Not worth breaking the page over. */
    }
  }

  function forget(token) {
    save(load().filter((server) => server.token !== token));
  }

  /* Record the dossier being read. Called on every page inside one, so a
   * server that gets renamed updates its own entry on the next visit. */
  function remember(token, name) {
    const list = load();
    const existing = list.find((server) => server.token === token);

    if (existing) {
      if (name) existing.name = name;
      existing.seen = Date.now();
    } else {
      list.push({ token, name: name || "A server", seen: Date.now() });
    }

    list.sort((a, b) => (b.seen || 0) - (a.seen || 0));
    save(list);
    return list;
  }

  // -- rendering ---------------------------------------------------------

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function render(list, currentToken) {
    const box = document.getElementById("servers");
    if (!box) return;

    box.textContent = "";
    if (!list.length) return;

    const others = list.filter((server) => server.token !== currentToken);

    /* One server, and you are already in it: there is nowhere to switch to,
     * so say nothing rather than render a menu of one. */
    if (currentToken && !others.length) return;

    /* One server, and you are not in it — the common case on the public root.
     * A plain link is friendlier than a menu. */
    if (!currentToken && list.length === 1) {
      const link = element("a", "server-jump");
      link.href = `/s/${list[0].token}/`;
      link.textContent = list[0].name;
      link.title = "Open the dossier you last read";
      box.append(element("span", "server-label", "YOUR SERVER"), link);
      return;
    }

    const wrap = element("div", "server-switch");
    const button = element("button", "server-current");
    button.type = "button";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");

    const here = list.find((server) => server.token === currentToken);
    button.textContent = here ? here.name : "Your servers";
    button.append(element("i", "caret"));

    const menu = element("div", "server-menu");
    menu.hidden = true;

    for (const server of list) {
      const row = element("a", "server-option");
      row.href = `/s/${server.token}/`;
      row.textContent = server.name;
      if (server.token === currentToken) {
        row.classList.add("on");
        row.setAttribute("aria-current", "true");
      }

      /* Somewhere to drop a server you no longer want remembered — the list is
       * the reader's, so they get to edit it. */
      const drop = element("button", "server-forget", "×");
      drop.type = "button";
      drop.title = `Forget ${server.name} on this device`;
      drop.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        forget(server.token);
        render(load(), currentToken);
      });

      const line = element("div", "server-line");
      line.append(row, drop);
      menu.append(line);
    }

    const note = element(
      "p",
      "server-note",
      "Remembered on this device only. Open a server's link to add it."
    );
    menu.append(note);

    function close() {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    menu.addEventListener("click", (event) => event.stopPropagation());

    wrap.append(button, menu);
    box.append(wrap);
  }

  // -- boot --------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    const match = location.pathname.match(BUNDLE);
    const token = match ? match[1] : null;

    let list = load();
    if (token) {
      list = remember(token, (document.body.dataset.server || "").trim());
    }

    render(list, token);
  });
})();
