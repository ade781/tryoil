const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PERSONA_PATH = path.join(__dirname, '..', 'data', 'persona.txt');
const EXAMPLES_PATH = path.join(__dirname, '..', 'data', 'examples.json');
const MAX_HISTORY_TURNS = 10;
const TOP_EXAMPLES_COUNT = 6;

const conversationHistory = new Map();

/**
 * Load owner persona prompt from data/persona.txt.
 * @returns {string}
 */
function loadPersona() {
  try {
    if (fs.existsSync(PERSONA_PATH)) {
      const content = fs.readFileSync(PERSONA_PATH, 'utf8').trim();
      if (content) return content;
    }
  } catch (err) {
    console.warn('[AI] Failed to read persona.txt:', err.message);
  }
  return 'Balas chat WhatsApp dengan gaya santai, singkat, dan natural seperti manusia.';
}

/**
 * Load few-shot examples from data/examples.json.
 * @returns {Array<{input: string, reply: string}>}
 */
function loadExamples() {
  try {
    if (fs.existsSync(EXAMPLES_PATH)) {
      const raw = fs.readFileSync(EXAMPLES_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            input: typeof item?.input === 'string' ? item.input : item?.user,
            reply: typeof item?.reply === 'string' ? item.reply : item?.assistant,
          }))
          .filter((item) => typeof item.input === 'string' && typeof item.reply === 'string');
      }
    }
  } catch (err) {
    console.warn('[AI] Failed to read examples.json:', err.message);
  }
  return [];
}

/**
 * Tokenize text into normalized lowercase keywords.
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

/**
 * Pick top N most relevant few-shot examples using keyword-overlap scoring.
 * @param {string} userMessage
 * @param {Array<{input: string, reply: string}>} examples
 * @param {number} limit
 * @returns {Array<{input: string, reply: string}>}
 */
function pickRelevantExamples(userMessage, examples, limit = TOP_EXAMPLES_COUNT) {
  if (!examples.length) return [];

  const queryTokens = tokenize(userMessage);
  if (queryTokens.size === 0) {
    return examples.slice(0, limit);
  }

  const scored = examples.map((ex, index) => {
    const exTokens = tokenize(ex.input);
    let overlap = 0;
    for (const token of queryTokens) {
      if (exTokens.has(token)) overlap += 1;
    }
    const unionSize = queryTokens.size + exTokens.size - overlap;
    const jaccard = unionSize > 0 ? overlap / unionSize : 0;
    return { ex, score: overlap + jaccard, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((item) => item.ex);
}

/**
 * Get and trim conversation history for a JID.
 * @param {string} jid
 * @returns {Array<{role: string, parts: Array<{text: string}>}>}
 */
function getHistory(jid) {
  if (!conversationHistory.has(jid)) {
    conversationHistory.set(jid, []);
  }
  return conversationHistory.get(jid);
}

/**
 * Append a user+model turn to history and trim to MAX_HISTORY_TURNS.
 * @param {string} jid
 * @param {string} userText
 * @param {string} modelText
 */
function appendHistory(jid, userText, modelText) {
  const history = getHistory(jid);
  history.push(
    { role: 'user', parts: [{ text: userText }] },
    { role: 'model', parts: [{ text: modelText }] }
  );

  const maxEntries = MAX_HISTORY_TURNS * 2;
  if (history.length > maxEntries) {
    conversationHistory.set(jid, history.slice(-maxEntries));
  }
}

/**
 * Generate a WhatsApp clone reply via Gemini generateContent REST API.
 * @param {string} jid
 * @param {string} senderName
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function generateCloneReply(jid, senderName, userMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'isi_api_key_gemini_disini') {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi di .env');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const ownerName = process.env.OWNER_NAME || 'Ad';

  const persona = loadPersona();
  const examples = loadExamples();
  const topExamples = pickRelevantExamples(userMessage, examples, TOP_EXAMPLES_COUNT);

  const examplesBlock = topExamples.length
    ? `\n\nContoh gaya balasan ${ownerName} (ikuti persis gaya bahasa, panjang, slang, dan tanda bacanya):\n` +
      topExamples
        .map((ex, i) => `${i + 1}. Lawan bicara: "${ex.input}"\n   ${ownerName}: "${ex.reply}"`)
        .join('\n')
    : '';

  const systemInstructionText = [
    `Kamu adalah kloningan chat WhatsApp dari ${ownerName}.`,
    `Persona ${ownerName}:\n${persona}`,
    `Aturan ketat:`,
    `- Balas secara natural dengan gaya ketikan, panjang kalimat, bahasa gaul/slang, huruf kapital, dan tanda baca yang persis sama dengan ${ownerName}.`,
    `- Jangan pernah mengaku sebagai AI, bot, atau asisten virtual kecuali ditanya dengan sangat serius.`,
    `- Jaga balasan tetap singkat dan padat seperti chat WhatsApp sungguhan (tidak bertele-tele atau format list panjang).`,
    examplesBlock,
  ]
    .filter(Boolean)
    .join('\n');

  const formattedUserText = senderName ? `[${senderName}]: ${userMessage}` : userMessage;
  const history = getHistory(jid);

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: formattedUserText }] },
  ];

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstructionText }],
      },
      contents,
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 300,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!replyText) {
    throw new Error('Gemini API mengembalikan respons kosong.');
  }

  appendHistory(jid, formattedUserText, replyText);
  return replyText;
}

module.exports = {
  generateCloneReply,
  pickRelevantExamples,
};
