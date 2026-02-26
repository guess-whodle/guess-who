const MAX_TRIES = 6;

const $canvas = document.getElementById("canvas");
const ctx = $canvas.getContext("2d", { willReadFrequently: true });
const $guess = document.getElementById("guess");
const $btn = document.getElementById("btn");
const $log = document.getElementById("log");
const $hint = document.getElementById("hint");
const $reset = document.getElementById("reset");
const $names = document.getElementById("names");

// Canvas placeholder (cuando no hay imagen)
//let $canvasEmpty = null;

/**
 * =========================
 * CONFIG: Campos comparables
 * =========================
 *
 * type:
 *  - "number": número donde más/menos tiene sentido (edad, año, altura, bpm...)
 *  - "rank": ranking donde 1 es mejor (popularity #1 = más popular)
 *  - "text": texto exacto (country, genre...)
 *  - "enum": como text, pero con "close" por grupos (ej: países por continente)
 *  - "set": listas/arrays (ej: tags) con close si comparten elementos
 *
 * close:
 *  - number: margen para marcar "close" (solo en number/rank)
 *  - enum: función close(guess, target) => true/false
 *  - set: mínimo de intersección para close (o función)
 *
 * format:
 *  - función para mostrar el valor en la tarjeta
 */
const FIELDS = [
  { key: "age", label: "Edad", type: "number", close: 8, format: (v) => v ?? "-" },
  { key: "handsome", label: "Guapo", type: "number", close: 20, format: (v) => v ?? "-" },
  { key: "popularity", label: "Famoso", type: "rank", close: 15, format: (v) => (typeof v === "number" ? `#${v}` : (v ?? "-")) },
  { key: "tez", label: "Nigger", type: "rank", format: (v) => v ?? "-" },
  { key: "country", label: "Pais", type: "text", format: (v) => v ?? "-" },
  { key: "profesion", label: "Trabajo", type: "text", format: (v) => v ?? "-" },
  { key: "altura", label: "Altura", type: "number", format: (v) => (typeof v === "number" ? `${v}cm` : (v ?? "-"))  }
];

/**
 * Si quieres "close" por categorías (ej: country close por continente),
 * puedes definir aquí un mapa, o usar type:"enum" con una función.
 *
 * Ejemplo rápido (NO usado por defecto):
 * const COUNTRY_TO_CONTINENT = { "Spain":"Europe", "UK":"Europe", "Japan":"Asia", ... }
 */

function normalize(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function loadState() {
  const key = `imgdle:${todayKey()}`;
  try { return JSON.parse(localStorage.getItem(key) || "null"); }
  catch { return null; }
}

function saveState(state) {
  const key = `imgdle:${todayKey()}`;
  localStorage.setItem(key, JSON.stringify(state));
}

async function loadData() {
  const res = await fetch("data.json");
  if (!res.ok) throw new Error("No puedo cargar data.json");
  const items = await res.json();
  if (!Array.isArray(items) || items.length === 0) throw new Error("data.json está vacío o no es una lista");
  return items;
}

function chooseDailyPuzzle(items) {
  const idx = hashString(todayKey()) % items.length;
  return items[idx];
}

function drawPixelated(img, pixelSize) {
  const w = $canvas.width, h = $canvas.height;

  const sw = Math.max(1, Math.floor(w / pixelSize));
  const sh = Math.max(1, Math.floor(h / pixelSize));

  const tmp = document.createElement("canvas");
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext("2d");
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(img, 0, 0, sw, sh);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, w, h);
}

function pixelSizeForTry(tryIndex) {
  const levels = [18, 14, 10, 8, 6, 4];
  return levels[Math.min(tryIndex, levels.length - 1)];
}

function buildIndex(items) {
  const map = new Map();
  for (const it of items) {
    map.set(normalize(it.name), it);
    for (const a of (it.aliases || [])) map.set(normalize(a), it);
  }
  return map;
}

// ===============
// Comparadores genéricos
// Estados: match / close / wrong
// ===============

function statusMatchCloseWrong({ status, sub }) {
  return { status, sub: sub || "" };
}

function cmpNumber(guess, target, closeDelta) {
  if (typeof guess !== "number" || typeof target !== "number") {
    return statusMatchCloseWrong({ status: "wrong", sub: "sin dato" });
  }
  if (guess === target) return statusMatchCloseWrong({ status: "match", sub: "igual" });
  if (typeof closeDelta === "number" && Math.abs(guess - target) <= closeDelta) {
    return statusMatchCloseWrong({ status: "close", sub: "cerca" });
  }
  return statusMatchCloseWrong({ status: "wrong", sub: guess < target ? "más bajo" : "más alto" });
}

