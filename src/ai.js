const fs = require('fs');
const path = require('path');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PERSONA_PATH = path.join(__dirname, '..', 'data', 'persona.txt');
const FACTS_PATH = path.join(__dirname, '..', 'data', 'facts.txt');
const EXAMPLES_PATH = path.join(__dirname, '..', 'data', 'examples.json');
const MAX_HISTORY_TURNS = 10;
const TOP_EXAMPLES_COUNT = 8;

const conversationHistory = new Map();
let roundRobinCursor = 0;

/**
 * Return the model list rotated in round-robin order to spread RPM load.
 * @returns {string[]}
 */
function getRotatedModels() {
  const rawList =
    process.env.GEMINI_MODELS ||
    process.env.GEMINI_MODEL ||
    'gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-4-hydrogen,gemini-3.8-flash,gemini-3.6-flash';
  const models = Array.from(
    new Set(
      rawList
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    )
  );
  if (models.length <= 1) return models;

  const start = roundRobinCursor % models.length;
  roundRobinCursor = (roundRobinCursor + 1) % models.length;
  return [...models.slice(start), ...models.slice(0, start)];
}

/**
 * Evaluate incoming message using Gemini Decision 1 (POST /v1beta/decisions, 0 output tokens).
 * Fails open gracefully if unavailable or disabled.
 * @param {string} apiKey
 * @param {string} recentContext
 * @param {string} userMessage
 * @returns {Promise<{skipReply: boolean, moneyAlert: boolean, urgentOrMeetupAlert: boolean}>}
 */
async function evaluateMessageDecisions(apiKey, recentContext, userMessage) {
  if (process.env.USE_DECISIONS_API === 'false') {
    return { skipReply: false, moneyAlert: false, urgentOrMeetupAlert: false };
  }

  try {
    const sharedInput = recentContext
      ? `Konteks chat terakhir:\n${recentContext}\n\nPesan masuk terbaru: "${userMessage}"`
      : `Pesan masuk terbaru: "${userMessage}"`;

    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/decisions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'gemini-decision-1',
        input: sharedInput,
        questions: {
          is_closing_ack: {
            type: 'noul',
            instructions:
              'Apakah pesan masuk terbaru HANYA konfirmasi penutup percakapan singkat (seperti ok, okd, sip, siap, yowis) setelah topik selesai dan TIDAK mengandung pertanyaan atau topik baru?',
          },
          is_money_request: {
            type: 'noul',
            instructions:
              'Apakah pengirim meminta pinjam uang, transfer uang, bayarin sesuatu, atau urusan finansial?',
          },
          is_urgent_or_meetup: {
            type: 'noul',
            instructions:
              'Apakah pengirim mengajak ketemuan fisik/janjian waktu tertentu atau mengabarkan berita darurat/duka/sakit serius?',
          },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { skipReply: false, moneyAlert: false, urgentOrMeetupAlert: false };
    }

    const body = await res.json();
    const ack = body?.answers?.is_closing_ack;
    const money = body?.answers?.is_money_request;
    const urgent = body?.answers?.is_urgent_or_meetup;

    return {
      skipReply: Boolean(recentContext && ack?.noul >= 0.88 && ack?.confidence >= 0.8),
      moneyAlert: Boolean(money?.noul >= 0.75),
      urgentOrMeetupAlert: Boolean(urgent?.noul >= 0.75),
    };
  } catch {
    return { skipReply: false, moneyAlert: false, urgentOrMeetupAlert: false };
  }
}

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
 * Load real-life facts and current schedule context from data/facts.txt.
 * @returns {string}
 */
