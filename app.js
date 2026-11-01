(() => {
"use strict";
const ICON = { play: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path transform="translate(-1.5 0)" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`, pause: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>`, spin: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8" opacity=".25"/><path d="M12 4a8 8 0 0 1 8 8"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite"/></path></svg>` };
// Splits text into speakable chunks: [{ i, para, text }].
const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|No|Inc|Ltd|Co|e\.g|i\.e)|\b[A-Z])\.["')\]]*$/;

function splitLong(s, max) {
  const out = [];
  while (s.length > max) {
    let cut = Math.max(s.lastIndexOf(", ", max), s.lastIndexOf("; ", max), s.lastIndexOf(": ", max));
    if (cut < max * 0.4) cut = s.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(s.slice(0, cut + 1).trim());
    s = s.slice(cut + 1).trim();
  }
  if (s) out.push(s);
  return out;
}

function chunkText(text, { maxChars = 300, minChars = 40 } = {}) {
  const chunks = [];
  let para = -1;
  for (const raw of text.split(/\n\s*\n/)) {
    const p = raw.replace(/\s+/g, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(p)) continue;
    para++;
    const sents = [];
    for (const s of p.split(/(?<=[.!?]["'”’)\]]*)\s+/)) {
      if (sents.length && ABBR.test(sents[sents.length - 1])) sents[sents.length - 1] += " " + s;
      else sents.push(s);
    }
    const merged = [];
    let buf = "";
    for (const s of sents) {
      buf = buf ? buf + " " + s : s;
      if (buf.length >= minChars) { merged.push(buf); buf = ""; }
    }
    if (buf) merged.length ? (merged[merged.length - 1] += " " + buf) : merged.push(buf);
    for (const m of merged) for (const piece of splitLong(m, maxChars)) {
      if (/[\p{L}\p{N}]/u.test(piece)) chunks.push({ i: chunks.length, para, text: piece });
    }
  }
  return chunks;
}

// Library lives in this browser (IndexedDB). Metadata and text are separate stores.
let opened = null;
function open() {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("lectern", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("docs", { keyPath: "id" }); req.result.createObjectStore("texts", { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}
async function run(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = work(...stores.map((s) => tx.objectStore(s)));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
async function listDocs() { return (await run(["docs"], "readonly", (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt); }
async function getDoc(id) {
  const [meta, body] = await Promise.all([run(["docs"], "readonly", (s) => s.get(id)), run(["texts"], "readonly", (s) => s.get(id))]);
  return meta && body ? { ...meta, text: body.text } : null;
}
const putDoc = (meta, text) => run(["docs", "texts"], "readwrite", (d, t) => { d.put(meta); t.put({ id: meta.id, text }); });
async function updateMeta(id, patch) {
  const meta = await run(["docs"], "readonly", (s) => s.get(id));
  if (!meta) return null;
  const next = { ...meta, ...patch };
  await run(["docs"], "readwrite", (s) => s.put(next));
  return next;
}
const deleteDoc = (id) => run(["docs", "texts"], "readwrite", (d, t) => { d.delete(id); t.delete(id); });

// Draws the document and moves the highlight. No audio logic here.
let spans = [], current = -1;
function renderReader(root, chunks) {
  root.textContent = ""; spans = new Array(chunks.length); current = -1;
  const frag = document.createDocumentFragment();
  let p = null, last = -1;
  for (const c of chunks) {
    if (c.para !== last) { p = document.createElement("p"); frag.appendChild(p); last = c.para; }
    else p.appendChild(document.createTextNode(" "));
    const s = document.createElement("span");
    s.className = "s"; s.dataset.i = c.i; s.textContent = c.text;
    p.appendChild(s); spans[c.i] = s;
  }
  root.appendChild(frag);
}
function chunkIndexFromEvent(e) { const s = e.target.closest?.(".s"); return s ? Number(s.dataset.i) : -1; }
function highlight(i, { scroller, follow, instant = false }) {
  if (current >= 0 && spans[current]) { spans[current].removeAttribute("aria-current"); spans[current].parentElement.classList.remove("live"); }
  current = i;
  const el = spans[i];
  if (!el) return;
  el.setAttribute("aria-current", "true"); el.parentElement.classList.add("live");
  if (!follow) return;
  const box = scroller.getBoundingClientRect(), r = el.getBoundingClientRect();
  const margin = Math.min(120, box.height * 0.2);
  if (instant || r.top < box.top + margin || r.bottom > box.bottom - margin) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: instant || reduce ? "auto" : "smooth" });
  }
}

// ---- Kokoro-82M running in the browser (kokoro-js / ONNX). Needs internet ONCE to download the model, then it's cached.
const KOKORO_JS = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICES = [
  { id: "af_heart", name: "Heart (US, female)" },
  { id: "af_alloy", name: "Alloy (US, female)" },
  { id: "af_aoede", name: "Aoede (US, female)" },
  { id: "af_bella", name: "Bella (US, female)" },
  { id: "af_jessica", name: "Jessica (US, female)" },
  { id: "af_kore", name: "Kore (US, female)" },
  { id: "af_nicole", name: "Nicole (US, female)" },
  { id: "af_nova", name: "Nova (US, female)" },
  { id: "af_river", name: "River (US, female)" },
  { id: "af_sarah", name: "Sarah (US, female)" },
  { id: "af_sky", name: "Sky (US, female)" },
  { id: "am_adam", name: "Adam (US, male)" },
  { id: "am_echo", name: "Echo (US, male)" },
  { id: "am_eric", name: "Eric (US, male)" },
  { id: "am_fenrir", name: "Fenrir (US, male)" },
  { id: "am_liam", name: "Liam (US, male)" },
  { id: "am_michael", name: "Michael (US, male)" },
  { id: "am_onyx", name: "Onyx (US, male)" },
  { id: "am_puck", name: "Puck (US, male)" },
  { id: "am_santa", name: "Santa (US, male)" },
  { id: "bf_alice", name: "Alice (UK, female)" },
  { id: "bf_emma", name: "Emma (UK, female)" },
  { id: "bf_isabella", name: "Isabella (UK, female)" },
  { id: "bf_lily", name: "Lily (UK, female)" },
  { id: "bm_daniel", name: "Daniel (UK, male)" },
  { id: "bm_fable", name: "Fable (UK, male)" },
  { id: "bm_george", name: "George (UK, male)" },
  { id: "bm_lewis", name: "Lewis (UK, male)" },
];
let kokoro = null, loading = null, chain = Promise.resolve();

function setStatus(msg) { const s = document.getElementById("status"); s.textContent = msg || ""; s.hidden = !msg; }

function ready() {
  loading ??= (async () => {
    const files = {};
    const progress = (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = { l: p.loaded, t: p.total };
        const l = Object.values(files).reduce((a, f) => a + f.l, 0), t = Object.values(files).reduce((a, f) => a + f.t, 0);
        setStatus(`Downloading voice model… ${Math.round((100 * l) / t)}% (first time only)`);
      }
    };
    setStatus("Loading voice model…");
    const { KokoroTTS } = await import(KOKORO_JS);
    try {
      if (!navigator.gpu) throw new Error("no webgpu");
      kokoro = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "fp32", device: "webgpu", progress_callback: progress });
    } catch {
      kokoro = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm", progress_callback: progress });
    }
    setStatus("");
  })().catch((e) => { loading = null; setStatus(""); throw new Error("Couldn't load the voice model. It needs an internet connection the first time."); });
  return loading;
}

function synthRaw(text, voice, signal) {
  const abort = () => new DOMException("aborted", "AbortError");
  const job = chain.then(async () => {
    if (signal?.aborted) throw abort();
    await ready();
    if (signal?.aborted) throw abort();
    return kokoro.generate(text, { voice });
  });
  chain = job.catch(() => {});
  return job;
}

async function getVoices() { return { engine: "kokoro-js", default: "af_heart", voices: VOICES }; }
async function tts(text, voice, signal) { return (await synthRaw(text, voice, signal)).toBlob(); }
function warmUp() { return ready(); }

function wavBlob(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: "audio/wav" });
}

async function exportAudio(texts, voice) {
  const parts = []; let sr = 24000, total = 0;
  for (let i = 0; i < texts.length; i++) {
    setStatus(`Rendering audio… ${i + 1}/${texts.length}`);
    const r = await synthRaw(texts[i], voice); sr = r.sampling_rate; parts.push(r.audio, new Float32Array(sr * 0.25)); total += r.audio.length + sr * 0.25;
  }
  setStatus("");
  const all = new Float32Array(total); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return wavBlob(all, sr);
}

// ---- text cleanup + file extraction (all in the browser) ----
function cleanText(t) {
  t = t.replace(/\r\n?/g, "\n").replace(/\u00ad/g, "").replace(/\u00a0/g, " ");
  t = t.replace(/(\w)-\n(\w)/g, "$1$2").replace(/https?:\/\/\S+/g, "").replace(/\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "");
  t = t.split("\n").map((l) => l.trim()).filter((l) => !/^(page\s*)?\d{1,4}$/i.test(l)).join("\n");
  return t.replace(/(?<!\n)\n(?!\n)/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const loaded = {};
function loadScript(src) {
  return (loaded[src] ??= new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load a helper library (needs internet).")); document.head.appendChild(s); }));
}
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js";

async function pdfText(buf) {
  if (!window.pdfjsLib) {
    await loadScript(PDFJS);
    const code = await (await fetch(PDFJS_WORKER)).text(); // blob worker so it also works from file://
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  }
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const items = (await (await pdf.getPage(p)).getTextContent()).items;
    let lastY = null;
    for (const it of items) {
      if (!("str" in it)) continue;
      const y = it.transform[5];
      if (lastY !== null) { const gap = lastY - y; out += gap > (it.height || 10) * 1.8 ? "\n\n" : Math.abs(gap) > 2 ? "\n" : " "; }
      out += it.str; lastY = y;
    }
    out += "\n\n";
  }
  if (!out.trim()) throw new Error("That PDF has no selectable text (it may be a scan).");
  return out;
}

async function extractFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  let title = file.name.replace(/\.[^.]+$/, ""), text;
  if (ext === "pdf") text = await pdfText(await file.arrayBuffer());
  else if (ext === "docx") { await loadScript(MAMMOTH); text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
  else if (ext === "html" || ext === "htm") {
    const d = new DOMParser().parseFromString(await file.text(), "text/html");
    d.querySelectorAll("script,style,nav,footer,header,aside,form,noscript,svg").forEach((e) => e.remove());
    const root = d.querySelector("article,main") || d.body;
    text = [...root.querySelectorAll("h1,h2,h3,p,li,blockquote")].map((e) => e.textContent.trim()).filter(Boolean).join("\n\n");
    title = d.title || title;
  } else if (["txt", "md", "markdown", ""].includes(ext)) {
    text = await file.text();
    if (ext.startsWith("m")) text = text.replace(/^#+\s*/gm, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>]/g, "");
  } else throw new Error(`Unsupported file type: .${ext}`);
  text = cleanText(text);
  if (!text) throw new Error("No readable text found in that file.");
  return { title: title.trim() || "Untitled", text };
}

// Plays a document one chunk at a time. Chunks are fetched as small WAVs, prefetched
// ahead, and two <audio> elements alternate for near-gapless playback.
// Speed = playbackRate (pitch preserved). Events: "index", "state", "progress", "error", "finished".
const AHEAD = 4, MAX_INFLIGHT = 2;

function silentWavUrl() {
  const sr = 8000, n = 400, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

class Player extends EventTarget {
  #chunks = []; #cum = [0]; #index = 0; #voice = ""; #rate = 1;
  #els = [new Audio(), new Audio()]; #active = 0;
  #activeIndex = -1; #standbyIndex = -1;
  #cache = new Map(); #inflight = 0; #run = 0;
  #playing = false; #buffering = false; #cps = 15; #unlocked = false;

  constructor() {
    super();
    for (const el of this.#els) {
      el.preload = "auto"; el.preservesPitch = true;
      el.addEventListener("ended", () => this.#onEnded(el));
      el.addEventListener("timeupdate", () => { if (el === this.#el && el.duration) this.#emit("progress", { frac: el.currentTime / el.duration }); });
      el.addEventListener("loadedmetadata", () => {
        const c = this.#chunks[Number(el.dataset.idx)];
        if (c && el.duration > 0.3) this.#cps = 0.7 * this.#cps + 0.3 * (c.text.length / el.duration);
      });
      el.addEventListener("error", () => { if (el.getAttribute("src")) this.#fail(new Error("That audio couldn't be played.")); });
    }
  }
  get #el() { return this.#els[this.#active]; }
  get #standby() { return this.#els[this.#active ^ 1]; }
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  #emitState() { this.#emit("state", { playing: this.#playing, buffering: this.#buffering }); }

  get index() { return this.#index; }
  get length() { return this.#chunks.length; }
  get playing() { return this.#playing; }
  get rate() { return this.#rate; }
  get totalChars() { return this.#cum[this.#cum.length - 1]; }
  get cps() { return this.#cps; }
  charsBefore(i) { return this.#cum[Math.max(0, Math.min(i, this.#chunks.length))]; }

  unlock() {
    if (this.#unlocked) return; this.#unlocked = true;
    const url = silentWavUrl();
    for (const el of this.#els) {
      if (el.getAttribute("src")) continue;
      el.src = url;
      el.play().then(() => { el.pause(); el.removeAttribute("src"); }).catch(() => el.removeAttribute("src"));
    }
  }
  load(chunks, index = 0) {
    this.#run++; this.#halt(); this.#clearCache();
    this.#chunks = chunks; this.#cum = [0];
    for (const c of chunks) this.#cum.push(this.#cum[this.#cum.length - 1] + c.text.length);
    this.#index = Math.max(0, Math.min(index, chunks.length - 1));
    this.#playing = false; this.#buffering = false;
    this.#emit("index", { index: this.#index }); this.#emitState();
  }
  setVoice(voice) {
    if (voice === this.#voice) return;
    this.#voice = voice; this.#run++; this.#clearCache(); this.#halt();
    if (this.#playing) this.#startAt(this.#index);
  }
  setRate(rate) { this.#rate = rate; for (const el of this.#els) { el.playbackRate = rate; el.preservesPitch = true; } }
  async play() {
    if (!this.#chunks.length) return;
    this.#playing = true; this.#emitState();
    const el = this.#el;
    if (this.#activeIndex === this.#index && el.getAttribute("src") && el.paused && !el.ended) {
      try { await el.play(); } catch (err) { this.#blocked(err); }
      return;
    }
    await this.#startAt(this.#index);
  }
  pause() { this.#playing = false; this.#el.pause(); this.#emitState(); }
  toggle() { return this.#playing ? this.pause() : this.play(); }
  seek(i) {
    if (!this.#chunks.length) return;
    i = Math.max(0, Math.min(i, this.#chunks.length - 1));
    if (this.#playing) return this.#startAt(i);
    this.#run++; this.#halt(); this.#index = i; this.#emit("index", { index: i });
  }
  next() { return this.seek(this.#index + 1); }
  prev() {
    if (this.#playing && this.#activeIndex === this.#index && this.#el.currentTime > 2) return this.seek(this.#index);
    return this.seek(this.#index - 1);
  }

  #halt() { for (const el of this.#els) el.pause(); this.#activeIndex = -1; this.#standbyIndex = -1; }
  #fail(err) { this.#playing = false; this.#buffering = false; this.#halt(); this.#emitState(); this.#emit("error", { message: err.message }); }
  #blocked(err) {
    this.#playing = false; this.#buffering = false; this.#emitState();
    if (err?.name !== "NotAllowedError") this.#emit("error", { message: "Playback couldn't start." });
  }
  async #startAt(i) {
    const run = ++this.#run;
    this.#halt(); this.#index = i; this.#buffering = true;
    this.#emit("index", { index: i }); this.#emitState();
    let url;
    try { url = await this.#request(i); }
    catch (err) { if (run !== this.#run || err.name === "AbortError") return; return this.#fail(err); }
    if (run !== this.#run) return;
    const el = this.#el;
    el.dataset.idx = i; el.src = url; el.playbackRate = this.#rate;
    try { await el.play(); } catch (err) { if (run === this.#run) this.#blocked(err); return; }
    if (run !== this.#run) return;
    this.#activeIndex = i; this.#buffering = false; this.#emitState();
    this.#pump(); this.#preloadStandby(run);
  }
  async #preloadStandby(run) {
    const next = this.#index + 1;
    if (next >= this.#chunks.length) return;
    try {
      const url = await this.#request(next);
      if (run !== this.#run) return;
      const sb = this.#standby;
      sb.dataset.idx = next; sb.src = url; sb.playbackRate = this.#rate; sb.load();
      this.#standbyIndex = next;
    } catch {}
  }
  #onEnded(el) {
    if (el !== this.#el || !this.#playing) return;
    const next = this.#index + 1;
    if (next >= this.#chunks.length) {
      this.#playing = false; this.#emitState(); this.#emit("progress", { frac: 1 }); this.#emit("finished"); return;
    }
    if (this.#standbyIndex === next) {
      const run = ++this.#run;
      this.#active ^= 1; this.#index = next; this.#activeIndex = next; this.#standbyIndex = -1;
      this.#el.play().catch((err) => this.#blocked(err));
      this.#emit("index", { index: next }); this.#pump(); this.#preloadStandby(run);
    } else this.#startAt(next);
  }
  #request(i) {
    const key = `${this.#voice}|${i}`;
    let entry = this.#cache.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { i, url: null, controller, promise: null };
      this.#inflight++;
      entry.promise = tts(this.#chunks[i].text, this.#voice, controller.signal)
        .then((blob) => (entry.url = URL.createObjectURL(blob)))
        .catch((err) => { this.#cache.delete(key); throw err; })
        .finally(() => { this.#inflight--; this.#pump(); });
      this.#cache.set(key, entry);
    }
    return entry.promise;
  }
  #pump() {
    const last = Math.min(this.#chunks.length - 1, this.#index + AHEAD);
    for (let j = this.#index + 1; j <= last && this.#inflight < MAX_INFLIGHT; j++) this.#request(j).catch(() => {});
    for (const [key, e] of this.#cache) {
      if (e.i < this.#index - 2 || e.i > this.#index + AHEAD + 2) { e.controller.abort(); if (e.url) URL.revokeObjectURL(e.url); this.#cache.delete(key); }
    }
  }
  #clearCache() { for (const e of this.#cache.values()) { e.controller.abort(); if (e.url) URL.revokeObjectURL(e.url); } this.#cache.clear(); }
}


const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const player = new Player();
let doc = null, chunks = [], saveTimer = 0;
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
function toast(msg, ms = 4200) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.id); toast.id = setTimeout(() => (t.hidden = true), ms); }
const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const hue = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

// ---------- navigation ----------
const VIEWS = ["home", "library", "reader", "editor"];
function go(v) {
  if (v !== "reader") player.pause();
  VIEWS.forEach((n) => ($("#v-" + n).hidden = n !== v));
  $$(".navitem").forEach((b) => b.classList.toggle("on", b.dataset.view === (v === "home" ? "home" : "library")));
  if (v === "library") renderLibrary();
  if (v === "home") renderHome();
  $("#v-" + v).scrollTop = 0;
  closePops(); setPanel(false);
  if (innerWidth <= 820) setNav(false);
}
function setNav(open) { $("#app").classList.toggle("rail", !open); store.set("meraify.nav2", open ? "1" : "0"); }
$("#nav-close").onclick = () => setNav($("#app").classList.contains("rail"));
$("#nav-open").onclick = () => setNav(true);
$$(".navitem").forEach((b) => (b.onclick = () => go(b.dataset.view)));

// ---------- popovers ----------
function closePops() { $$(".menu-pop").forEach((p) => (p.hidden = true)); $$(".mbtn.on").forEach((b) => b.classList.remove("on")); }
document.addEventListener("click", (e) => { if (!e.target.closest(".pop-wrap, .menu")) closePops(); });
$("#add-btn").onclick = (e) => { e.stopPropagation(); const p = $("#add-menu"), o = p.hidden; closePops(); p.hidden = !o; };
$("#add-menu").onclick = (e) => {
  const a = e.target.closest("[data-act]")?.dataset.act; if (!a) return;
  closePops(); go("home");
  if (a === "upload") { setTab("upload"); $("#file").click(); }
  else if (a === "text") { setTab("text"); $("#q-text").focus(); }
  else { setTab("link"); $("#q-url").focus(); }
};

// ---------- adding content ----------
async function addDoc(title, text) {
  const n = chunkText(text).length;
  if (!n) throw new Error("There's no readable text in that.");
  const now = Date.now(), id = crypto.randomUUID();
  await putDoc({ id, title: title || text.slice(0, 40).replace(/\s+/g, " ") + "…", createdAt: now, updatedAt: now, pos: 0, total: n, chars: text.length }, text);
  return id;
}
async function importFiles(files) {
  files = [...files]; let last = null, ok = 0;
  for (let i = 0; i < files.length; i++) {
    setStatus(files.length > 1 ? `Adding ${i + 1}/${files.length}…` : "Reading file…");
    try { const r = await extractFile(files[i]); last = await addDoc(r.title, r.text); ok++; }
    catch (e) { toast(`${files[i].name}: ${e.message}`, 6000); }
  }
  setStatus("");
  if (ok === 1) openDoc(last); else if (ok > 1) go("library");
}
function setTab(t) {
  $$("#tabs button").forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  for (const n of ["upload", "text", "link"]) $("#tab-" + n).hidden = n !== t;
}
$$("#tabs button").forEach((b) => (b.onclick = () => { setTab(b.dataset.tab); if (b.dataset.tab === "text") $("#q-text").focus(); if (b.dataset.tab === "link") $("#q-url").focus(); }));
$("#up-btn").onclick = () => $("#file").click();
const qt = $("#q-text");
const upCount = () => { const w = (qt.value.match(/\S+/g) || []).length; $("#q-count").textContent = w ? `${w.toLocaleString()} words · about ${Math.max(1, Math.round(w / 150))} min` : ""; };
qt.addEventListener("input", upCount);
qt.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); $("#q-listen").click(); } });
$("#kbd").textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl ↵";
$("#lib-add").onclick = () => { go("home"); setTab("upload"); };
$("#file").onchange = (e) => { if (e.target.files.length) importFiles(e.target.files); e.target.value = ""; };
const dz = $("#dropzone");
for (const ev of ["dragenter", "dragover"]) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); });
dz.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