function cmpRankLowerIsBetter(guessRank, targetRank, closeDelta) {
  // #1 es mejor (más popular)
  if (typeof guessRank !== "number" || typeof targetRank !== "number") {
    return statusMatchCloseWrong({ status: "wrong", sub: "sin dato" });
  }
  if (guessRank === targetRank) return statusMatchCloseWrong({ status: "match", sub: "igual" });
  if (typeof closeDelta === "number" && Math.abs(guessRank - targetRank) <= closeDelta) {
    return statusMatchCloseWrong({ status: "close", sub: "cerca" });
  }
  return statusMatchCloseWrong({ status: "wrong", sub: guessRank < targetRank ? "más popular" : "menos popular" });
}

function cmpTextExact(guess, target) {
  const g = normalize(guess);
  const t = normalize(target);
  if (!g || !t) return statusMatchCloseWrong({ status: "wrong", sub: "sin dato" });
  if (g === t) return statusMatchCloseWrong({ status: "match", sub: "igual" });
  return statusMatchCloseWrong({ status: "wrong", sub: "distinto" });
}

function cmpEnum(guess, target, closeFn) {
  // closeFn(guess, target) => true si es "close" (por ejemplo mismo continente)
  const base = cmpTextExact(guess, target);
  if (base.status === "match") return base;

  const g = guess ?? "";
  const t = target ?? "";
  if (typeof closeFn === "function" && g && t && closeFn(g, t)) {
    return statusMatchCloseWrong({ status: "close", sub: "cerca" });
  }
  return statusMatchCloseWrong({ status: "wrong", sub: "distinto" });
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

function cmpSet(guess, target, closeRule) {
  // "close" si comparten al menos N elementos o closeRule es función
  const ga = toArray(guess).map(normalize);
  const ta = toArray(target).map(normalize);
  if (ga.length === 0 || ta.length === 0) return statusMatchCloseWrong({ status: "wrong", sub: "sin dato" });

  const setT = new Set(ta);
  let inter = 0;
  for (const x of ga) if (setT.has(x)) inter++;

  if (inter === Math.max(ga.length, ta.length)) {
    return statusMatchCloseWrong({ status: "match", sub: "igual" });
  }

  let isClose = false;
  if (typeof closeRule === "function") isClose = closeRule(ga, ta, inter);
  else if (typeof closeRule === "number") isClose = inter >= closeRule;

  if (isClose) return statusMatchCloseWrong({ status: "close", sub: `comparten ${inter}` });
  return statusMatchCloseWrong({ status: "wrong", sub: `comparten ${inter}` });
}

function cmpNumberOrText(guess, target, closeDelta) {
  // members: puede ser número o texto ("Solo")
  if (typeof guess === "number" && typeof target === "number") {
    return cmpNumber(guess, target, closeDelta);
  }
  return cmpTextExact(guess, target);
}

function compareField(field, guessObj, targetObj) {
  const guessVal = guessObj?.[field.key];
  const targetVal = targetObj?.[field.key];

  switch (field.type) {
    case "number":
      return cmpNumber(guessVal, targetVal, field.close);
    case "rank":
      return cmpRankLowerIsBetter(guessVal, targetVal, field.close);
    case "text":
      return cmpTextExact(guessVal, targetVal);
    case "enum":
      return cmpEnum(guessVal, targetVal, field.close); // aquí close es función
    case "set":
      return cmpSet(guessVal, targetVal, field.close); // aquí close es número o función
    case "numberOrText":
      return cmpNumberOrText(guessVal, targetVal, field.close);
    default:
      return statusMatchCloseWrong({ status: "wrong", sub: "tipo desconocido" });
  }
}

function buildTilesGeneric(guessObj, targetObj) {
  return FIELDS.map(f => {
    const cmp = compareField(f, guessObj, targetObj);
    return {
      key: f.key,
      label: f.label,
      value: (typeof f.format === "function" ? f.format(guessObj?.[f.key]) : (guessObj?.[f.key] ?? "-")),
      status: cmp.status,
      sub: cmp.sub
    };
  });
}

function renderAttempts(tries) {
  $log.innerHTML = "";

  tries.forEach((t, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "attempt";

    const header = document.createElement("div");
    header.className = "attemptHeader";

    const name = document.createElement("div");
    name.className = "attemptName";
    name.textContent = t.text;

    const meta = document.createElement("div");
    meta.className = "attemptMeta";
    meta.textContent = `Intento ${idx + 1}/${MAX_TRIES}${t.ok ? " — Match" : ""}`;

    header.appendChild(name);
    header.appendChild(meta);

    const tiles = document.createElement("div");
    tiles.className = "tiles";

    (t.tiles || []).forEach(tile => {
      const box = document.createElement("div");
      box.className = `tile ${tile.status}`;

      const lab = document.createElement("div");
      lab.className = "tileLabel";
      lab.textContent = tile.label;

      const val = document.createElement("div");
      val.className = "tileValue";
      val.textContent = `${tile.value}`;

      const sub = document.createElement("div");
      sub.className = "tileSub";
      sub.textContent = tile.sub || "";

      box.appendChild(lab);
      box.appendChild(val);
      box.appendChild(sub);

      tiles.appendChild(box);
    });

    wrap.appendChild(header);
    wrap.appendChild(tiles);

    $log.appendChild(wrap);
  });

  if (tries.length) {
    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = `
      <div class="legendPill wrong">Wrong</div>
      <div class="legendPill close">Close</div>
      <div class="legendPill match">Match</div>
    `;
    $log.appendChild(legend);
  }
}

function ensureCanvasEmptyPlaceholder(show, text) {
  if (show) {
    if (!$canvasEmpty) {
      $canvasEmpty = document.createElement("div");
      $canvasEmpty.className = "canvasEmpty";
      $canvas.parentNode.insertBefore($canvasEmpty, $canvas.nextSibling);
    }
    $canvas.style.display = "none";
    $canvasEmpty.style.display = "flex";
    $canvasEmpty.textContent = text || "Sin imagen";
  } else {
    $canvas.style.display = "block";
    if ($canvasEmpty) $canvasEmpty.style.display = "none";
  }
}

async function loadOptionalImage(src) {
  if (!src) return null;
  const img = new Image();
  img.src = src;
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    return img;
  } catch {
    return null;
  }
}