function loadFacts() {
  try {
    if (fs.existsSync(FACTS_PATH)) {
      return fs.readFileSync(FACTS_PATH, 'utf8').trim();
    }
  } catch (err) {
    console.warn('[AI] Failed to read facts.txt:', err.message);
  }
  return '';
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

  const candidateModels = getRotatedModels();
  const ownerName = process.env.OWNER_NAME || 'Ad';
  const history = getHistory(jid);
  const recentContext = history
    .slice(-4)
    .map((h) => h.parts?.[0]?.text || '')
    .filter(Boolean)
    .join('\n');

  const decision = await evaluateMessageDecisions(apiKey, recentContext, userMessage);
  if (decision.skipReply) {
    return '';
  }

  const decisionAlerts = [];
  if (decision.moneyAlert) {
    decisionAlerts.push(
      'PERINGATAN DECISIONS API: Pesan ini terdeteksi membahas pinjam/transfer uang! Wajib tolak halus singkat (misal "waduh lg mepet ki"), JANGAN janji cek saldo/dompet.'
    );
  }
  if (decision.urgentOrMeetupAlert) {
    decisionAlerts.push(
      'PERINGATAN DECISIONS API: Pesan ini terdeteksi mengajak janjian ketemuan atau kabar darurat/serius! Jangan mengiyakan jadwal sepihak (tunda halus "durung iso janji, ntar tak kabari meneh") dan DILARANG pakai wkwk/bercanda.'
    );
  }

  const persona = loadPersona();
  const facts = loadFacts();
  const examples = loadExamples();
  const topExamples = pickRelevantExamples(userMessage, examples, TOP_EXAMPLES_COUNT);

  const examplesBlock = topExamples.length
    ? `\n\nContoh gaya balasan ${ownerName} (ikuti persis gaya bahasa, panjang, slang, dan tanda bacanya):\n` +
      topExamples
        .map((ex, i) => `${i + 1}. Lawan bicara: "${ex.input}"\n   ${ownerName}: "${ex.reply}"`)
        .join('\n')
    : '';

  const nowWib = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  const systemInstructionText = [
    `Kamu adalah kloningan chat WhatsApp dari ${ownerName}.`,
    `Konteks waktu saat ini: ${nowWib} WIB.`,
    facts ? `Fakta Nyata ${ownerName} (WAJIB dipatuhi sebagai kebenaran):\n${facts}` : '',
    `Persona ${ownerName}:\n${persona}`,
    `Aturan ketat anti-kaku & dialek murni Bantul/Jogja:`,
    `1. DIALEK MURNI BANTUL/JOGJA: Wajib pakai "ono/raono" (DILARANG "enek/ana"), "wae" (DILARANG "ae"), "meneh" (DILARANG "maneh"), "sik" untuk arti yang/dulu (DILARANG "sek/sing/yg"), "ning" untuk di/ke (DILARANG "neng/nang/ng", kecuali kata tanya "nengdi/nangdi"), "pie" (DILARANG "piye/gimana"), "nik/nek" (DILARANG "kalau/kalo"), "ra/ora" atau sesekali "ga" (DILARANG "gak/nggak"), "udu" (DILARANG "bukan/dudu"), "ro/karo" (DILARANG "sama" untuk arti dengan, dan jangan jawab "Sama sama"—pakai "yo aman" / "sip" / "podo podo"), "kek e / ketoke" (DILARANG "koyoke"), "ra reti / ra ngerti" (hindari "drng reti blas"). Untuk bertanya kenapa, gunakan nada ramah seperti "kenopo e" atau "ngopo e" (JANGAN pakai "kenopo to" karena terkesan sengak/galak). JANGAN pakai kata Sunda "sok" untuk arti silakan (di Jogja "sok" artinya besok/kadang), dan gunakan "maem" alih-alih "mangane". Akhiran "-e" untuk kata berakhiran konsonan ("driver e", bukan "driver ne").`,
    `2. REM KERAS "wkwk" & SAPAAN "sa": Di data asli, >96% chat TANPA tawa! DILARANG menaruh "wkwk/haha/hehe" kecuali benar-benar ada lelucon kocak (maksimal 1 dari 8-10 balasan, dan 0% wkwk saat bahas teknis/serius). DILARANG menulis "sa" di setiap balasan beruntun—hanya pakai sesekali (~1 dari 4-5 giliran, misal di sapaan awal saja; jika di riwayat 2 balasan terakhir sudah ada "sa", JANGAN tulis "sa" lagi!).`,
    `3. RITME MULTI-BUBBLE & AKTIF NGOBROL (TIDAK PASIF): Variasikan antara 1 baris singkat (2-7 kata) dan sesekali 2-3 bubble pendek dipisah baris baru (seperti gaya chat asli di file ekspor). Jangan pasif hanya menjawab datar—jika obrolan masih terbuka, sesekali lempar pertanyaan balik atau pancing topik ringan (misal "koe tudey ngopo wae", "kuliah offline po online", "aman po skripsine"). Saat dimintai bantuan teknis (laptop/wifi/coding), tetap beri 1 langkah praktis singkat per giliran tanpa alasan "Biasane...".`,
    `4. TANGKAP KONTEKS PRAGMATIS & ANTI-HALUSINASI: Baca alur percakapan dengan cerdas (misal jika lawan bicara bilang "enak tenan po b aja" setelah menyebut nama seperti "Cak San", pahami itu tempat makan; jika bilang "tak golek maem sik", artinya baru mau cari makan, jangan disuruh "dipangan" sekarang). Jangan pernah mengarang nama warung/jalan fiktif atau cerita palsu. Cek juga jam WIB sekarang (${nowWib} WIB) dan koreksi santai bila lawan bicara salah sebut jam/hari.`,
    `5. GUARDRAIL UANG & JANJIAN: Jika diajak ketemuan mendadak atau dimintai pinjam/transfer uang, tolak halus atau tunda tegas tanpa menanyakan jam/tempat janjian dan tanpa janji cek dompet.`,
    `6. Output HANYA teks balasan chat biasa: DILARANG menyertakan tag XML/HTML (<...>), markdown, tanda hubung kaku pada kata ulang ("alon alon" bukan "alon-alon"), atau prefix nama.`,
    ...decisionAlerts,
    examplesBlock,
  ]
    .filter(Boolean)
    .join('\n');

  const safeSender = String(senderName || '').replace(/[\[\]\r\n]/g, '').trim();
  const formattedUserText = safeSender ? `[${safeSender}]: ${userMessage}` : userMessage;

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: formattedUserText }] },
  ];

  let data = null;
  let lastError = null;

  for (const model of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstructionText }],
          },
          contents,
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 500,
          },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        data = await response.json();
        break;
      }

      const errBody = await response.text();
      lastError = new Error(`Gemini API error (${response.status} on ${model}): ${errBody}`);
      if (response.status !== 503 && response.status !== 429 && response.status !== 404) {
        throw lastError;
      }
    } catch (err) {
      if (
        err.name === 'TimeoutError' ||
        err.name === 'AbortError' ||
        err instanceof TypeError
      ) {
        lastError = new Error(`Network/timeout on ${model}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  if (!data) {
    throw lastError || new Error('Semua model Gemini gagal merespons.');
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const rawReply = parts
    .filter((p) => p && typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('\n');

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ownerPrefixRe = new RegExp(`^\\[?${escapeRe(ownerName)}\\]?:\\s*`, 'i');
  const senderPrefixRe = safeSender
    ? new RegExp(`^\\[?${escapeRe(safeSender)}\\]?:\\s*`, 'i')
    : null;

  let replyText = rawReply
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/`{1,3}/g, '')
    .replace(ownerPrefixRe, '');

  if (senderPrefixRe) {
    replyText = replyText.replace(senderPrefixRe, '');
  }

  replyText = replyText
    .replace(/\bmaneh\b/gi, (m) => (m[0] === 'M' ? 'Meneh' : 'meneh'))
    .replace(/\bsing\b/gi, (m) => (m[0] === 'S' ? 'Sik' : 'sik'))
    .replace(/\b(?:enek|eneng)\b/gi, (m) => (m[0] === 'E' ? 'Ono' : 'ono'))
    .replace(/\bpiye\b/gi, (m) => (m[0] === 'P' ? 'Pie' : 'pie'))
    .replace(/\bkenopo to\b/gi, (m) => (m[0] === 'K' ? 'Kenopo e' : 'kenopo e'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();

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
