const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const EXAMPLES_PATH = path.join(DATA_DIR, 'examples.json');
const ARCHIVE_PATH = path.join(DATA_DIR, 'chat-archive.jsonl');
const OLD_LOG_PATH = path.join(DATA_DIR, 'chat-log.old.jsonl');
const MODEL_PATH = path.join(DATA_DIR, 'style-model.json');

const HASH_DIM = 4096;
const MAX_RSS_BYTES = 260 * 1024 * 1024;
const IDLE_PAUSE_MS = 30 * 1000;
const DUTY_COMPUTE_MS = 160;
const DUTY_SLEEP_MS = 750;
const BATCH_SIZE = 48;
const SAVE_INTERVAL_MS = 60 * 1000;

const STIFF_AI_PATTERNS = [
  /\b(?:utawa|menyang|babagan|manungsa|tepo seliro|dibecik|dhewe|podho|mulih|maeng|dhisik|mung)\b/i,
  /\*[^*\n]+\*/,
  /\s—\s/,
  /^(?:nah,\s*setuju|hooh bener,\s*pandangan|wah,\s*pitakonan)/i,
];

let lastChatActivityAt = 0;
let trainerTimer = null;
let isTickRunning = false;

let bm25Index = null;
let modelWeights = new Float32Array(HASH_DIM);
let modelBias = 0;
let trainerState = {
  epochs: 0,
  steps: 0,
  movingAcc: 0,
  positiveCount: 0,
  negativeCount: 0,
  lastSavedAt: null,
};

let dataset = [];
let datasetCursor = 0;
let lastSaveAt = Date.now();
let hasUnsavedProgress = false;

/**
 * Notify the idle trainer that chat activity occurred so it pauses immediately.
 */
function notifyChatActivity() {
  lastChatActivityAt = Date.now();
  hasUnsavedProgress = true;
}

function tokenizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function hashFeature(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % HASH_DIM;
}

function extractSparseFeatures(text) {
  const feats = new Map();
  const clean = String(text || '').trim();
  const words = tokenizeWords(clean);

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    feats.set(hashFeature(`w:${w}`), 1);
    if (i < words.length - 1) {
      feats.set(hashFeature(`bg:${w}_${words[i + 1]}`), 1);
    }
    if (w.length >= 3) {
      for (let j = 0; j <= w.length - 3; j += 1) {
        feats.set(hashFeature(`c3:${w.slice(j, j + 3)}`), 0.5);
      }
    }
  }

  // Structural style signals
  const lines = clean.split(/\n+/).filter(Boolean);
  const avgWordsPerLine = lines.length ? words.length / lines.length : words.length;
  const questionCount = (clean.match(/\?/g) || []).length;

  feats.set(hashFeature(avgWordsPerLine <= 9 ? 'len:short' : 'len:long'), 1.2);
  feats.set(hashFeature(questionCount >= 2 ? 'q:multi' : 'q:normal'), 1.2);

  for (let i = 0; i < STIFF_AI_PATTERNS.length; i += 1) {
    if (STIFF_AI_PATTERNS[i].test(clean)) {
      feats.set(hashFeature(`stiff:${i}`), 1.5);
    }
  }

  return feats;
}

function sigmoid(x) {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function predictProb(feats) {
  let z = modelBias;
  for (const [idx, val] of feats.entries()) {
    z += modelWeights[idx] * val;
  }
  return sigmoid(z);
}

/**
 * Score how closely a candidate reply matches Ade's organic chat style (0..1).
 * @param {string} text
 * @returns {number}
 */
function scoreAdeStyle(text) {
  if (!text || typeof text !== 'string') return 0.5;
  return predictProb(extractSparseFeatures(text));
}

/**
 * Build or return cached BM25 index over data/examples.json.
 */
function ensureBm25Index() {
  if (bm25Index) return bm25Index;
  if (!fs.existsSync(EXAMPLES_PATH)) {
    bm25Index = { docs: [], df: new Map(), avgdl: 1 };
    return bm25Index;
  }

  const raw = JSON.parse(fs.readFileSync(EXAMPLES_PATH, 'utf8'));
  const docs = [];
  const df = new Map();
  let totalLen = 0;

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const input = typeof item?.input === 'string' ? item.input : item?.user;
      const reply = typeof item?.reply === 'string' ? item.reply : item?.assistant;
      if (typeof input !== 'string' || typeof reply !== 'string') continue;
      const tokens = tokenizeWords(input);
      const tf = new Map();
      for (const tok of tokens) {
        tf.set(tok, (tf.get(tok) || 0) + 1);
      }
      for (const tok of tf.keys()) {
        df.set(tok, (df.get(tok) || 0) + 1);
      }
      totalLen += tokens.length;
      docs.push({ input, reply, tf, len: tokens.length });
    }
  }

  bm25Index = {
    docs,
    df,
    avgdl: docs.length ? totalLen / docs.length : 1,
  };
  return bm25Index;
}

