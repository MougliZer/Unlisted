// Unlisted : API serveur (Netlify Function)
// Gère la connexion OAuth 1.0a avec Discogs. Le Consumer Secret ne quitte jamais le serveur.
//
// Variables d'environnement à définir dans Netlify :
//   DISCOGS_KEY      (Consumer Key de l'application Discogs)
//   DISCOGS_SECRET   (Consumer Secret de l'application Discogs)
//   SESSION_SECRET   (longue chaîne aléatoire, sert à chiffrer le cookie de session)

import crypto from "node:crypto";

const UA = "Unlisted/0.1";
const SESSION = "unlisted_session";
const PENDING = "unlisted_pending";
const DISCOGS = "https://api.discogs.com";

// ---------- Utilitaires de réponse ----------

function reponse(status, { body, location, cookies = [] } = {}) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (location) headers.set("Location", location);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  cookies.forEach((c) => headers.append("Set-Cookie", c));
  return new Response(body !== undefined ? JSON.stringify(body) : null, { status, headers });
}

const json = (data, status = 200, cookies = []) => reponse(status, { body: data, cookies });
const redirect = (location, cookies = []) => reponse(302, { location, cookies });

// ---------- Cookies chiffrés (AES-256-GCM) ----------

function cle() {
  return crypto.createHash("sha256").update(process.env.SESSION_SECRET || "").digest();
}

function sceller(objet) {
  const iv = crypto.randomBytes(12);
  const chiffre = crypto.createCipheriv("aes-256-gcm", cle(), iv);
  const enc = Buffer.concat([chiffre.update(JSON.stringify(objet), "utf8"), chiffre.final()]);
  return Buffer.concat([iv, chiffre.getAuthTag(), enc]).toString("base64url");
}

function ouvrir(texte) {
  try {
    const buf = Buffer.from(texte, "base64url");
    const dechiffre = crypto.createDecipheriv("aes-256-gcm", cle(), buf.subarray(0, 12));
    dechiffre.setAuthTag(buf.subarray(12, 28));
    const clair = Buffer.concat([dechiffre.update(buf.subarray(28)), dechiffre.final()]);
    return JSON.parse(clair.toString("utf8"));
  } catch (e) {
    return null;
  }
}

function lireCookie(req, nom) {
  const brut = req.headers.get("cookie") || "";
  for (const morceau of brut.split(/;\s*/)) {
    const i = morceau.indexOf("=");
    if (i > 0 && morceau.slice(0, i) === nom) return morceau.slice(i + 1);
  }
  return null;
}

const poserCookie = (nom, valeur, duree) =>
  `${nom}=${valeur}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${duree}`;
const effacerCookie = (nom) => poserCookie(nom, "", 0);

// ---------- OAuth 1.0a (signature PLAINTEXT, acceptée par Discogs en HTTPS) ----------

function enteteOAuth(params, secretJeton = "") {
  const p = {
    oauth_consumer_key: process.env.DISCOGS_KEY,
    oauth_nonce: crypto.randomBytes(8).toString("hex"),
    oauth_signature_method: "PLAINTEXT",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_signature: `${process.env.DISCOGS_SECRET}&${secretJeton}`,
    ...params,
  };
  return "OAuth " + Object.entries(p).map(([k, v]) => `${k}="${encodeURIComponent(v)}"`).join(", ");
}

function appelerDiscogs(chemin, session) {
  return fetch(`${DISCOGS}${chemin}`, {
    headers: {
      Authorization: enteteOAuth({ oauth_token: session.token }, session.secret),
      "User-Agent": UA,
      Accept: "application/vnd.discogs.v2.discogs+json",
    },
  });
}

function sessionDepuis(req) {
  const texte = lireCookie(req, SESSION);
  const s = texte ? ouvrir(texte) : null;
  return s && s.token && s.secret && s.username ? s : null;
}

// ---------- Routes ----------

