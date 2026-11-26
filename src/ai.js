const fs = require('fs');
const path = require('path');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PERSONA_PATH = path.join(__dirname, '..', 'data', 'persona.txt');
const FACTS_PATH = path.join(__dirname, '..', 'data', 'facts.txt');
const EXAMPLES_PATH = path.join(__dirname, '..', 'data', 'examples.json');
const MAX_HISTORY_TURNS = 24;
const TOP_EXAMPLES_COUNT = 8;

const conversationHistory = new Map();

function isSasaSender(senderName) {
  const norm = String(senderName || '').trim().toLowerCase();
  return norm.includes('sasa') || norm.includes('shaul');
}

function sanitizeModelOutput(text, allowSa = true) {
  let out = String(text || '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]/g, '')
    .replace(/`{1,3}/g, '')
    .replace(/\*+([^*\n]+)\*+/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\bmaneh\b/gi, (m) => (m[0] === 'M' ? 'Meneh' : 'meneh'))
    .replace(/\bsing\b/gi, (m) => (m[0] === 'S' ? 'Sik' : 'sik'))
    .replace(/\b(?:enek|eneng|ana)\b/gi, (m) => (m[0] === 'E' || m[0] === 'A' ? 'Ono' : 'ono'))
    .replace(/\bkowe\b/gi, (m) => (m[0] === 'K' ? 'Koe' : 'koe'))
    .replace(/\bnapa\b/gi, (m) => (m[0] === 'N' ? 'Ngopo' : 'ngopo'))
    .replace(/\bpiye\b/gi, (m) => (m[0] === 'P' ? 'Pie' : 'pie'))
    .replace(/\bpodho\b/gi, (m) => (m[0] === 'P' ? 'Podo' : 'podo'))
    .replace(/\bdhewe\b/gi, (m) => (m[0] === 'D' ? 'Dewe' : 'dewe'))
    .replace(/\bawake\s+dewe\b/gi, (m) => (m[0] === 'A' ? 'Awakdewe' : 'awakdewe'))
    .replace(/\bdudu\b/gi, (m) => (m[0] === 'D' ? 'Udu' : 'udu'))
    .replace(/\bkuwi\b/gi, (m) => (m[0] === 'K' ? 'Kui' : 'kui'))
    .replace(/\bmulih\b/gi, (m) => (m[0] === 'M' ? 'Bali' : 'bali'))
    .replace(/\bmaeng\b/gi, (m) => (m[0] === 'M' ? 'Mau' : 'mau'))
    .replace(/\b(?:dhisik|disik)\b/gi, (m) => (m[0] === 'D' ? 'Sik' : 'sik'))
    .replace(/\bmung\b/gi, (m) => (m[0] === 'M' ? 'Gur' : 'gur'))
    .replace(/\butawa\b/gi, (m) => (m[0] === 'U' ? 'Po' : 'po'))
    .replace(/\bmenyang\b/gi, (m) => (m[0] === 'M' ? 'Ning' : 'ning'))
    .replace(/\bkenopo to\b/gi, (m) => (m[0] === 'K' ? 'Kenopo e' : 'kenopo e'));

  if (!allowSa) {
    out = out
      .replace(/,?\s+\bsa\b(?=[,.!?]|$)/gi, '')
      .replace(/^\bsa\b[,!\s]+/gim, '');
  }

  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Hydrate in-memory conversation history from persisted chat-log.jsonl on startup.
 * @param {string} logPath
 */
function hydrateHistoryFromLog(logPath) {
  try {
    if (!fs.existsSync(logPath)) return;
    const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-200);
    for (const line of tail) {
      try {
        const entry = JSON.parse(line);
        if (!entry?.jid || !entry?.incoming || !entry?.reply || entry.reply === '[READ_ONLY]') {
          continue;
        }
        const sender = String(entry.sender || '').replace(/[\[\]\r\n]/g, '').trim();
        const cleanReply = sanitizeModelOutput(entry.reply, isSasaSender(sender));
        if (!cleanReply) continue;
        const userText = sender ? `[${sender}]: ${entry.incoming}` : entry.incoming;
        appendHistory(entry.jid, userText, cleanReply);
      } catch {
        // skip malformed jsonl line
      }
    }
  } catch (err) {
    console.warn('[AI] Failed to hydrate history:', err.message);
  }
}

/**
 * Return candidate models in priority failover order (smartest first).
 * @returns {string[]}
 */
function getCandidateModels() {
  const rawList =
    process.env.GEMINI_MODELS ||
    process.env.GEMINI_MODEL ||
    'gemini-4-hydrogen,gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite';
  return Array.from(
    new Set(
      rawList
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    )
  );
}

/**
 * Evaluate incoming message using Gemini Decision 1 (POST /v1beta/decisions, 0 output tokens).
 * Fails open gracefully if unavailable or disabled.
 */
async function evaluateMessageDecisions(apiKey, recentContext, userMessage) {
  if (process.env.USE_DECISIONS_API === 'false') {
    return { isClosingAck: false, moneyAlert: false, urgentOrMeetupAlert: false };
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
              'Apakah pesan masuk terbaru HANYA konfirmasi penutup percakapan singkat (seperti ok, okd, sip, siap, yowis, udah) setelah topik selesai dan TIDAK mengandung pertanyaan atau topik baru?',
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
      return { isClosingAck: false, moneyAlert: false, urgentOrMeetupAlert: false };
    }

    const body = await res.json();
    const ack = body?.answers?.is_closing_ack;
    const money = body?.answers?.is_money_request;
    const urgent = body?.answers?.is_urgent_or_meetup;

    return {
      isClosingAck: Boolean(recentContext && ack?.noul >= 0.85 && ack?.confidence >= 0.75),
      moneyAlert: Boolean(money?.noul >= 0.75),
      urgentOrMeetupAlert: Boolean(urgent?.noul >= 0.75),
    };
  } catch {
    return { isClosingAck: false, moneyAlert: false, urgentOrMeetupAlert: false };
  }
}

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

function tokenize(text) {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

function pickRelevantExamples(userMessage, examples, limit = TOP_EXAMPLES_COUNT) {
  if (!examples.length) return [];

  const queryTokens = tokenize(userMessage);
  if (queryTokens.size === 0) {
    return examples.slice(-limit);
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

  scored.sort((a, b) => b.score - a.score || b.index - a.index);
  return scored.slice(0, limit).map((item) => item.ex);
}

function getHistory(jid) {
  if (!conversationHistory.has(jid)) {
    conversationHistory.set(jid, []);
  }
  return conversationHistory.get(jid);
}

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

  const candidateModels = getCandidateModels();
  const ownerName = process.env.OWNER_NAME || 'Ade';
  const safeSender = String(senderName || '').replace(/[\[\]\r\n]/g, '').trim();
  const allowSa = isSasaSender(safeSender);
  const history = getHistory(jid);
  const recentContext = history
    .slice(-6)
    .map((h) => h.parts?.[0]?.text || '')
    .filter(Boolean)
    .join('\n');

  const decision = await evaluateMessageDecisions(apiKey, recentContext, userMessage);

  const decisionAlerts = [];
  const modelTurns = history.filter((h) => h.role === 'model');

  const recentlyAskedFood = modelTurns
    .slice(-6)
    .some((h) => /\b(maem|mangan)\b/i.test(h.parts?.[0]?.text || ''));
  if (recentlyAskedFood) {
    decisionAlerts.push(
      'LARANGAN PENGULANGAN: Kamu sudah membahas soal makan ("maem/mangan") baru-baru ini. DILARANG menanyakan soal makan lagi.'
    );
  }

  const recentSaUsed = modelTurns
    .slice(-2)
    .some((h) => /\bsa\b/i.test(h.parts?.[0]?.text || ''));
  if (allowSa && recentSaUsed) {
    decisionAlerts.push(
      'REM SAPAAN: Kamu sudah memanggil "sa" di 2 balasan terakhir. JANGAN tulis kata "sa" di balasan ini.'
    );
  }

  const lastTwoModelTurns = modelTurns.slice(-2);
  const askedBackTwice =
    lastTwoModelTurns.length === 2 &&
    lastTwoModelTurns.every((h) => (h.parts?.[0]?.text || '').includes('?'));
  if (askedBackTwice && !decision.isClosingAck) {
    decisionAlerts.push(
      'REM WAWANCARA: 2 balasan terakhirmu berturut-turut diakhiri tanda tanya ("?"). Di balasan ini DILARANG memakai kalimat tanya ("?")—balas dengan pernyataan, opini tajam, reaksi santai, atau ledekan tipis saja!'
    );
  }

  if (decision.isClosingAck) {
    decisionAlerts.push(
      'CATATAN KONTEKS: Lawan bicara hanya membalas singkat/penutup ("ok", "sip", "udah", dll). Jangan biarkan obrolan mati—tanggapi singkat lalu lempar pancingan topik ringan baru yang natural.'
    );
  }
  if (decision.moneyAlert) {
    decisionAlerts.push(
      'PERINGATAN UANG: Tolak halus dan singkat permintaan pinjam/transfer uang (misal "waduh lg mepet ki"), JANGAN janji cek saldo/dompet.'
    );
  }
  if (decision.urgentOrMeetupAlert) {
    decisionAlerts.push(
      'PERINGATAN JANJIAN/DARURAT: Jangan mengiyakan jadwal ketemuan sepihak (tunda halus "durung iso janji, mengko tak kabari meneh") dan DILARANG pakai wkwk/bercanda jika kabar serius.'
    );
  }

  const persona = loadPersona();
  const facts = loadFacts();
  const examples = loadExamples();
  const exampleQuery = recentContext ? `${userMessage}\n${recentContext}` : userMessage;
  const topExamples = pickRelevantExamples(exampleQuery, examples, TOP_EXAMPLES_COUNT);

  const examplesBlock = topExamples.length
    ? `\n\nContoh asli cara ${ownerName} mengetik (tiru ritme pendek, campuran Indo + Ngoko Bantul, dan ke-to-the-point-annya):\n` +
      topExamples
        .map((ex, i) => {
          const cleanExReply = allowSa ? ex.reply : sanitizeModelOutput(ex.reply, false);
          return `${i + 1}. Lawan bicara: "${ex.input}"\n   ${ownerName}: "${cleanExReply}"`;
        })
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

  const senderContextLine = allowSa
    ? `Lawan bicara saat ini: ${safeSender} (teman akrabmu Sasa). Sapaan "sa" boleh dipakai sesekali saja (~1 dari 5 balasan).`
    : `Lawan bicara saat ini: ${safeSender || 'Teman'} (BUKAN Sasa — DILARANG KERAS memanggil "sa"!).`;

  const systemInstructionText = [
    `Kamu adalah ${ownerName}, membalas chat WhatsApp pribadi secara natural.`,
    `Waktu sekarang: ${nowWib} WIB.`,
    senderContextLine,
    facts
      ? `Memori & Fakta Hidup ${ownerName} (hanya gunakan sebagai latar belakang alami bila relevan, JANGAN dipaksa disebut berulang-ulang):\n${facts}`
      : '',
    persona,
    `Aturan Eksekusi Penting:`,
    `1. INGATAN PERCAKAPAN TAJAM: Baca seluruh riwayat chat di atas sebelum mengetik. DILARANG KERAS menanyakan ulang hal yang sudah disebutkan lawan bicara di riwayat (misal jika dia sudah bilang di rumah/sudah pulang/WFH, jangan tanya lagi dia di mana atau sudah pulang belum). Tanggapi seluruh isi bubble lawan bicara secara nyambung.`,
    `2. ANTI-ESAI & TETAP CERDAS: Saat diminta menjelaskan sesuatu atau ditanya opini (crypto, teknologi, laptop, isu sosial, film, dll), JANGAN mengelak "ra reti" dan JANGAN menulis esai formal panjang. Jelaskan langsung intinya dengan bahasa tongkrongan (campuran Bahasa Indonesia kasual + Jawa Ngoko Bantul) dalam 2–3 bubble pendek yang tajam dan masuk akal.`,
    `3. JANGAN MEMUTUS TOPIK: Kalau lawan bicara sedang antusias bahas suatu topik, ikuti dan dalami topiknya—DILARANG bilang "rasah dibahas jero-jero" atau menyudahi topik sepihak.`,
    `4. PAHAM SARKASME & SLANG: Pahami candaan hiperbola (misal "ning hutan terpencil" saat bercanda) dan slang seperti "pret" (artinya masa sih/bohong, BUKAN "prei"/libur), "mau" (tadi). Jangan pernah mengaku sebagai AI/bot/sistem.`,
    `5. OUTPUT MURNI CHAT WA: Hanya keluarkan teks balasan biasa (pisahkan antar-bubble dengan 1 baris baru "\\n"). DILARANG memakai tanda bintang markdown (*...*), bullet list, tag <...>, tanda hubung "—", atau prefix nama.`,
    ...decisionAlerts,
    examplesBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  const formattedUserText = safeSender ? `[${safeSender}]: ${userMessage}` : userMessage;

  const contents = [
    ...history,
    { role: 'user', parts: [{ text: formattedUserText }] },
  ];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ownerPrefixRe = new RegExp(`^\\[?${escapeRe(ownerName)}\\]?:\\s*`, 'i');
  const senderPrefixRe = safeSender
    ? new RegExp(`^\\[?${escapeRe(safeSender)}\\]?:\\s*`, 'i')
    : null;

  let replyText = '';
  let lastError = null;

  for (const model of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

    const requestBody = (withSearch) => ({
      systemInstruction: {
        parts: [{ text: systemInstructionText }],
      },
      contents,
      ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 1024,
      },
    });

    try {
      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody(true)),
        signal: AbortSignal.timeout(12000),
      });

      if (response.status === 400 || response.status === 403 || response.status === 429) {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey,
          },
          body: JSON.stringify(requestBody(false)),
          signal: AbortSignal.timeout(12000),
        });
      }

      if (!response.ok) {
        const errBody = await response.text();
        lastError = new Error(`Gemini API error (${response.status} on ${model}): ${errBody}`);
        if (response.status !== 503 && response.status !== 429 && response.status !== 404) {
          throw lastError;
        }
        continue;
      }

      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const rawReply = parts
        .filter((p) => p && typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('');

      let candidateReply = rawReply.replace(ownerPrefixRe, '');
      if (senderPrefixRe) {
        candidateReply = candidateReply.replace(senderPrefixRe, '');
      }
      candidateReply = sanitizeModelOutput(candidateReply, allowSa);

      if (!candidateReply) {
        lastError = new Error(`Gemini API mengembalikan respons kosong (${model}).`);
        continue;
      }

      replyText = candidateReply;
      break;
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

  if (!replyText) {
    throw lastError || new Error('Semua model Gemini gagal merespons.');
  }

  appendHistory(jid, formattedUserText, replyText);
  return replyText;
}

module.exports = {
  generateCloneReply,
  pickRelevantExamples,
  hydrateHistoryFromLog,
  sanitizeModelOutput,
};