/**
 * Retrieve top-K few-shot examples using BM25 ranking.
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{input: string, reply: string}>}
 */
function queryBM25Examples(query, limit = 8) {
  const index = ensureBm25Index();
  if (!index.docs.length) return [];

  const qTokens = tokenizeWords(query);
  if (!qTokens.length) {
    return index.docs.slice(-limit).map(({ input, reply }) => ({ input, reply }));
  }

  const N = index.docs.length;
  const k1 = 1.5;
  const b = 0.75;
  const scored = [];

  for (let i = 0; i < N; i += 1) {
    const doc = index.docs[i];
    let score = 0;
    for (const term of qTokens) {
      const tf = doc.tf.get(term) || 0;
      if (tf === 0) continue;
      const docFreq = index.df.get(term) || 0;
      const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
      const norm = tf + k1 * (1 - b + b * (doc.len / index.avgdl));
      score += idf * ((tf * (k1 + 1)) / norm);
    }
    if (score > 0) {
      scored.push({ doc, score, idx: i });
    }
  }

  if (!scored.length) {
    return index.docs.slice(-limit).map(({ input, reply }) => ({ input, reply }));
  }

  scored.sort((a, b) => b.score - a.score || b.idx - a.idx);
  return scored.slice(0, limit).map((s) => ({ input: s.doc.input, reply: s.doc.reply }));
}

function buildSyntheticNegative(posText) {
  const stiffReplacements = [
    [/\bpo\b/gi, 'utawa'],
    [/\bning\b/gi, 'menyang'],
    [/\bgur\b/gi, 'mung'],
    [/\bnik\b/gi, 'menawi'],
    [/\baku\b/gi, 'kula'],
    [/\bkoe\b/gi, 'sampeyan'],
    [/\bdewe\b/gi, 'dhewe'],
    [/\bpodo\b/gi, 'podho'],
    [/\buda?h?\b/gi, 'sampun'],
  ];
  let neg = posText;
  for (const [re, rep] of stiffReplacements) {
    neg = neg.replace(re, rep);
  }
  if (neg === posText) {
    neg = `Nah, setuju aku karo pemikiranmu kui. Masalah babagan kui pancen perlu dipikirke kanthi tenanan, koe dewe pie?`;
  }
  return neg;
}

function loadTrainingDataset() {
  const pos = [];
  const neg = [];

  if (fs.existsSync(ARCHIVE_PATH)) {
    const lines = fs.readFileSync(ARCHIVE_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row?.isOwner && typeof row.text === 'string' && row.text.length >= 4) {
          pos.push(row.text);
        }
      } catch {
        // ignore malformed line
      }
    }
  } else if (fs.existsSync(EXAMPLES_PATH)) {
    const raw = JSON.parse(fs.readFileSync(EXAMPLES_PATH, 'utf8'));
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const rep = item?.assistant || item?.reply;
        if (typeof rep === 'string' && rep.length >= 4) pos.push(rep);
      }
    }
  }

  if (fs.existsSync(OLD_LOG_PATH)) {
    const lines = fs.readFileSync(OLD_LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (typeof row?.reply === 'string' && row.reply !== '[READ_ONLY]') {
          neg.push(row.reply);
        }
      } catch {
        // ignore
      }
    }
  }

  // Balance negative samples with synthetic stiff-AI examples
  const step = Math.max(1, Math.floor(pos.length / Math.max(1, pos.length - neg.length)));
  for (let i = 0; i < pos.length && neg.length < pos.length; i += step) {
    neg.push(buildSyntheticNegative(pos[i]));
  }

  const combined = [];
  const maxPairs = Math.min(pos.length, neg.length);
  for (let i = 0; i < maxPairs; i += 1) {
    combined.push({ text: pos[i], label: 1 });
    combined.push({ text: neg[i], label: 0 });
  }

  // Deterministic interleave shuffle
  for (let i = combined.length - 1; i > 0; i -= 1) {
    const j = (i * 2654435761) % (i + 1);
    const tmp = combined[i];
    combined[i] = combined[j];
    combined[j] = tmp;
  }

  trainerState.positiveCount = maxPairs;
  trainerState.negativeCount = maxPairs;
  return combined;
}

function loadSavedModel() {
  try {
    if (!fs.existsSync(MODEL_PATH)) return;
    const saved = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
    if (Array.isArray(saved.weights) && saved.weights.length === HASH_DIM) {
      modelWeights = Float32Array.from(saved.weights);
      modelBias = Number(saved.bias) || 0;
      trainerState = {
        ...trainerState,
        epochs: Number(saved.epochs) || 0,
        steps: Number(saved.steps) || 0,
        movingAcc: Number(saved.movingAcc) || 0,
        lastSavedAt: saved.lastSavedAt || null,
      };
    }
  } catch (err) {
    console.warn('[Trainer] Failed to load style-model.json:', err.message);
  }
}