// 1. L'utilisateur clique sur « Se connecter avec Discogs »
async function authStart(req, url) {
  const callback = `${url.origin}/api/auth-callback`;
  const res = await fetch(`${DISCOGS}/oauth/request_token`, {
    method: "POST",
    headers: {
      Authorization: enteteOAuth({ oauth_callback: callback }),
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  if (!res.ok) return redirect("/?erreur=connexion");
  const p = new URLSearchParams(await res.text());
  const token = p.get("oauth_token");
  const secret = p.get("oauth_token_secret");
  if (!token || !secret) return redirect("/?erreur=connexion");
  return redirect(
    `https://www.discogs.com/oauth/authorize?oauth_token=${encodeURIComponent(token)}`,
    [poserCookie(PENDING, sceller({ token, secret }), 600)]
  );
}

// 2. Discogs renvoie l'utilisateur ici après autorisation
async function authCallback(req, url) {
  const token = url.searchParams.get("oauth_token");
  const verifier = url.searchParams.get("oauth_verifier");
  const texte = lireCookie(req, PENDING);
  const attente = texte ? ouvrir(texte) : null;

  if (!token || !verifier || !attente || attente.token !== token) {
    return redirect("/?erreur=connexion", [effacerCookie(PENDING)]);
  }

  const res = await fetch(`${DISCOGS}/oauth/access_token`, {
    method: "POST",
    headers: {
      Authorization: enteteOAuth({ oauth_token: token, oauth_verifier: verifier }, attente.secret),
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  if (!res.ok) return redirect("/?erreur=connexion", [effacerCookie(PENDING)]);

  const p = new URLSearchParams(await res.text());
  const session = { token: p.get("oauth_token"), secret: p.get("oauth_token_secret") };
  if (!session.token || !session.secret) return redirect("/?erreur=connexion", [effacerCookie(PENDING)]);

  const identite = await appelerDiscogs("/oauth/identity", session);
  if (!identite.ok) return redirect("/?erreur=connexion", [effacerCookie(PENDING)]);
  const { username } = await identite.json();

  return redirect("/?connecte=1", [
    poserCookie(SESSION, sceller({ ...session, username }), 60 * 60 * 24 * 30),
    effacerCookie(PENDING),
  ]);
}

// 3. Qui est connecté ?
function me(req) {
  const s = sessionDepuis(req);
  if (!s) return json({ error: "non_connecte" }, 401);
  return json({ username: s.username });
}

// 4. Recherche d'un vinyle par code-barres ou numéro de catalogue
async function recherche(req, url) {
  const s = sessionDepuis(req);
  if (!s) return json({ error: "non_connecte" }, 401);

  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ results: [] });

  const sansEspaces = q.replace(/[\s-]/g, "");
  const estCodeBarre = /^\d{8,14}$/.test(sansEspaces);
  const qs = new URLSearchParams({
    type: "release",
    format: "vinyl",
    per_page: "25",
    [estCodeBarre ? "barcode" : "catno"]: estCodeBarre ? sansEspaces : q,
  });

  const res = await appelerDiscogs(`/database/search?${qs}`, s);
  if (res.status === 401) return json({ error: "non_connecte" }, 401, [effacerCookie(SESSION)]);
  if (res.status === 429) return json({ error: "limite" }, 429);
  if (!res.ok) return json({ error: "discogs" }, 502);

  const d = await res.json();
  return json({
    results: (d.results || []).map((r) => ({
      id: r.id,
      title: r.title,
      year: r.year || "",
      country: r.country || "",
      label: (r.label || [])[0] || "",
      catno: r.catno || "",
      thumb: r.thumb || "",
    })),
  });
}

// 5. Import de la collection Discogs, 100 disques par page
async function collection(req, url) {
  const s = sessionDepuis(req);
  if (!s) return json({ error: "non_connecte" }, 401);

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const chemin = `/users/${encodeURIComponent(s.username)}/collection/folders/0/releases`
    + `?page=${page}&per_page=100&sort=added&sort_order=desc`;

  const res = await appelerDiscogs(chemin, s);
  if (res.status === 401) return json({ error: "non_connecte" }, 401, [effacerCookie(SESSION)]);
  if (res.status === 429) return json({ error: "limite" }, 429);
  if (!res.ok) return json({ error: "discogs" }, 502);

  const d = await res.json();
  const nettoyer = (nom) => String(nom || "").replace(/\s\(\d+\)$/, "");
  return json({
    page: d.pagination.page,
    pages: d.pagination.pages,
    total: d.pagination.items,
    releases: (d.releases || []).map((r) => {
      const b = r.basic_information || {};
      const label = (b.labels || [])[0] || {};
      return {
        id: b.id,
        title: `${(b.artists || []).map((a) => nettoyer(a.name)).join(", ")} - ${b.title}`,
        year: b.year || "",
        label: nettoyer(label.name),
        catno: label.catno || "",
        thumb: b.thumb || b.cover_image || "",
        vinyl: (b.formats || []).some((f) => f.name === "Vinyl"),
      };
    }),
  });
}

function logout() {
  return json({ ok: true }, 200, [effacerCookie(SESSION), effacerCookie(PENDING)]);
}

// ---------- Routeur ----------

export default async (req) => {
  if (!process.env.DISCOGS_KEY || !process.env.DISCOGS_SECRET || !process.env.SESSION_SECRET) {
    return json({ error: "config" }, 500);
  }
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  try {
    switch (route) {
      case "auth-start": return await authStart(req, url);
      case "auth-callback": return await authCallback(req, url);
      case "me": return me(req);
      case "search": return await recherche(req, url);
      case "collection": return await collection(req, url);
      case "logout": return logout();
      default: return json({ error: "introuvable" }, 404);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "serveur" }, 500);
  }
};

export const config = { path: "/api/*" };
