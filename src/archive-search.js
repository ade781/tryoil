const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ARCHIVE_PATH = path.join(DATA_DIR, 'chat-archive.jsonl');
const CHAT_LOG_PATH = path.join(DATA_DIR, 'chat-log.jsonl');

let cachedMessages = null;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * Load all archived WhatsApp messages + live chat-log entries into memory.
 * @returns {Array<{date: string, time: string, sender: string, text: string}>}
 */
function loadArchiveMessages() {
  const entries = [];

  if (fs.existsSync(ARCHIVE_PATH)) {
    const lines = fs.readFileSync(ARCHIVE_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row?.text) {
          entries.push({
            date: row.date || '-',
            time: row.time || '',
            sender: row.sender || 'Unknown',
            text: row.text,
          });
        }
      } catch {
        // skip malformed line
      }
    }
  }

  if (fs.existsSync(CHAT_LOG_PATH)) {
    const lines = fs.readFileSync(CHAT_LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        const dt = row.time ? new Date(row.time) : null;
        const dateStr = dt && !Number.isNaN(dt.getTime())
          ? dt.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })
          : '-';
        const timeStr = dt && !Number.isNaN(dt.getTime())
          ? dt.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
          : '';
        if (row.incoming) {
          entries.push({ date: dateStr, time: timeStr, sender: row.sender || 'Lawan', text: row.incoming });
        }
        if (row.reply && row.reply !== '[READ_ONLY]') {
          entries.push({ date: dateStr, time: timeStr, sender: 'Ade (Bot)', text: row.reply });
        }
      } catch {
        // skip malformed line
      }
    }
  }

  cachedMessages = entries;
  return cachedMessages;
}

/**
 * Append a live chat turn to the in-memory search cache without full reload.
 */
function appendLiveToSearchCache(sender, incoming, reply) {
  if (!cachedMessages) return;
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  const timeStr = now.toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (incoming) {
    cachedMessages.push({ date: dateStr, time: timeStr, sender: sender || 'Lawan', text: incoming });
  }
  if (reply && reply !== '[READ_ONLY]') {
    cachedMessages.push({ date: dateStr, time: timeStr, sender: 'Ade (Bot)', text: reply });
  }
}

/**
 * Search personal WhatsApp archive for a query string.
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{date: string, time: string, sender: string, text: string, contextPrev?: string}>}
 */
function searchChatArchive(query, limit = 5) {
  const docs = cachedMessages || loadArchiveMessages();
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery || !docs.length) return [];

  const lowerQuery = cleanQuery.toLowerCase();
  const qTokens = tokenize(cleanQuery);
  const results = [];

  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const lowerText = doc.text.toLowerCase();
    let score = 0;

    if (lowerText.includes(lowerQuery)) {
      score += 10;
    }

    if (qTokens.length > 0) {
      let hits = 0;
      for (const tok of qTokens) {
        if (lowerText.includes(tok)) hits += 1;
      }
      if (hits === 0 && score === 0) continue;
      score += (hits / qTokens.length) * 5;
    } else if (score === 0) {
      continue;
    }

    results.push({
      score,
      idx: i,
      date: doc.date,
      time: doc.time,
      sender: doc.sender,
      text: doc.text,
      contextPrev: i > 0 ? `${docs[i - 1].sender}: ${docs[i - 1].text}` : '',
    });
  }

  results.sort((a, b) => b.score - a.score || b.idx - a.idx);
  return results.slice(0, limit);
}

function getArchiveStats() {
  const docs = cachedMessages || loadArchiveMessages();
  return { totalMessages: docs.length };
}

module.exports = {
  loadArchiveMessages,
  appendLiveToSearchCache,
  searchChatArchive,
  getArchiveStats,
};