$("#q-listen").onclick = async () => {
  const raw = $("#q-text").value.trim();
  if (!raw) return toast("Paste or type something first.");
  try { const id = await addDoc($("#q-title").value.trim(), tidy ? cleanText(raw) : raw); $("#q-text").value = ""; $("#q-title").value = ""; upCount(); openDoc(id); } catch (e) { toast(e.message); }
};
$("#q-expand").onclick = () => { const t = $("#q-text").value, ti = $("#q-title").value; $("#q-text").value = ""; $("#q-title").value = ""; upCount(); openEditor(ti, t); };
async function importLink(url) {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  let res; try { res = await fetch("https://r.jina.ai/" + url, { headers: { Accept: "text/plain" } }); } catch { throw new Error("Couldn't reach the page reader. Check your connection."); }
  if (!res.ok) throw new Error(`Couldn't fetch that page (error ${res.status}).`);
  let t = await res.text();
  const title = (/^Title:\s*(.+)$/m.exec(t) || [])[1] || new URL(url).hostname;
  t = t.replace(/^(Title|URL Source|Published Time|Warning):.*$/gm, "").replace(/^Markdown Content:\s*/m, "")
       .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#+\s*/gm, "").replace(/[*_`>]/g, "");
  return addDoc(title.trim(), cleanText(t));
}
$("#q-url").onkeydown = (e) => { if (e.key === "Enter") $("#q-fetch").click(); };
$("#q-fetch").onclick = async () => {
  const url = $("#q-url").value.trim(), b = $("#q-fetch"), err = $("#q-err");
  if (!url) return;
  b.disabled = true; b.textContent = "Fetching…"; err.hidden = true;
  try { const id = await importLink(url); $("#q-url").value = ""; openDoc(id); } catch (e) { err.textContent = e.message; err.hidden = false; }
  b.disabled = false; b.textContent = "Fetch & listen";
};

