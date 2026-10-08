/* Discord sign-in on a static site.
 *
 * I previously said this was impossible without a server, because the standard
 * OAuth flow exchanges a code for a token using a client *secret*, and a secret
 * in a static page isn't a secret. That was wrong about the options: Discord
 * also supports the implicit grant, where the token comes straight back to the
 * browser in the URL fragment and no secret is involved at all.
 *
 * What that buys, given there's still no server: the page can prove who you are
 * and personalise itself. It cannot save anything — writes still belong to the
 * bot in Discord.
 *
 * The token is the visitor's own, scoped to `identify` (their id, name and
 * avatar — nothing else, no email, no servers, no messages). It is used once to
 * ask Discord who they are and then discarded; only the resulting id is kept.
 *
 * Profile lookup uses a SHA-256 of the Discord id rather than the id itself, so
 * the published site never contains a list of everyone's account ids.
 */

(() => {
  "use strict";

  const STORE = "joshcore-identity";
  const CLIENT_ID = window.JOSHCORE_CLIENT_ID || "";
  const DISCORD_API = "https://discord.com/api/v10";

  // -- stored identity ---------------------------------------------------

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function save(identity) {
    try { localStorage.setItem(STORE, JSON.stringify(identity)); } catch { /* private mode */ }
  }

  function forget() {
    try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  }

  // -- hashing -----------------------------------------------------------

  async function hashId(id) {
    const bytes = new TextEncoder().encode("joshcore:" + id);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }

  // -- sign in / out -----------------------------------------------------

  function signIn() {
    if (!CLIENT_ID) return;
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem("joshcore-oauth-state", state);

    /* Discord matches the redirect URI as a literal string, so every page has
     * to send the same one — the site root. Remember where we actually were so
     * the visitor comes back to it instead of being dumped on the homepage. */
    sessionStorage.setItem("joshcore-return-to", location.pathname + location.search);

    const parameters = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: location.origin + "/",
      response_type: "token",
      scope: "identify",
      state,
    });
    location.href = "https://discord.com/oauth2/authorize?" + parameters;
  }

  function signOut() {
    forget();
    location.reload();
  }

  /* Discord returns the token in the fragment, which never reaches a server —
   * that's the whole point of the implicit flow. Read it, use it once, and
   * scrub it from the address bar so it isn't left in history or copied into a
   * shared link. */
  /* Discord reports failures in the query string, not the fragment. Without
   * this a misconfigured redirect URI just bounces you back to a normal-looking
   * page with no hint that anything went wrong. */
  function reportError() {
    const query = new URLSearchParams(location.search);
    const error = query.get("error");
    if (!error) return false;

    const description = query.get("error_description") || "";
    history.replaceState(null, "", location.pathname);

    const box = document.getElementById("session");
    if (box) {
      box.innerHTML = '<span style="color:#ed4245">sign-in failed</span>';
    }

    const banner = document.createElement("div");
    banner.className = "card";
    banner.style.cssText = "margin:0 0 24px;border-color:#ed4245";
    banner.innerHTML =
      '<strong style="color:#ed4245">Discord refused the sign-in.</strong>' +
      `<p class="small dim" style="margin:8px 0 0">${error}${description ? " — " + description : ""}</p>` +
      '<p class="tiny faint" style="margin:8px 0 0">If this says the redirect URI is invalid, ' +
      `<code>${location.origin}/</code> needs adding to the app's OAuth2 redirects.</p>`;
    document.querySelector("main")?.prepend(banner);
    return true;
  }

  async function consumeRedirect() {
    if (!location.hash.includes("access_token=")) return false;

    const fragment = new URLSearchParams(location.hash.slice(1));
    const token = fragment.get("access_token");
    const state = fragment.get("state");
    const expected = sessionStorage.getItem("joshcore-oauth-state");

    history.replaceState(null, "", location.pathname + location.search);
    sessionStorage.removeItem("joshcore-oauth-state");

    if (!token || !state || state !== expected) return false;

    try {
      const response = await fetch(DISCORD_API + "/users/@me", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) return false;
      const user = await response.json();

      save({
        id: user.id,
        hash: await hashId(user.id),
        name: user.global_name || user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
          : null,
      });
      return true;
    } catch {
      return false;
    }
  }

  // -- personalisation ---------------------------------------------------

  /* The prefix this page is published under: "" at the public root,
   * "/s/<token>" inside one server's bundle. Every link and fetch below goes
   * through it, so a signed-in browser only ever looks inside the bundle it is
   * already reading — the directory in the next one is not addressable from
   * here, and there is no list of the others to find.
   *
   * The address is consulted before the template's own value because a static
   * host serves one 404 page for every missing path, built at the root: on a
   * mistyped URL inside a dossier, `data-root` says "" while the path still
   * says which bundle the reader was in. */
  const ROOT =
    (location.pathname.match(/^\/s\/[0-9a-f]{8,}(?=\/)/) || [])[0] ||
    document.body.dataset.root ||
    "";

  /* Returns null — not an empty object — when there is no directory to search.
   * The public root deliberately publishes none, and "this page cannot look
   * you up" is a different thing from "you are not in this server". Telling a
   * signed-in person they have no file when the page simply never had a list
   * is just wrong. */
  async function directory() {
    try {
      const response = await fetch(`${ROOT}/people.json`, { cache: "no-cache" });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  function renderSession(identity, slug, searchable) {
    const box = document.getElementById("session");
    if (!box) return;

    if (!identity) {
      box.innerHTML = CLIENT_ID
        ? '<a href="#" id="signInLink">sign in with Discord</a>'
        : "";
      const link = document.getElementById("signInLink");
      if (link) link.addEventListener("click", (e) => { e.preventDefault(); signIn(); });
      return;
    }

    /* Three different situations, and they must not be collapsed into one
     * message. Your file is here; you are signed in but this server has no
     * file on you; or this page has no directory at all, which is the public
     * root, where nobody has a file because nothing about anybody is
     * published there. */
    let mine;
    if (slug) {
      mine = `<a href="${ROOT}/u/${slug}">your file</a>`;
    } else if (searchable) {
      mine = "no file here";
    } else {
      mine = `<span title="Your file lives in your server's own dossier. Ask Blackbox for the link with ~site.">signed in</span>`;
    }

    box.innerHTML = `${mine} · <a href="#" id="signOutLink">sign out</a>`;
    document.getElementById("signOutLink")
      .addEventListener("click", (e) => { e.preventDefault(); signOut(); });
  }

  /* Highlight the signed-in person wherever they appear, and reveal which of the
   * hidden titles are actually theirs. */
  function markUp(slug) {
    if (!slug) return;

    for (const row of document.querySelectorAll(".row")) {
      const link = row.querySelector(`a[href="${ROOT}/u/${slug}"]`);
      if (link) {
        row.classList.add("is-you");
        if (!row.querySelector(".you-tag")) {
          const tag = document.createElement("span");
          tag.className = "you-tag";
          tag.textContent = "YOU";
          link.after(tag);
        }
      }
    }

    if (location.pathname.startsWith(`${ROOT}/u/${slug}`)) {
      document.body.classList.add("own-file");
    }
  }

  // -- boot --------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", async () => {
    if (reportError()) return;

    const arrived = await consumeRedirect();

    if (arrived) {
      const back = sessionStorage.getItem("joshcore-return-to");
      sessionStorage.removeItem("joshcore-return-to");
      if (back && back !== location.pathname && back.startsWith("/")) {
        location.replace(back);
        return;
      }
    }

    const identity = load();
    let slug = null;
    let people = null;

    if (identity) {
      people = await directory();
      slug = people ? people[identity.hash] || null : null;
    }

    renderSession(identity, slug, people !== null);
    markUp(slug);
  });
})();
