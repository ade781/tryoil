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
const { generateCloneReply, hydrateHistoryFromLog } = require('./ai');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');
const CHAT_LOG_PATH = path.join(__dirname, '..', 'data', 'chat-log.jsonl');
const DELAY_MIN_MS = Math.max(0, Number(process.env.REPLY_DELAY_MIN_MS) || 1500);
const DELAY_MAX_MS = Math.max(DELAY_MIN_MS, Number(process.env.REPLY_DELAY_MAX_MS) || 3500);
const IGNORE_GROUPS = process.env.IGNORE_GROUPS !== 'false';
const BUBBLE_DEBOUNCE_MS = 4000;
const pendingBatches = new Map();
const jidQueues = new Map();
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

/**
 * Handle owner self-commands (!clone on/off/status).
 * @param {object} sock
 * @param {string} jid
 * @param {string} text
 * @returns {Promise<boolean>} true if command was handled
 */
async function handleOwnerCommand(sock, jid, text) {
  const cmd = text.replace(/\s+/g, ' ').trim().toLowerCase();
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
  if (cmd === '!clone status') {
    const ownerNumber = normalizePhone(sock.user?.id || '');
    const targetNumber = normalizePhone(jid);
    if (ownerNumber && targetNumber !== ownerNumber) {
      console.log(`[WA] Status diminta dari non-self chat (${jid}): active=${cloneEnabled}`);
      return true;
    }
    const allowedInfo = ALLOWED_NUMBERS.length ? ALLOWED_NUMBERS.join(', ') : 'Semua private chat';
    const statusText = [
      `🤖 *WA Clone Status*`,
      `• Aktif: ${cloneEnabled ? 'ON 🟢' : 'OFF 🔴'}`,
      `• Ignore Grup: ${IGNORE_GROUPS ? 'Ya' : 'Tidak'}`,
      `• Allowed: ${allowedInfo}`,
    ].join('\n');
    await sock.sendMessage(jid, { text: statusText });
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
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });

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
          await handleOwnerCommand(sock, jid, text);
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
