
// app.js — SPA Web Player using Authorization Code with PKCE

const SCOPES = [
  "user-read-email",
  "user-read-private",
  "streaming",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative"
];

const TOKEN_KEY = "spotminiAuth";

// ---------- UI helpers ----------
const $ = (s) => document.querySelector(s);
const statusBox = $("#statusBox");
const loginBtn = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
const playlistList = $("#playlistList");
const nowPlaying = $("#nowPlaying");
const controls = $("#controls");
const cover = $("#cover");
const trackName = $("#trackName");
const artistName = $("#artistName");
const playPauseBtn = $("#playPauseBtn");
const nextBtn = $("#nextBtn");
const prevBtn = $("#prevBtn");
const volume = $("#volume");

function setStatus(s) {
  statusBox.textContent = s;
}

function showAuthUI(isAuthed) {
  loginBtn.style.display = isAuthed ? "none" : "inline-flex";
  logoutBtn.style.display = isAuthed ? "inline-flex" : "none";
  $("#playlists").classList.toggle("hidden", !isAuthed);
  controls.classList.toggle("hidden", !isAuthed);
  nowPlaying.classList.toggle("hidden", !isAuthed);
}

// ---------- PKCE helpers ----------
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPKCE() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  const verifier = Array.from(array).map(b => ("0" + b.toString(16)).slice(-2)).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(digest);
  return { verifier, challenge };
}

function getRedirectURI() {
  // exact URL of this page (origin + path). Add it to Spotify Dashboard
  return window.location.origin + window.location.pathname;
}

function saveAuth(auth) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(auth));
}

function loadAuth() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); }
  catch { return null; }
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
}

// ---------- OAuth ----------
async function login() {
  if (!CLIENT_ID) { setStatus("Missing CLIENT_ID"); return; }
  const { verifier, challenge } = await createPKCE();
  const redirect_uri = getRedirectURI();
  sessionStorage.setItem("pkce_verifier", verifier);
  sessionStorage.setItem("redirect_uri", redirect_uri);

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirect_uri);
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("show_dialog", "true");

  window.location.assign(authUrl.toString());
}

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem("pkce_verifier");
  const redirect_uri = sessionStorage.getItem("redirect_uri") || getRedirectURI();
  const body = new URLSearchParams();
  body.set("client_id", CLIENT_ID);
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirect_uri);
  body.set("code_verifier", verifier);

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Token exchange failed: " + t);
  }
  const data = await res.json();
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  const auth = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    scope: data.scope
  };
  saveAuth(auth);
  // clean URL
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());
}

async function refreshTokenIfNeeded() {
  const auth = loadAuth();
  if (!auth) return null;
  if (Date.now() < (auth.expires_at || 0)) return auth.access_token;

  const body = new URLSearchParams();
  body.set("client_id", CLIENT_ID);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", auth.refresh_token);

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    clearAuth();
    return null;
  }
  const data = await res.json();
  const newAuth = {
    access_token: data.access_token,
    refresh_token: auth.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
    scope: data.scope || auth.scope
  };
  saveAuth(newAuth);
  return newAuth.access_token;
}

async function getAccessToken() {
  const auth = loadAuth();
  if (!auth) return null;
  if (Date.now() >= (auth.expires_at || 0)) return await refreshTokenIfNeeded();
  return auth.access_token;
}

// ---------- Spotify Web API helpers ----------
async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authorized");
  const url = path.startsWith("http") ? path : ("https://api.spotify.com/v1" + path);
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function getPlaylists(limit = 50) {
  return apiFetch(`/me/playlists?limit=${limit}`);
}

async function transferPlayback(deviceId, play = true) {
  return apiFetch("/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [deviceId], play })
  });
}

async function playContext(contextUri, deviceId) {
  const q = new URLSearchParams({ device_id: deviceId });
  return apiFetch(`/me/player/play?${q.toString()}`, {
    method: "PUT",
    body: JSON.stringify({ context_uri: contextUri })
  });
}

// ---------- Player (Web Playback SDK) ----------
let player = null;
let deviceId = null;

