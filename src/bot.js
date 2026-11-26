const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const { generateCloneReply, generateProactiveOpener, hydrateHistoryFromLog } = require('./ai');
const { startIdleTrainer, notifyChatActivity, getTrainerStats } = require('./style-trainer');
const { loadArchiveMessages, appendLiveToSearchCache, searchChatArchive, getArchiveStats } = require('./archive-search');
const { downloadVideo, downloadMp3, createStickerFromMessage } = require('./media-tools');
const {
  startProactiveScheduler,
  recordIncomingActivity,
  recordOutgoingActivity,
  setProactiveEnabled,
  getProactiveStatus,
} = require('./proactive');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');
const CHAT_LOG_PATH = path.join(__dirname, '..', 'data', 'chat-log.jsonl');
const DELAY_MIN_MS = Math.max(0, Number(process.env.REPLY_DELAY_MIN_MS) || 1500);
const DELAY_MAX_MS = Math.max(DELAY_MIN_MS, Number(process.env.REPLY_DELAY_MAX_MS) || 3500);
const IGNORE_GROUPS = process.env.IGNORE_GROUPS !== 'false';
const BUBBLE_DEBOUNCE_MS = 4000;
const pendingBatches = new Map();
const jidQueues = new Map();
let activeSocket = null;
function normalizePhone(raw) {
  const digits = String(raw || '').split('@')[0].replace(/\D/g, '');
  if (digits.startsWith('08')) {
    return '62' + digits.slice(1);
  }
  return digits;
}

const ALLOWED_NUMBERS = (process.env.ALLOWED_NUMBERS || '')
  .split(',')
  .map(normalizePhone)
  .filter(Boolean);