// summary (extractive)
const STOP = new Set("the and but for with are was were been its this that have has had which you your they their them his her our from not will would can could than then there what when who how all any one also into more most such only other about over just very".split(" "));
function summarize(text) {
  const cs = chunkText(text, { maxChars: 420, minChars: 30 });
  if (cs.length <= 6) return text;
  const freq = {}, words = cs.map((c) => (c.text.toLowerCase().match(/[a-z']{3,}/g) || []).filter((w) => !STOP.has(w)));
  words.forEach((ws) => ws.forEach((w) => (freq[w] = (freq[w] || 0) + 1)));
  const scored = cs.map((c, i) => ({ i, s: words[i].reduce((a, w) => a + freq[w], 0) / Math.sqrt(words[i].length || 1) + (i === 0 ? 2 : 0) }));
  const n = Math.max(5, Math.min(14, Math.round(cs.length * 0.15)));
  return scored.sort((a, b) => b.s - a.s).slice(0, n).sort((a, b) => a.i - b.i).map((x) => cs[x.i].text).join("\n\n");
}
const sdlg = $("#sum-dlg");
$("#c-sum").onclick = async () => {
  const docs = await listDocs();
  if (!docs.length) return toast("Add a document to your library first.");
  const sel = $("#sum-pick"); sel.textContent = "";
  for (const d of docs) sel.add(new Option(d.title, d.id));
  sdlg.showModal();
};
$("#s-cancel").onclick = () => sdlg.close();
$("#s-ok").onclick = async () => {
  const d = await getDoc($("#sum-pick").value); if (!d) return;
  try { const id = await addDoc("Summary: " + d.title, summarize(d.text)); sdlg.close(); openDoc(id); } catch (e) { toast(e.message); }
};
$("#c-pod").onclick = () => toast("Podcasts need a language model to write the script, so this one isn't available yet.", 6000);
$("#c-quiz").onclick = () => toast("Quizzes need a language model to write the questions, so this one isn't available yet.", 6000);
$("#c-doc").onclick = () => openEditor();

// ---------- library + home ----------
const pctOf = (d) => (d.total ? Math.round((100 * (d.pos || 0)) / d.total) : 0);
const mins = (d) => Math.max(1, Math.round(d.chars / 900));
function bar(p) { const s = document.createElement("span"); s.className = "bar"; s.innerHTML = "<b></b>"; s.firstChild.style.width = p + "%"; return s; }
function ring(p) { const r = document.createElement("span"); r.className = "ring"; r.style.setProperty("--p", p); r.innerHTML = '<svg class="i"><use href="#i-play"/></svg>'; return r; }
const leftText = (d) => (pctOf(d) ? `${pctOf(d)}% · ${Math.max(1, Math.round(mins(d) * (1 - pctOf(d) / 100)))} min left` : `${mins(d)} min`);
async function renderLibrary() {
  const all = await listDocs(), q = $("#lib-search").value.trim().toLowerCase();
  const docs = q ? all.filter((d) => d.title.toLowerCase().includes(q)) : all, grid = $("#lib-grid"); grid.textContent = "";
  $("#lib-count").textContent = all.length ? `${all.length} ${all.length === 1 ? "item" : "items"}` : "";
  $("#lib-empty").hidden = all.length > 0;
  for (const d of docs) {
    const b = document.createElement("button"); b.className = "lcard glass";
    b.append(ring(pctOf(d)));
    const body = document.createElement("div"); body.className = "lbody"; body.innerHTML = "<b></b><small></small>";
    body.firstChild.textContent = d.title; body.lastChild.textContent = leftText(d); body.appendChild(bar(pctOf(d)));
    b.appendChild(body); b.onclick = () => openDoc(d.id); grid.appendChild(b);
  }
}
$("#lib-search").oninput = renderLibrary;
async function renderHome() {
  const docs = (await listDocs()).slice(0, 8), row = $("#recent"); row.textContent = "";
  $("#recent-wrap").hidden = !docs.length;
  for (const d of docs) {
    const b = document.createElement("button"); b.className = "rcard glass";
    b.append(ring(pctOf(d)));
    const body = document.createElement("div"); body.innerHTML = "<b></b><small></small>";
    body.firstChild.textContent = d.title; body.lastChild.textContent = leftText(d); body.appendChild(bar(pctOf(d)));
    b.appendChild(body); b.onclick = () => openDoc(d.id); row.appendChild(b);
  }
}

// ---------- reader ----------
const setP = (i) => $("#seek").style.setProperty("--p", Number($("#seek").max) > 0 ? (100 * i) / Number($("#seek").max) : 0);
async function openDoc(id) {
  player.pause();
  const d = await getDoc(id);
  if (!d) return;
  doc = d; chunks = chunkText(d.text);
  renderReader($("#reader"), chunks);
  go("reader");
  $("#r-title").textContent = d.title;
  const pos = Math.min(d.pos || 0, chunks.length - 1);
  player.load(chunks, pos);
  $("#seek").max = Math.max(0, chunks.length - 1); $("#seek").value = pos; setP(pos);
  $("#scroller").scrollTop = 0;
  highlight(pos, { scroller: $("#scroller"), follow: true, instant: true });
  updateTime();
}
function updateTime(frac = 0) {
  if (!doc) { $("#time").textContent = "0:00"; return; }
  const remaining = (player.totalChars - player.charsBefore(player.index) - frac * (chunks[player.index]?.text.length || 0)) / (player.cps * player.rate);
  $("#time").textContent = "-" + fmt(remaining);
}
player.addEventListener("index", (e) => {
  const i = e.detail.index;
  highlight(i, { scroller: $("#scroller"), follow: true });
  $("#seek").value = i; setP(i); updateTime();
  if (doc) { clearTimeout(saveTimer); saveTimer = setTimeout(() => updateMeta(doc.id, { pos: i, updatedAt: Date.now() }), 1500); }
});
player.addEventListener("state", (e) => {
  const { playing, buffering } = e.detail;
  $("#play").innerHTML = buffering ? ICON.spin : playing ? ICON.pause : ICON.play;
  $("#play").setAttribute("aria-label", playing ? "Pause" : "Play");
});
player.addEventListener("progress", (e) => updateTime(e.detail.frac));
player.addEventListener("error", (e) => toast(e.detail.message));
$("#play").innerHTML = ICON.play;
$("#play").onclick = () => { player.unlock(); player.toggle(); };
$("#next").onclick = () => player.next();
$("#prev").onclick = () => player.prev();
$("#seek").oninput = (e) => { setP(Number(e.target.value)); player.unlock(); player.seek(Number(e.target.value)); };
$("#reader").onclick = (e) => { const i = chunkIndexFromEvent(e); if (i >= 0) { player.unlock(); player.seek(i); if (!player.playing) player.play(); } };
$("#rate").onchange = (e) => { player.setRate(Number(e.target.value)); store.set("meraify.rate", e.target.value); updateTime(); };
$("#voice").onchange = (e) => { player.setVoice(e.target.value); store.set("meraify.voice", e.target.value); syncVoiceUI(); };
$("#r-back").onclick = () => go("library");
document.addEventListener("keydown", (e) => {
  if ($("#v-reader").hidden || e.target.closest("input,textarea,select,dialog,[contenteditable]")) return;
  if (e.code === "Space") { e.preventDefault(); player.unlock(); player.toggle(); }
  else if (e.code === "ArrowRight") player.next();
  else if (e.code === "ArrowLeft") player.prev();
});
$("#delete").onclick = async () => {
  if (!doc || !confirm(`Delete “${doc.title}”?`)) return;
  player.pause(); await deleteDoc(doc.id); doc = null; chunks = []; go("library");
};
$("#export").onclick = async () => {
  if (!doc) return;
  const btn = $("#export"); btn.disabled = true;
  try {
    const blob = await exportAudio(chunks.map((c) => c.text), $("#voice").value);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = doc.title.replace(/[^\w -]/g, "") + ".wav"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) { toast(err.message); }
  btn.disabled = false;
};

// ---------- voice panel ----------
const avatarBg = (id) => { const h = hue(id); return `radial-gradient(circle at 30% 25%, hsl(${h} 85% 78%), hsl(${(h + 45) % 360} 70% 52%) 70%)`; };
const vinfo = (v) => { const m = /^(.+?) \((.+)\)$/.exec(v.name); return { n: m ? m[1] : v.name, d: m ? m[2] : "" }; };
const GROUPS = { af: "American · Female", am: "American · Male", bf: "British · Female", bm: "British · Male" };
let previewAudio = null; const previewCache = new Map();
function renderVoices() {
  const box = $("#v-list"); box.textContent = "";
  const opts = [...$("#voice").options].map((o) => ({ id: o.value, name: o.text }));
  for (const g of Object.keys(GROUPS)) {
    const vs = opts.filter((v) => v.id.startsWith(g + "_")); if (!vs.length) continue;
    const h = document.createElement("h3"); h.textContent = GROUPS[g]; box.appendChild(h);
    const grid = document.createElement("div"); grid.className = "vgrid";
    for (const v of vs) {
      const { n, d } = vinfo(v);
      const tile = document.createElement("div"); tile.className = "vtile"; tile.dataset.id = v.id;
      const sel = document.createElement("button"); sel.className = "vsel"; sel.setAttribute("aria-label", `Use voice ${n}`);
      sel.innerHTML = '<span class="vav"></span><span class="vn"></span><span class="vd"></span>';
      sel.querySelector(".vav").style.background = avatarBg(v.id); sel.querySelector(".vav").textContent = n[0];
      sel.querySelector(".vn").textContent = n; sel.querySelector(".vd").textContent = d;
      sel.onclick = () => { $("#voice").value = v.id; $("#voice").dispatchEvent(new Event("change")); };
      const pv = document.createElement("button"); pv.className = "vprev"; pv.setAttribute("aria-label", `Preview ${n}`); pv.title = "Preview"; pv.innerHTML = ICON.play;
      pv.onclick = async () => {
        player.pause(); previewAudio?.pause(); pv.innerHTML = ICON.spin;
        try {
          let url = previewCache.get(v.id);
          if (!url) { url = URL.createObjectURL(await tts(`Hi, I'm ${n}. This is how I sound when I read to you.`, v.id)); previewCache.set(v.id, url); }
          previewAudio = new Audio(url); await previewAudio.play();
        } catch (e) { toast(e.message); }
        pv.innerHTML = ICON.play;
      };
      tile.append(sel, pv); grid.appendChild(tile);
    }
    box.appendChild(grid);
  }
  syncVoiceUI();
}
function syncVoiceUI() {
  const id = $("#voice").value, opt = $("#voice").selectedOptions[0]; if (!opt) return;
  $$(".vtile").forEach((t) => t.classList.toggle("on", t.dataset.id === id));
  $("#voice-name").textContent = vinfo({ name: opt.text }).n; $("#voice-dot").style.background = avatarBg(id);
}
function setPanel(open) { $("#voices").classList.toggle("open", open); $("#voice-toggle").setAttribute("aria-expanded", String(open)); }
$("#voice-toggle").onclick = () => setPanel(!$("#voices").classList.contains("open"));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setPanel(false); });
$("#v-close").onclick = () => setPanel(false);

// ---------- editor ----------
const ed = $("#editor");
let tidy = store.get("meraify.tidy", "1") === "1", edSize = 20;
const cmd = (c, v) => { ed.focus(); document.execCommand(c, false, v); syncTools(); };
const esc = (s) => s.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[m]);
function openEditor(title = "", text = "") {
  $("#e-title").value = title;
  ed.innerHTML = text ? text.split(/\n{2,}/).map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("") : "";
  go("editor"); updateStat(); ed.focus();
}
function updateStat() { const w = (ed.innerText.trim().match(/\S+/g) || []).length; $("#e-stat").textContent = w ? `${w.toLocaleString()} words · ~${Math.max(1, Math.round(w / 150))} min listen` : "0 words"; }
ed.addEventListener("input", updateStat);
function closeEditor() { if (ed.innerText.trim() && !confirm("Discard this document?")) return; go("home"); }
async function listen() {
  const text = ed.innerText.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return toast("Write or paste something first.");
  try { const id = await addDoc($("#e-title").value.trim(), tidy ? cleanText(text) : text); openDoc(id); } catch (e) { toast(e.message); }
}
$("#e-listen").onclick = listen; $("#e-close").onclick = closeEditor;
$("#e-share").onclick = async () => { try { await navigator.clipboard.writeText(ed.innerText); toast("Text copied to clipboard."); } catch { toast("Couldn't copy. Select the text and copy it manually."); } };
$("#toolbar").addEventListener("mousedown", (e) => { if (!e.target.closest("select")) e.preventDefault(); });
$("#toolbar").addEventListener("click", (e) => {
  const c = e.target.closest("[data-cmd]")?.dataset.cmd; if (!c) return;
  if (c === "quote") { const inQ = getSelection().anchorNode?.parentElement?.closest("blockquote"); cmd("formatBlock", inQ ? "p" : "blockquote"); }
  else if (c === "code") { const s = getSelection().toString(); if (s) cmd("insertHTML", "<code>" + s.replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[m]) + "</code>"); else toast("Select some text first."); }
  else if (c === "link") { const u = prompt("Link address"); if (u) cmd("createLink", /^https?:/i.test(u) ? u : "https://" + u); }
  else cmd(c);
});
$("#blk").onchange = (e) => { cmd("formatBlock", e.target.value); };
function syncTools() { for (const c of ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"]) { try { $(`[data-cmd="${c}"]`)?.classList.toggle("on", document.queryCommandState(c)); } catch {} } }
document.addEventListener("selectionchange", () => { if (!$("#v-editor").hidden) syncTools(); });
ed.addEventListener("paste", (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); });

// menus
const MENUS = {
  File: [["Listen", listen], ["Copy text", () => $("#e-share").click()], ["Download as .txt", () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ed.innerText], { type: "text/plain" })); a.download = ($("#e-title").value.trim() || "document") + ".txt"; a.click(); }], ["Close", closeEditor]],
  Edit: [["Undo", () => cmd("undo")], ["Redo", () => cmd("redo")], ["Select all", () => cmd("selectAll")], ["Clear document", () => { if (confirm("Clear everything?")) ed.innerHTML = ""; updateStat(); }]],
  View: [["Larger text", () => zoom(2)], ["Smaller text", () => zoom(-2)], ["Reset text size", () => zoom(0)]],
  Annotations: null,
  Settings: [[() => `Tidy text when listening: ${tidy ? "On" : "Off"}`, () => { tidy = !tidy; store.set("meraify.tidy", tidy ? "1" : "0"); toast(`Tidy text is ${tidy ? "on" : "off"}.`); }]],
  Help: [["Keyboard shortcuts", () => toast("⌘/Ctrl + B bold · I italic · U underline · Z undo. In the reader: Space plays, ← → skip.", 8000)]],
};
function zoom(d) { edSize = d === 0 ? 20 : Math.max(14, Math.min(34, edSize + d)); ed.style.setProperty("--ed-size", edSize + "px"); }
(function buildMenus() {
  const bar = $("#menubar");
  for (const [name, items] of Object.entries(MENUS)) {
    const wrap = document.createElement("div"); wrap.className = "menu";
    const b = document.createElement("button"); b.className = "mbtn"; b.textContent = name; wrap.appendChild(b);
    if (!items) { b.disabled = true; b.dataset.tip = "Unavailable during editing"; bar.appendChild(wrap); continue; }
    const pop = document.createElement("div"); pop.className = "menu-pop"; pop.hidden = true;
    for (const [label, fn] of items) { const i = document.createElement("button"); i.textContent = typeof label === "function" ? label() : label; i.onclick = () => { closePops(); fn(); }; pop.appendChild(i); }
    b.onclick = (e) => { e.stopPropagation(); const o = pop.hidden; closePops(); pop.hidden = !o; b.classList.toggle("on", o); if (o) [...pop.children].forEach((c, k) => { const l = items[k][0]; if (typeof l === "function") c.textContent = l(); }); };
    wrap.appendChild(pop); bar.appendChild(wrap);
  }
  const sep = document.createElement("i"); sep.className = "sep"; bar.appendChild(sep);
  const sb = document.createElement("button"); sb.className = "mbtn"; sb.innerHTML = '<svg class="i" style="width:16px;height:16px"><use href="#i-search"/></svg>Search';
  const inp = document.createElement("input"); inp.id = "e-find"; inp.placeholder = "Find in document"; inp.hidden = true;
  sb.onclick = () => { inp.hidden = !inp.hidden; if (!inp.hidden) inp.focus(); };
  inp.onkeydown = (e) => { if (e.key === "Enter" && inp.value) { getSelection().removeAllRanges(); if (!window.find(inp.value, false, e.shiftKey, true)) toast("No matches."); } else if (e.key === "Escape") inp.hidden = true; };
  bar.append(sb, inp);
})();