function onPlayerStateChanged(state) {
  if (!state || !state.track_window?.current_track) return;
  const t = state.track_window.current_track;
  cover.src = t.album?.images?.[0]?.url || "";
  trackName.textContent = t.name || "—";
  artistName.textContent = (t.artists || []).map(a => a.name).join(", ");
  playPauseBtn.textContent = state.paused ? "▶" : "⏸";
}

async function initPlayer() {
  return new Promise((resolve, reject) => {
    if (!window.Spotify) {
      reject(new Error("Spotify SDK not loaded."));
      return;
    }
    player = new Spotify.Player({
      name: "SpotMini Web Player",
      getOAuthToken: async (cb) => {
        const token = await getAccessToken();
        cb(token || "");
      },
      volume: Number(volume.value) / 100
    });

    player.addListener("ready", ({ device_id }) => {
      deviceId = device_id;
      setStatus("Device ready");
      transferPlayback(deviceId, true).catch(() => {});
      resolve();
    });

    player.addListener("not_ready", ({ device_id }) => {
      if (deviceId === device_id) deviceId = null;
      setStatus("Device not ready");
    });

    player.addListener("initialization_error", ({ message }) => setStatus("Init error: " + message));
    player.addListener("authentication_error", ({ message }) => setStatus("Auth error: " + message + " (Spotify Premium required for playback)"));
    player.addListener("account_error", ({ message }) => setStatus("Account error: " + message));
    player.addListener("player_state_changed", onPlayerStateChanged);

    player.connect().then((ok) => {
      if (!ok) reject(new Error("Failed to connect Web Playback SDK."));
    });
  });
}

function renderPlaylists(items) {
  playlistList.innerHTML = "";
  if (!items.length) {
    playlistList.innerHTML = "<li>No playlists found.</li>";
    return;
  }
  for (const pl of items) {
    const li = document.createElement("li");
    li.className = "playlist-item";
    const img = document.createElement("img");
    img.alt = "playlist cover";
    img.src = pl.images?.[0]?.url || "";
    const title = document.createElement("span");
    title.textContent = pl.name;
    li.appendChild(img);
    li.appendChild(title);
    li.addEventListener("click", () => startPlaylist(pl.uri));
    playlistList.appendChild(li);
  }
}

async function startPlaylist(contextUri) {
  if (!deviceId) {
    setStatus("Player not ready yet.");
    return;
  }
  setStatus("Starting playback...");
  try {
    await playContext(contextUri, deviceId);
    setStatus("Playing.");
  } catch (e) {
    setStatus("Playback error: " + e.message);
  }
}

// Controls
playPauseBtn.addEventListener("click", () => player?.togglePlay());
nextBtn.addEventListener("click", () => player?.nextTrack());
prevBtn.addEventListener("click", () => player?.previousTrack());
volume.addEventListener("input", (e) => player?.setVolume(Number(e.target.value) / 100));

loginBtn.addEventListener("click", login);
logoutBtn.addEventListener("click", () => { clearAuth(); window.location.reload(); });

// ---------- Bootstrap ----------
async function bootstrap() {
  // Handle auth redirect
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (code) {
    setStatus("Exchanging code for token...");
    try {
      await exchangeCodeForToken(code);
    } catch (e) {
      setStatus(e.message);
      return;
    }
  }

  const token = await getAccessToken();
  const isAuthed = !!token;
  showAuthUI(isAuthed);
  if (!isAuthed) {
    setStatus("Not authorized. Click Log in.");
    return;
  }
  setStatus("Loading Spotify SDK...");
  // Wait for SDK to be ready
  let attempts = 0;
  const int = setInterval(() => {
    if (window.Spotify) {
      clearInterval(int);
      initPlayer().then(async () => {
        const pls = await getPlaylists();
        renderPlaylists(pls.items || []);
      }).catch((e) => setStatus(e.message));
    } else if (++attempts > 60) {
      clearInterval(int);
      setStatus("SDK failed to load.");
    }
  }, 100);
}

bootstrap();