let cloneEnabled = true;

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function appendChatLog(entry) {
  try {
    fs.mkdirSync(path.dirname(CHAT_LOG_PATH), { recursive: true });
    fs.appendFileSync(CHAT_LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('[Bot] Gagal menulis log chat:', err.message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return a random integer between min and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Extract plain text content from a Baileys WAMessage.
 * @param {object} msg
 * @returns {string}
 */
function extractMessageText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  ).trim();
}

function extractQuotedMediaMessage(msg) {
  const ctx = msg?.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  if (!ctx.quotedMessage.imageMessage && !ctx.quotedMessage.videoMessage) return null;
  return {
    key: {
      remoteJid: msg.key.remoteJid,
      id: ctx.stanzaId,
      participant: ctx.participant,
    },
    message: ctx.quotedMessage,
  };
}

function resolveStickerTarget(msg) {
  if (msg?.message?.imageMessage || msg?.message?.videoMessage) {
    return msg;
  }
  return extractQuotedMediaMessage(msg);
}

async function handleStickerCommand(sock, jid, msg) {
  const targetMsg = resolveStickerTarget(msg);
  if (!targetMsg) {
    await sock.sendMessage(jid, {
      text: 'Kirim gambar/video dengan caption !s atau reply gambar/video dengan !s.',
    });
    return;
  }
  const webpBuffer = await createStickerFromMessage(targetMsg, sock);
  await sock.sendMessage(jid, { sticker: webpBuffer }, { quoted: msg });
}

/**
 * Handle owner self-commands (!clone, !cari, !dl, !mp3, !s, !dor).
 * @param {object} sock
 * @param {string} jid
 * @param {string} text
 * @param {object} msg
 * @returns {Promise<boolean>} true if command was handled
 */
async function handleOwnerCommand(sock, jid, text, msg) {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  const cmd = cleanText.toLowerCase();

  if (cmd === '!clone off') {
    cloneEnabled = false;
    await sock.sendMessage(jid, { text: '🔴 WA Clone dimatikan.' });
    return true;
  }
  if (cmd === '!clone on') {
    cloneEnabled = true;
    await sock.sendMessage(jid, { text: '🟢 WA Clone diaktifkan.' });
    return true;
  }
  if (cmd === '!clone help') {
    const helpText = [
      `🤖 *Daftar Perintah WA Clone*`,
      `• !clone on / off / status`,
      `• !cari <kata kunci> — cari riwayat chat`,
      `• !s / !stiker — ubah gambar/video jadi stiker`,
      `• !dl <url> — download video (TikTok/IG/YT)`,
      `• !mp3 <url> — download audio MP3`,
      `• !dor on / off / status / test — auto sapaan saat sepi`,
    ].join('\n');
    await sock.sendMessage(jid, { text: helpText });
    return true;
  }
  if (cmd === '!clone status') {
    const ownerNumber = normalizePhone(sock.user?.id || '');
    const targetNumber = normalizePhone(jid);
    if (ownerNumber && targetNumber !== ownerNumber) {
      console.log(`[WA] Status diminta dari non-self chat (${jid}): active=${cloneEnabled}`);
      return true;
    }
    const allowedInfo = ALLOWED_NUMBERS.length ? ALLOWED_NUMBERS.join(', ') : 'Semua private chat';
    const tr = getTrainerStats();
    const ar = getArchiveStats();
    const pr = getProactiveStatus();
    const statusText = [
      `🤖 *WA Clone Status*`,
      `• Aktif: ${cloneEnabled ? 'ON 🟢' : 'OFF 🔴'}`,
      `• Ignore Grup: ${IGNORE_GROUPS ? 'Ya' : 'Tidak'}`,
      `• Allowed: ${allowedInfo}`,
      `• Idle Trainer: ${tr.enabled ? (tr.pausedByChat ? 'Paused (Chat)' : 'Running') : 'OFF'} | Epoch ${tr.epochs} | Acc ${tr.accuracyPct}% | BM25 ${tr.bm25Docs} | RSS ${tr.rssMb}MB`,
      `• Arsip Chat: ${ar.totalMessages} pesan terindeks`,
      `• Proactive Dor: ${pr.enabled ? 'ON' : 'OFF'} (${pr.priorityWib} prio, ${pr.windowWib} max)`,
    ].join('\n');
    await sock.sendMessage(jid, { text: statusText });
    return true;
  }

  if (cmd.startsWith('!cari ')) {
    const query = cleanText.slice(6).trim();
    const hits = searchChatArchive(query, 5);
    if (!hits.length) {
      await sock.sendMessage(jid, { text: `Tidak ditemukan hasil untuk "${query}".` });
      return true;
    }
    const formatted = hits
      .map((h, i) => {
        const prevLine = h.contextPrev ? `\n  ↳ sebelumnya: ${h.contextPrev.slice(0, 80)}` : '';
        return `${i + 1}. [${h.date} ${h.time}] ${h.sender}: ${h.text}${prevLine}`;
      })
      .join('\n\n');
    await sock.sendMessage(jid, { text: `🔎 *Hasil "${query}":*\n\n${formatted}` });
    return true;
  }

  if (cmd === '!s' || cmd === '!stiker') {
    try {
      await handleStickerCommand(sock, jid, msg);
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ Gagal buat stiker: ${err.message}` });
    }
    return true;
  }

  if (cmd.startsWith('!dl ')) {
    const url = cleanText.slice(4).trim();
    await sock.sendMessage(jid, { text: '⏳ Mengunduh video...' });
    try {
      const { buffer } = await downloadVideo(url);
      await sock.sendMessage(jid, { video: buffer, caption: '✅ Selesai' });
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ Gagal download video: ${err.message}` });
    }
    return true;
  }

  if (cmd.startsWith('!mp3 ')) {
    const url = cleanText.slice(5).trim();
    await sock.sendMessage(jid, { text: '⏳ Mengunduh & convert MP3...' });
    try {
      const { buffer } = await downloadMp3(url);
      await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg' });
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ Gagal download MP3: ${err.message}` });
    }
    return true;
  }

  if (cmd === '!dor on') {
    setProactiveEnabled(true);
    await sock.sendMessage(jid, { text: '🟢 Proactive Dor diaktifkan.' });
    return true;
  }
  if (cmd === '!dor off') {
    setProactiveEnabled(false);
    await sock.sendMessage(jid, { text: '🔴 Proactive Dor dimatikan.' });
    return true;
  }
  if (cmd === '!dor status') {
    const st = getProactiveStatus();
    const lines = st.targets.map(
      (t) =>
        `• ${t.senderName}: sepi ${t.idleHours}j / target ${t.targetHours}j (sapaan ${t.followupCount}/${t.maxFollowups})`
    );
    await sock.sendMessage(jid, {
      text: `🔔 *Proactive Dor (${st.enabled ? 'ON' : 'OFF'})*\nWindow: ${st.windowWib} (Prio ${st.priorityWib})\n${lines.join('\n') || '-'}`,
    });
    return true;
  }
  if (cmd === '!dor test') {
    const st = getProactiveStatus();
    const first = st.targets[0];
    const sample = await generateProactiveOpener(
      first?.jid || 'test-dor',
      first?.senderName || 'Sasa',
      1
    );
    await sock.sendMessage(jid, { text: `🧪 *Simulasi Sapaan Dor:*\n${sample}` });
    return true;
  }

  return false;
}

async function processCombinedMessage(sock, jid, senderName, combinedText) {
  let reply = '';
  try {
    await sock.sendPresenceUpdate('composing', jid);
    const delayMs = randomBetween(DELAY_MIN_MS, DELAY_MAX_MS);
    await sleep(delayMs);
    reply = await generateCloneReply(jid, senderName, combinedText);
  } finally {
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  }

  if (reply) {
    const bubbles = reply
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let i = 0; i < bubbles.length; i += 1) {
      if (i > 0) {
        await sock.sendPresenceUpdate('composing', jid).catch(() => {});
        await sleep(randomBetween(600, 1200));
        await sock.sendPresenceUpdate('paused', jid).catch(() => {});
      }
      await sock.sendMessage(jid, { text: bubbles[i] });
    }

    appendChatLog({
      time: new Date().toISOString(),
      jid,
      sender: senderName,
      incoming: combinedText,
      reply,
    });
    appendLiveToSearchCache(senderName, combinedText, reply);
    recordOutgoingActivity(jid);
    console.log(`[WA] ${senderName}: "${combinedText.replace(/\n/g, ' | ')}" -> "${reply.replace(/\n/g, ' | ')}"`);
  }
}

function enqueueIncomingBubble(sock, jid, senderName, text) {
  const existing = pendingBatches.get(jid);
  if (existing) {
    clearTimeout(existing.timer);
    existing.texts.push(text);
    existing.senderName = senderName;
  } else {
    pendingBatches.set(jid, { senderName, texts: [text], timer: null });
  }

  const batch = pendingBatches.get(jid);
  batch.timer = setTimeout(() => {
    pendingBatches.delete(jid);
    const combinedText = batch.texts.join('\n');
    const prevQueue = jidQueues.get(jid) || Promise.resolve();
    const nextQueue = prevQueue
      .then(() => processCombinedMessage(sock, jid, batch.senderName, combinedText))
      .catch((err) => {
        console.error('[Bot] Gagal memproses pesan:', err.message);
      });
    jidQueues.set(jid, nextQueue);
  }, BUBBLE_DEBOUNCE_MS);
}

async function startBot() {
  hydrateHistoryFromLog(CHAT_LOG_PATH);
  loadArchiveMessages();
  startIdleTrainer();
  startProactiveScheduler({
    getSocket: () => activeSocket,
    generateProactiveOpener,
    appendChatLog,
  });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });
  activeSocket = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan QR code berikut dengan WhatsApp Anda:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[WA] Koneksi terputus (code: ${statusCode}). Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(() => {
          startBot().catch((err) => console.error('[WA] Reconnect error:', err.message));
        }, 3000);
      } else {
        console.log('[WA] Logged out. Hapus folder auth_info/ dan scan ulang QR untuk login.');
      }
    } else if (connection === 'open') {
      console.log('[WA] Bot WhatsApp AI Clone berhasil terhubung!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        const jid = msg.key?.remoteJid;
        if (!jid || jid === 'status@broadcast') continue;

        const text = extractMessageText(msg);
        if (!text) continue;

        if (msg.key.fromMe) {
          notifyChatActivity();
          recordOutgoingActivity(jid);
          await handleOwnerCommand(sock, jid, text, msg);
          continue;
        }

        if (!cloneEnabled) continue;

        const isGroup = jid.endsWith('@g.us');
        if (IGNORE_GROUPS && isGroup) continue;

        if (ALLOWED_NUMBERS.length > 0) {
          const candidates = [
            msg.key.participantAlt,
            msg.key.remoteJidAlt,
            msg.key.participant,
            jid,
          ];

          if (jid.endsWith('@lid') && sock.signalRepository?.lidMapping?.getPNForLID) {
            try {
              const resolvedPn = await sock.signalRepository.lidMapping.getPNForLID(jid);
              if (resolvedPn) candidates.push(resolvedPn);
            } catch {
              // ignore lid mapping lookup errors
            }
          }

          const normalizedCandidates = candidates.map(normalizePhone).filter(Boolean);
          const isAllowed = normalizedCandidates.some((num) => ALLOWED_NUMBERS.includes(num));
          if (!isAllowed) {
            console.log(
              `[WA Skip] Tidak masuk whitelist -> jid=${jid} alt=${msg.key.remoteJidAlt || '-'} pushName="${msg.pushName || '-'}"`
            );
            continue;
          }
        }

        const senderName = msg.pushName || jid.split('@')[0];
        notifyChatActivity();
        recordIncomingActivity(jid, senderName);

        const lowerCmd = text.replace(/\s+/g, ' ').trim().toLowerCase();
        if (lowerCmd === '!s' || lowerCmd === '!stiker') {
          try {
            await handleStickerCommand(sock, jid, msg);
          } catch (err) {
            await sock.sendMessage(jid, { text: `Gagal buat stiker: ${err.message}` });
          }
          continue;
        }

        enqueueIncomingBubble(sock, jid, senderName, text);
      } catch (err) {
        console.error('[Bot] Gagal memproses pesan:', err.message);
      }
    }
  });
}

startBot().catch((err) => {
  console.error('[Bot] Fatal error:', err);
  process.exit(1);
});