function saveModel() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    trainerState.lastSavedAt = new Date().toISOString();
    const payload = {
      bias: modelBias,
      weights: Array.from(modelWeights, (w) => Number(w.toFixed(5))),
      epochs: trainerState.epochs,
      steps: trainerState.steps,
      movingAcc: Number(trainerState.movingAcc.toFixed(4)),
      positiveCount: trainerState.positiveCount,
      negativeCount: trainerState.negativeCount,
      lastSavedAt: trainerState.lastSavedAt,
    };
    fs.writeFileSync(MODEL_PATH, JSON.stringify(payload), 'utf8');
    lastSaveAt = Date.now();
    hasUnsavedProgress = false;
  } catch (err) {
    console.warn('[Trainer] Failed to save style-model.json:', err.message);
  }
}

function trainBatch(batchSize = BATCH_SIZE) {
  if (!dataset.length) {
    dataset = loadTrainingDataset();
    if (!dataset.length) return;
  }

  const lr = 0.03;
  const l2 = 1e-4;
  let correct = 0;

  for (let i = 0; i < batchSize; i += 1) {
    if (datasetCursor >= dataset.length) {
      datasetCursor = 0;
      trainerState.epochs += 1;
    }
    const sample = dataset[datasetCursor++];
    const feats = extractSparseFeatures(sample.text);
    const pred = predictProb(feats);
    const err = pred - sample.label;

    if ((pred >= 0.5 ? 1 : 0) === sample.label) {
      correct += 1;
    }

    modelBias -= lr * err;
    for (const [idx, val] of feats.entries()) {
      modelWeights[idx] -= lr * (err * val + l2 * modelWeights[idx]);
    }
    trainerState.steps += 1;
  }

  const batchAcc = correct / batchSize;
  trainerState.movingAcc =
    trainerState.movingAcc === 0 ? batchAcc : trainerState.movingAcc * 0.92 + batchAcc * 0.08;
}

function runIdleTick() {
  if (isTickRunning) return;
  isTickRunning = true;

  try {
    const start = Date.now();
    const isBusy = start - lastChatActivityAt < IDLE_PAUSE_MS;
    const rss = process.memoryUsage().rss;

    if (!isBusy && rss < MAX_RSS_BYTES) {
      while (Date.now() - start < DUTY_COMPUTE_MS) {
        trainBatch(BATCH_SIZE);
        if (trainerState.epochs <= 5) {
          hasUnsavedProgress = true;
        }
        if (Date.now() - lastChatActivityAt < IDLE_PAUSE_MS) break;
      }
      if (hasUnsavedProgress && Date.now() - lastSaveAt >= SAVE_INTERVAL_MS) {
        saveModel();
      }
    }
  } catch (err) {
    console.warn('[Trainer] Tick error:', err.message);
  } finally {
    isTickRunning = false;
    if (trainerTimer) {
      trainerTimer = setTimeout(runIdleTick, DUTY_SLEEP_MS);
      if (typeof trainerTimer.unref === 'function') trainerTimer.unref();
    }
  }
}

/**
 * Start the safe low-CPU duty-cycle idle style trainer & build BM25 index.
 */
function startIdleTrainer() {
  ensureBm25Index();
  loadSavedModel();
  dataset = loadTrainingDataset();

  // Warmup 1 epoch quickly on startup if no saved model exists yet
  if (trainerState.steps === 0 && dataset.length > 0) {
    const warmupBatches = Math.min(120, Math.ceil(dataset.length / BATCH_SIZE));
    for (let i = 0; i < warmupBatches; i += 1) {
      trainBatch(BATCH_SIZE);
    }
    saveModel();
  }

  if (process.env.IDLE_TRAINER_ENABLED === 'false') {
    console.log('[Trainer] Idle trainer disabled by env.');
    return;
  }

  if (!trainerTimer) {
    trainerTimer = setTimeout(runIdleTick, DUTY_SLEEP_MS);
    if (typeof trainerTimer.unref === 'function') trainerTimer.unref();
    console.log(
      `[Trainer] Idle Style Critic aktif (${dataset.length} sampel, BM25: ${bm25Index?.docs?.length || 0} Q&A).`
    );
  }
}

function stopIdleTrainer() {
  if (trainerTimer) {
    clearTimeout(trainerTimer);
    trainerTimer = null;
  }
  saveModel();
}

function getTrainerStats() {
  return {
    enabled: process.env.IDLE_TRAINER_ENABLED !== 'false',
    pausedByChat: Date.now() - lastChatActivityAt < IDLE_PAUSE_MS,
    epochs: trainerState.epochs,
    steps: trainerState.steps,
    accuracyPct: Math.round(trainerState.movingAcc * 100),
    bm25Docs: bm25Index?.docs?.length || 0,
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    lastSavedAt: trainerState.lastSavedAt,
  };
}

module.exports = {
  startIdleTrainer,
  stopIdleTrainer,
  notifyChatActivity,
  queryBM25Examples,
  scoreAdeStyle,
  getTrainerStats,
  trainBatch,
};
