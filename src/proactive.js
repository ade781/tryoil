const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_PATH = path.join(DATA_DIR, 'proactive-state.json');

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const FOLLOWUP_GAP_MS = 18 * 60 * 60 * 1000;

let schedulerTimer = null;
let state = {
  enabled: true,
  targets: {},
};

function getConfig() {
  const minHours = Math.max(1, Number(process.env.PROACTIVE_IDLE_MIN_HOURS) || 72);
  const maxHours = Math.max(minHours, Number(process.env.PROACTIVE_IDLE_MAX_HOURS) || 96);
  const maxFollowups = Math.max(1, Number(process.env.PROACTIVE_MAX_FOLLOWUPS) || 3);

  const [winStart, winEnd] = (process.env.PROACTIVE_WINDOW_WIB || '09-21')
    .split('-')
    .map((n) => Number(n));
  const [prioStart, prioEnd] = (process.env.PROACTIVE_PRIORITY_WIB || '14-20')
    .split('-')
    .map((n) => Number(n));

  const targets = (process.env.PROACTIVE_TARGETS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    enabled: process.env.PROACTIVE_ENABLED !== 'false',
    minMs: minHours * 3600 * 1000,
    maxMs: maxHours * 3600 * 1000,
    maxFollowups,
    winStart: Number.isFinite(winStart) ? winStart : 9,
    winEnd: Number.isFinite(winEnd) ? winEnd : 21,
    prioStart: Number.isFinite(prioStart) ? prioStart : 14,
    prioEnd: Number.isFinite(prioEnd) ? prioEnd : 20,
    targets,
  };
}

function getWibHour(date = new Date()) {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return Number(hourStr);
}

function randomThresholdMs(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      state = {
        enabled: parsed.enabled !== false,
        targets: parsed.targets && typeof parsed.targets === 'object' ? parsed.targets : {},
      };
    }
  } catch (err) {
    console.warn('[Proactive] Failed to load state:', err.message);
  }
}

function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Proactive] Failed to save state:', err.message);
  }
}

function ensureTarget(jid, senderName = 'Sasa') {
  const cfg = getConfig();
  if (!state.targets[jid]) {
    state.targets[jid] = {
      senderName,
      lastIncomingAt: Date.now(),
      lastOutgoingAt: Date.now(),
      lastProactiveAt: 0,
      followupCount: 0,
      nextThresholdMs: randomThresholdMs(cfg.minMs, cfg.maxMs),
    };
  }
  return state.targets[jid];
}

function recordIncomingActivity(jid, senderName) {
  const cfg = getConfig();
  if (!cfg.targets.includes(jid)) return;
  const t = ensureTarget(jid, senderName);
  t.senderName = senderName || t.senderName;
  t.lastIncomingAt = Date.now();
  t.followupCount = 0;
  t.nextThresholdMs = randomThresholdMs(cfg.minMs, cfg.maxMs);
  saveState();
}

function recordOutgoingActivity(jid) {
  const cfg = getConfig();
  if (!cfg.targets.includes(jid)) return;
  const t = ensureTarget(jid);
  t.lastOutgoingAt = Date.now();
  saveState();
}

function setProactiveEnabled(enabled) {
  state.enabled = Boolean(enabled);
  saveState();
}

function isTargetReadyToSend(t, cfg, now, wibHour) {
  if (wibHour < cfg.winStart || wibHour >= cfg.winEnd) return false;
  if (t.followupCount >= cfg.maxFollowups) return false;

  const lastActivity = Math.max(t.lastIncomingAt || 0, t.lastOutgoingAt || 0);
  const idleMs = now - lastActivity;
  const inPriorityWindow = wibHour >= cfg.prioStart && wibHour < cfg.prioEnd;

  if (t.followupCount === 0) {
    if (idleMs < t.nextThresholdMs) return false;
    // Prioritize 14:00-20:00 WIB; allow 09:00-21:00 WIB only if overdue > maxMs
    if (!inPriorityWindow && idleMs < cfg.maxMs) return false;
    return true;
  }

  // Follow-up greeting #2 or #3: wait at least 18h and prefer priority window 14-20 WIB
  const sinceLastProactive = now - (t.lastProactiveAt || 0);
  if (sinceLastProactive < FOLLOWUP_GAP_MS) return false;
  return inPriorityWindow;
}

/**
 * Start the proactive "Dor!" scheduler.
 * @param {object} deps
 * @param {Function} deps.getSocket
 * @param {Function} deps.generateProactiveOpener
 * @param {Function} deps.appendChatLog
 */
function startProactiveScheduler({ getSocket, generateProactiveOpener, appendChatLog }) {
  loadState();
  const cfg = getConfig();
  for (const jid of cfg.targets) {
    ensureTarget(jid);
  }
  saveState();

  if (schedulerTimer) clearInterval(schedulerTimer);

  const tick = async () => {
    const liveCfg = getConfig();
    if (!liveCfg.enabled || !state.enabled) return;
    const sock = getSocket();
    if (!sock) return;

    const now = Date.now();
    const wibHour = getWibHour(new Date(now));

    for (const jid of liveCfg.targets) {
      const t = ensureTarget(jid);
      if (!isTargetReadyToSend(t, liveCfg, now, wibHour)) continue;

      try {
        const opener = await generateProactiveOpener(jid, t.senderName, t.followupCount + 1);
        if (!opener) continue;

        const bubbles = opener.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        for (const bubble of bubbles) {
          await sock.sendMessage(jid, { text: bubble });
        }

        t.lastProactiveAt = now;
        t.lastOutgoingAt = now;
        t.followupCount += 1;
        saveState();

        appendChatLog({
          time: new Date().toISOString(),
          jid,
          sender: t.senderName,
          incoming: `[PROACTIVE_DOR #${t.followupCount}]`,
          reply: opener,
        });
        console.log(`[Proactive] Mengirim sapaan #${t.followupCount} ke ${t.senderName}: "${opener}"`);
      } catch (err) {
        console.error('[Proactive] Gagal mengirim sapaan:', err.message);
      }
    }
  };

  schedulerTimer = setInterval(tick, CHECK_INTERVAL_MS);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
}

function getProactiveStatus() {
  loadState();
  const cfg = getConfig();
  const now = Date.now();
  const targetSummaries = cfg.targets.map((jid) => {
    const t = ensureTarget(jid);
    const lastAct = Math.max(t.lastIncomingAt || 0, t.lastOutgoingAt || 0);
    const idleHours = ((now - lastAct) / 3600000).toFixed(1);
    const targetHours = (t.nextThresholdMs / 3600000).toFixed(1);
    return {
      jid,
      senderName: t.senderName,
      idleHours,
      targetHours,
      followupCount: t.followupCount,
      maxFollowups: cfg.maxFollowups,
    };
  });

  return {
    enabled: cfg.enabled && state.enabled,
    windowWib: `${cfg.winStart}:00-${cfg.winEnd}:00`,
    priorityWib: `${cfg.prioStart}:00-${cfg.prioEnd}:00`,
    targets: targetSummaries,
  };
}

module.exports = {
  startProactiveScheduler,
  recordIncomingActivity,
  recordOutgoingActivity,
  setProactiveEnabled,
  getProactiveStatus,
};
