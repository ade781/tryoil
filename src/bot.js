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
const { generateCloneReply } = require('./ai');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');
const DELAY_MIN_MS = Math.max(0, Number(process.env.REPLY_DELAY_MIN_MS) || 1500);
const DELAY_MAX_MS = Math.max(DELAY_MIN_MS, Number(process.env.REPLY_DELAY_MAX_MS) || 3500);
const IGNORE_GROUPS = process.env.IGNORE_GROUPS !== 'false';
const ALLOWED_NUMBERS = (process.env.ALLOWED_NUMBERS || '')
  .split(',')
  .map((num) => num.replace(/\D/g, '').trim())
  .filter(Boolean);

let cloneEnabled = true;

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
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
  const cmd = text.toLowerCase();
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

async function startBot() {
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
        startBot();
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
          const senderJid = msg.key.participant || jid;
          const senderNumber = senderJid.split('@')[0].replace(/\D/g, '');
          if (!ALLOWED_NUMBERS.includes(senderNumber)) continue;
        }

        const senderName = msg.pushName || jid.split('@')[0];

        await sock.sendPresenceUpdate('composing', jid);
        const delayMs = randomBetween(DELAY_MIN_MS, DELAY_MAX_MS);
        await sleep(delayMs);

        const reply = await generateCloneReply(jid, senderName, text);
        await sock.sendPresenceUpdate('paused', jid);

        if (reply) {
          await sock.sendMessage(jid, { text: reply });
        }
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