// dictation
const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null;
$("#e-mic").onclick = () => {
  const mic = $("#e-mic");
  if (!SR) return toast("Dictation isn't supported in this browser. Try Chrome or Edge.");
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.continuous = true; rec.interimResults = false; rec.lang = navigator.language || "en-US";
  rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) { ed.focus(); document.execCommand("insertText", false, e.results[i][0].transcript + " "); } };
  rec.onend = () => { rec = null; mic.classList.remove("on"); };
  rec.onerror = (ev) => toast("Dictation problem: " + ev.error);
  rec.start(); mic.classList.add("on");
};

// ---------- boot ----------
(async function init() {
  $("#rate").value = store.get("meraify.rate", "1"); player.setRate(Number($("#rate").value));
  setNav(store.get("meraify.nav2", innerWidth > 820 ? "1" : "0") === "1");
  try {
    const v = await getVoices(), sel = $("#voice");
    for (const x of v.voices) sel.add(new Option(x.name, x.id));
    sel.value = [...sel.options].some((o) => o.value === store.get("meraify.voice", "")) ? store.get("meraify.voice") : v.default;
    player.setVoice(sel.value);
    renderVoices();
    warmUp().catch((e) => toast(e.message, 8000));
  } catch (e) { toast(e.message); }
  go("home");
})();

})();