(async function main() {
  const items = await loadData();

  $names.innerHTML = items.map(x => `<option value="${x.name}"></option>`).join("");

  const index = buildIndex(items);
  const puzzle = chooseDailyPuzzle(items);

  const state = loadState() || {
    puzzleId: puzzle.id,
    tries: [],
    done: false
  };

  if (state.puzzleId !== puzzle.id) {
    state.puzzleId = puzzle.id;
    state.tries = [];
    state.done = false;
    saveState(state);
  }

  const img = await loadOptionalImage(puzzle.image);

  function redraw() {
    if (img) {
      ensureCanvasEmptyPlaceholder(false);
      drawPixelated(img, pixelSizeForTry(state.tries.length));
    } else {
      ensureCanvasEmptyPlaceholder(true, "Sin imagen (modo prueba)");
    }

    renderAttempts(state.tries);

    if (state.done) {
      $btn.disabled = true;
      $guess.disabled = true;
      if (state.tries.some(t => t.ok)) {
        $hint.textContent = "✅ Correcto. Mañana habrá otro reto.";
      } else {
        $hint.textContent = `❌ Sin intentos. La respuesta era: ${puzzle.name}`;
      }
    } else {
      $btn.disabled = false;
      $guess.disabled = false;
      if (!state.tries.length) $hint.textContent = "";
    }
  }

  function resolveGuessObject(input) {
    return index.get(normalize(input)) || null;
  }

  function submit() {
    if (state.done) return;

    const text = $guess.value;
    if (!normalize(text)) return;

    const guessObj = resolveGuessObject(text);

    if (!guessObj) {
      $hint.textContent = "Ese nombre no está en la base de datos. Elige uno del desplegable.";
      return;
    }

    const ok = guessObj.id === puzzle.id;
    const tiles = buildTilesGeneric(guessObj, puzzle);

    state.tries.push({
      text: guessObj.name,
      id: guessObj.id,
      ok,
      tiles
    });

    if (ok || state.tries.length >= MAX_TRIES) {
      state.done = true;
    }

    saveState(state);
    $guess.value = "";
    redraw();
  }

  $btn.addEventListener("click", submit);
  $guess.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  $reset.addEventListener("click", () => {
    localStorage.removeItem(`imgdle:${todayKey()}`);
    location.reload();
  });

  redraw();
})().catch(err => {
  alert(err.message);
  console.error(err);
});