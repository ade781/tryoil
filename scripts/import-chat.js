#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const EXAMPLES_PATH = path.join(DATA_DIR, 'examples.json');
const PERSONA_PATH = path.join(DATA_DIR, 'persona.txt');
const ARCHIVE_PATH = path.join(DATA_DIR, 'chat-archive.jsonl');

const MAX_EXAMPLES = 3000;

// Karakter tak terlihat yang sering disisipkan WhatsApp (LTR/RTL mark, BOM, dll.)
const INVISIBLE_CHARS_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

// Pola header pesan WhatsApp Android & iOS
// Android: "12/05/24, 14.30 - Budi: halo" atau "12/05/2024, 14:30 - Budi: halo" (juga dukung AM/PM & detik opsional)
const ANDROID_LINE_RE =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:\s?[APap][Mm])?)\s+-\s+(.*)$/;
// iOS: "[12/05/24, 14.30.15] Budi: halo" atau "[12/05/2024, 14:30:15] Budi: halo"
const IOS_LINE_RE =
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:\s?[APap][Mm])?)\]\s+(.*)$/;

// Pesan media, terhapus, atau sistem yang harus disaring
const IGNORED_MESSAGE_PATTERNS = [
  /^<media omitted>$/i,
  /^<?media tidak disertakan>?$/i,
  /^image omitted$/i,
  /^video omitted$/i,
  /^audio omitted$/i,
  /^sticker omitted$/i,
  /^gif omitted$/i,
  /^document omitted$/i,
  /^contact card omitted$/i,
  /^gambar tidak disertakan$/i,
  /^video tidak disertakan$/i,
  /^audio tidak disertakan$/i,
  /^stiker tidak disertakan$/i,
  /^dokumen tidak disertakan$/i,
  /^kartu kontak tidak disertakan$/i,
  /^this message was deleted\.?$/i,
  /^you deleted this message\.?$/i,
  /^pesan ini telah dihapus\.?$/i,
  /^pesan ini dihapus\.?$/i,
  /^anda telah menghapus pesan ini\.?$/i,
  /^waiting for this message\.?$/i,
  /^menunggu pesan ini\.?$/i,
  /^missed voice call$/i,
  /^missed video call$/i,
  /^panggilan suara tak terjawab$/i,
  /^panggilan video tak terjawab$/i,
  /^null$/i,
];

const EDITED_TAG_RE = /\s*<(?:This message was edited|Pesan ini diedit)>\s*$/i;

const TRACKED_PARTICLES = [
  'yg', 'ga', 'gak', 'nggak', 'enggak', 'gw', 'gue', 'aku', 'aq', 'lu', 'lo',
  'kamu', 'km', 'oke', 'ok', 'sip', 'siap', 'jir', 'anjir', 'bjir', 'wkwk',
  'haha', 'hehe', 'dong', 'sih', 'nih', 'tuh', 'deh', 'kan', 'ya', 'yah',
  'yuk', 'otw', 'bentar', 'bgt', 'banget', 'aja', 'doang', 'kalo', 'kalau',
  'udah', 'udh', 'belum', 'blm', 'gimana', 'gmn', 'kenapa', 'knp', 'makasih',
  'thx', 'tp', 'tapi', 'bisa', 'bs', 'mau', 'lg', 'lagi', 'nih', 'deh',
];

function loadEnvOwnerName() {
  if (process.env.OWNER_NAME && process.env.OWNER_NAME.trim()) {
    return process.env.OWNER_NAME.trim();
  }

  const envCandidates = [
    path.join(ROOT_DIR, '.env'),
    path.join(process.cwd(), '.env'),
  ];

  for (const envPath of envCandidates) {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^OWNER_NAME\s*=\s*(.*)$/);
      if (match) {
        let val = match[1].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (val.trim()) return val.trim();
      }
    }
  }
  return '';
}

function printUsage() {
  console.log(`
Penggunaan:
  node scripts/import-chat.js <path-ke-chat.txt> [nama-wa-kamu]

Keterangan:
  <path-ke-chat.txt>  Path menuju file ekspor chat WhatsApp (.txt)
  [nama-wa-kamu]      Nama tampilan WhatsApp kamu persis seperti di file ekspor.
                      Jika dikosongkan, script akan membaca OWNER_NAME dari .env.

Contoh:
  node scripts/import-chat.js ./chat-teman.txt "Budi Santoso"
  node scripts/import-chat.js ./chat-teman.txt
`.trim());
}

function isIgnoredBody(text) {
  const cleaned = text.replace(EDITED_TAG_RE, '').trim();
  if (!cleaned) return true;
  return IGNORED_MESSAGE_PATTERNS.some((re) => re.test(cleaned));
}

function cleanMessageText(text) {
  return text.replace(EDITED_TAG_RE, '').trim();
}

function parseWhatsAppExport(content) {
  const lines = content.split(/\r?\n/);
  const rawMessages = [];
  let current = null;
  let totalParsedLines = 0;
  let systemLinesCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(INVISIBLE_CHARS_RE, '');
    const match = line.match(ANDROID_LINE_RE) || line.match(IOS_LINE_RE);

    if (match) {
      totalParsedLines++;
      if (current) {
        rawMessages.push(current);
        current = null;
      }

      const bodyPart = match[3];
      const colonIdx = bodyPart.indexOf(': ');

      if (colonIdx === -1) {
        // Baris sistem (enkripsi, grup dibuat, anggota keluar/masuk, dll.)
        systemLinesCount++;
        current = null;
        continue;
      }

      const sender = bodyPart.slice(0, colonIdx).trim();
      const text = bodyPart.slice(colonIdx + 2);

      current = {
        date: match[1],
        time: match[2],
        sender,
        text,
      };
    } else if (current) {
      // Baris lanjutan dari pesan multi-baris
      current.text += '\n' + line;
    }
  }

  if (current) {
    rawMessages.push(current);
  }

  let filteredOutCount = 0;
  const messages = [];

  for (const msg of rawMessages) {
    if (msg.date === '11/25/26' || msg.date === '11/25/2026' || msg.text.includes('\u200b')) {
      filteredOutCount++;
      continue;
    }
    const cleaned = cleanMessageText(msg.text);
    if (isIgnoredBody(cleaned)) {
      filteredOutCount++;
      continue;
    }
    messages.push({
      date: msg.date,
      time: msg.time,
      sender: msg.sender,
      text: cleaned,
    });
  }

  return {
    messages,
    totalParsedLines,
    systemLinesCount,
    filteredOutCount,
  };
}

function mergeConsecutiveTurns(messages, ownerLower) {
  const turns = [];
  for (const msg of messages) {
    const isOwner = msg.sender.toLowerCase() === ownerLower;
    const role = isOwner ? 'owner' : `other:${msg.sender.toLowerCase()}`;

    const last = turns[turns.length - 1];
    if (last && last.role === role && last.parts.length < 3) {
      last.parts.push(msg.text);
    } else {
      turns.push({
        role,
        isOwner,
        sender: msg.sender,
        parts: [msg.text],
      });
    }
  }

  return turns.map((t) => ({
    isOwner: t.isOwner,
    sender: t.sender,
    text: t.parts.join('\n').trim(),
  }));
}

function isCleanPair(userText, assistantText) {
  if (!userText || !assistantText) return false;
  if (userText.length < 2 || assistantText.length < 2) return false;
  if (userText.length > 400 || assistantText.length > 400) return false;
  // Hindari pesan yang isinya hanya link mentah
  const urlOnlyRe = /^https?:\/\/\S+$/i;
  if (urlOnlyRe.test(userText) || urlOnlyRe.test(assistantText)) return false;
  return true;
}

function buildQaPairs(turns) {
  const pairs = [];
  const seen = new Set();

  for (let i = 0; i < turns.length - 1; i++) {
    const curr = turns[i];
    const next = turns[i + 1];

    if (!curr.isOwner && next.isOwner) {
      const user = curr.text;
      const assistant = next.text;
      if (!isCleanPair(user, assistant)) continue;

      const dedupKey = `${user.toLowerCase()}|||${assistant.toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      pairs.push({ user, assistant });
    }
  }

  // Ambil hingga 300 pasangan terbaik (prioritaskan yang lebih baru jika > 300)
  if (pairs.length > MAX_EXAMPLES) {
    return pairs.slice(pairs.length - MAX_EXAMPLES);
  }
  return pairs;
}

function analyzeOwnerStyle(ownerMessages) {
  const total = ownerMessages.length;
  if (total === 0) {
    return null;
  }

  let totalChars = 0;
  let totalWords = 0;
  let allLowerCount = 0;
  let startsLowerCount = 0;
  let startsUpperCount = 0;
  let endsWithPeriod = 0;
  let hasQuestion = 0;
  let hasExclamation = 0;
  let hasEllipsis = 0;
  let hasLaugh = 0;
  let hasEmoji = 0;

  const particleCounts = Object.create(null);
  const wordCounts = Object.create(null);
  const bigramCounts = Object.create(null);
  const emojiRe = /[\p{Extended_Pictographic}]/u;
  const laughRe = /\b(?:wkwk+|wk+|haha+|hehe+|hihi+)\b/i;

  for (const text of ownerMessages) {
    totalChars += text.length;
    const words = text.trim().split(/\s+/).filter(Boolean);
    totalWords += words.length;

    const hasLetters = /[a-zA-Z]/.test(text);
    if (hasLetters) {
      if (text === text.toLowerCase()) allLowerCount++;
      const firstLetterMatch = text.match(/[a-zA-Z]/);
      if (firstLetterMatch) {
        if (firstLetterMatch[0] === firstLetterMatch[0].toLowerCase()) {
          startsLowerCount++;
        } else {
          startsUpperCount++;
        }
      }
    }

    if (/\.$/.test(text.trim()) && !/\.\.\.$/.test(text.trim())) endsWithPeriod++;
    if (text.includes('?')) hasQuestion++;
    if (text.includes('!')) hasExclamation++;
    if (text.includes('...')) hasEllipsis++;
    if (laughRe.test(text)) hasLaugh++;
    if (emojiRe.test(text)) hasEmoji++;

    const tokens = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (TRACKED_PARTICLES.includes(tok)) {
        particleCounts[tok] = (particleCounts[tok] || 0) + 1;
      }
      if (tok.length >= 2 && !/^https?$/.test(tok)) {
        wordCounts[tok] = (wordCounts[tok] || 0) + 1;
      }
      if (i < tokens.length - 1) {
        const next = tokens[i + 1];
        if (tok.length >= 2 && next.length >= 2 && !/^https?$/.test(tok) && !/^https?$/.test(next)) {
          const bg = `${tok} ${next}`;
          bigramCounts[bg] = (bigramCounts[bg] || 0) + 1;
        }
      }
    }
  }

  const pct = (n) => Math.round((n / total) * 100);

  const topParticles = Object.entries(particleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const topWords = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const topBigrams = Object.entries(bigramCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // Pilih frasa representatif per kategori situasi
  const cleanSingles = ownerMessages.filter(
    (t) => t.length >= 6 && t.length <= 120 && !/https?:\/\//i.test(t) && !t.includes('\n')
  );
  const pickByFilter = (fn, max = 6) => {
    const matched = cleanSingles.filter(fn);
    const out = [];
    const seen = new Set();
    const step = Math.max(1, Math.floor(matched.length / (max * 2)));
    for (let i = 0; i < matched.length && out.length < max; i += step) {
      const s = matched[i].trim();
      const k = s.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(s);
      }
    }
    return out;
  };

  const sampleQuestions = pickByFilter((t) => t.includes('?'), 6);
  const sampleLaughs = pickByFilter((t) => laughRe.test(t), 6);
  const sampleGeneral = pickByFilter((t) => t.length >= 15 && !t.includes('?'), 8);

  return {
    total,
    avgChars: Math.round(totalChars / total),
    avgWords: (totalWords / total).toFixed(1),
    allLowerPct: pct(allLowerCount),
    startsLowerPct: pct(startsLowerCount),
    startsUpperPct: pct(startsUpperCount),
    endsWithPeriodPct: pct(endsWithPeriod),
    hasQuestionPct: pct(hasQuestion),
    hasExclamationPct: pct(hasExclamation),
    hasEllipsisPct: pct(hasEllipsis),
    hasLaughPct: pct(hasLaugh),
    hasEmojiPct: pct(hasEmoji),
    topParticles,
    topWords,
    topBigrams,
    sampleQuestions,
    sampleLaughs,
    samples: sampleGeneral,
  };
}

function buildPersonaText(ownerName, stats) {
  const caseRule =
    stats.allLowerPct >= 65
      ? `Dominan huruf kecil semua (${stats.allLowerPct}% pesan all-lowercase); hindari huruf kapital formal kecuali benar-benar perlu.`
      : stats.startsUpperPct >= 60
        ? `Sering memulai kalimat dengan huruf kapital (${stats.startsUpperPct}%), namun tetap santai.`
        : `Campuran huruf kecil (${stats.startsLowerPct}%) dan huruf kapital di awal kalimat (${stats.startsUpperPct}%).`;

  const lengthRule =
    stats.avgChars <= 35
      ? `Sangat singkat & to-the-point (rata-rata ${stats.avgChars} karakter / ${stats.avgWords} kata per pesan). Balas ringkas, jangan bertele-tele.`
      : stats.avgChars <= 80
        ? `Cukup singkat & natural seperti chat harian (rata-rata ${stats.avgChars} karakter / ${stats.avgWords} kata per pesan).`
        : `Cenderung agak panjang/deskriptif (rata-rata ${stats.avgChars} karakter / ${stats.avgWords} kata per pesan).`;

  const periodRule =
    stats.endsWithPeriodPct <= 15
      ? `Jarang mengakhiri pesan dengan titik (${stats.endsWithPeriodPct}%), lebih sering tanpa titik di akhir.`
      : `Cukup sering memakai titik di akhir kalimat (${stats.endsWithPeriodPct}%).`;

  const particleList =
    stats.topParticles.length > 0
      ? stats.topParticles.map(([w, c]) => `${w} (${c}x)`).join(', ')
      : 'tidak ada partikel dominan yang terdeteksi';

  const topWordList =
    stats.topWords.length > 0
      ? stats.topWords.map(([w, c]) => `${w} (${c}x)`).join(', ')
      : '-';

  const topBigramList =
    stats.topBigrams && stats.topBigrams.length > 0
      ? stats.topBigrams.map(([w, c]) => `"${w}" (${c}x)`).join(', ')
      : '-';

  const sampleLines =
    stats.samples.length > 0
      ? stats.samples.map((s) => `- "${s}"`).join('\n')
      : '- (Belum ada sampel representatif)';

  const questionLines =
    stats.sampleQuestions && stats.sampleQuestions.length > 0
      ? stats.sampleQuestions.map((s) => `- "${s}"`).join('\n')
      : '- (Belum ada sampel)';

  const laughLines =
    stats.sampleLaughs && stats.sampleLaughs.length > 0
      ? stats.sampleLaughs.map((s) => `- "${s}"`).join('\n')
      : '- (Belum ada sampel)';

  return `# Persona WhatsApp Clone: ${ownerName}
# Dihasilkan otomatis oleh scripts/import-chat.js dari ${stats.total} pesan organik murni.

Kamu membalas chat WhatsApp sebagai **${ownerName}**.
Balas pesan dengan gaya bahasa Indonesia + Jawa Ngoko Bantul/Jogja kasual yang natural, manusiawi, dan meniru kebiasaan mengetik berikut:

## Ringkasan Gaya Ketik & Ritme
- Panjang pesan: ${lengthRule} Utamakan 1 baris singkat (2–7 kata); jangan memaksakan format 2 baris terus-menerus.
- Kapitalisasi: ${caseRule} Kata ulang ditulis spasi biasa tanpa tanda hubung ("alon alon", "konco konco", bukan "alon-alon").
- Tanda baca: ${periodRule} Tanya (${stats.hasQuestionPct}%), seru (${stats.hasExclamationPct}%).
- Frekuensi tawa SANGAT JARANG: Lebih dari 96% pesan TANPA tawa! wkwk/hehe hanya sekitar ${stats.hasLaughPct}% pesan. DILARANG menaruh "wkwk" di ujung kalimat biasa atau saat menjelaskan hal teknis/serius.
- Frekuensi sapaan "sa": Hanya muncul di ~12% pesan (~1 dari 4–5 giliran). JANGAN menyebut "sa" terus-menerus di setiap balasan beruntun.

## Kosakata, Partikel & Aturan Dialek Murni Bantul/Jogja
- Wajib pakai kosakata asli ${ownerName}: "ono/raono" (BUKAN enek/ana), "wae" (BUKAN ae), "sik" untuk arti yang/dulu (BUKAN sek/sing/yg), "ning" untuk di/ke (BUKAN neng/ng, kecuali kata tanya "nengdi/nangdi"), "pie" (BUKAN piye/gimana), "nik/nek" (BUKAN kalau/kalo), "ra/ora" (BUKAN gak/nggak), "udu" (BUKAN bukan/dudu), "ro/karo" (BUKAN sama), "kek e / ketoke" (BUKAN koyoke), "ra reti / ra ngerti" (BUKAN drng reti blas).
- Catatan arti Jawa: kata "mau" di chat ${ownerName} mayoritas berarti "tadi" ("mau esuk" = tadi pagi), sedangkan "ingin" = "meh" atau "pengen".
- Kata paling sering muncul: ${topWordList}
- Frasa 2-kata khas (bigram): ${topBigramList}

## Gaya Saat Membantu Teknis / Menjelaskan Sesuatu
- Taktis, langsung 1 langkah singkat per balasan atau tanya balik singkat ("Pojok kiri bawah iku", "Klik kanan terus disable sik", "Iso ga?").
- DILARANG memborong 3 solusi sekaligus dan DILARANG mengulang kalimat alasan teknis "Biasane kadang error..." ala customer service. Tanpa wkwk tempelan!

## Contoh Gaya Kalimat Asli (Umum)
${sampleLines}

## Contoh Gaya Saat Bertanya Balik
${questionLines}
`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const archiveOnly = args.includes('--archive-only');
  const positionalArgs = args.filter((a) => !a.startsWith('--'));

  const chatFilePath = path.resolve(process.cwd(), positionalArgs[0] || '');
  if (!positionalArgs[0] || !fs.existsSync(chatFilePath)) {
    console.error(`[ERROR] File chat tidak ditemukan: ${chatFilePath}`);
    process.exit(1);
  }

  const ownerName = (positionalArgs[1] || loadEnvOwnerName()).trim();
  if (!ownerName) {
    console.error(
      '[ERROR] Nama WhatsApp pemilik tidak ditemukan.\n' +
        'Berikan sebagai argumen ke-2: node scripts/import-chat.js <chat.txt> "Nama Kamu"\n' +
        'Atau isi OWNER_NAME="Nama Kamu" di file .env.'
    );
    process.exit(1);
  }

  const rawContent = fs.readFileSync(chatFilePath, 'utf8');
  const parsed = parseWhatsAppExport(rawContent);
  const ownerLower = ownerName.toLowerCase();

  const ownerMessages = parsed.messages
    .filter((m) => m.sender.toLowerCase() === ownerLower)
    .map((m) => m.text);

  if (ownerMessages.length === 0) {
    const senders = [...new Set(parsed.messages.map((m) => m.sender))].slice(0, 10);
    console.error(
      `[ERROR] Tidak ditemukan pesan dari "${ownerName}" di file chat tersebut.\n` +
        `Pengirim yang terdeteksi (maks 10): ${senders.length ? senders.join(', ') : '(kosong)'}`
    );
    process.exit(1);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const archiveLines = parsed.messages.map((m, idx) =>
    JSON.stringify({
      id: idx + 1,
      date: m.date,
      time: m.time,
      sender: m.sender,
      isOwner: m.sender.toLowerCase() === ownerLower,
      text: m.text,
    })
  );
  fs.writeFileSync(ARCHIVE_PATH, archiveLines.join('\n') + '\n', 'utf8');

  if (archiveOnly) {
    console.log(`=== Arsip Chat Diperbarui (--archive-only) ===`);
    console.log(`File sumber : ${chatFilePath}`);
    console.log(`Total pesan : ${parsed.messages.length} (disimpan ke ${ARCHIVE_PATH})`);
    return;
  }

  const turns = mergeConsecutiveTurns(parsed.messages, ownerLower);
  const qaPairs = buildQaPairs(turns);
  const stats = analyzeOwnerStyle(ownerMessages);
  const personaText = buildPersonaText(ownerName, stats);

  fs.writeFileSync(EXAMPLES_PATH, JSON.stringify(qaPairs, null, 2) + '\n', 'utf8');
  fs.writeFileSync(PERSONA_PATH, personaText, 'utf8');

  console.log('=== Ringkasan Impor Chat WhatsApp ===');
  console.log(`File sumber        : ${chatFilePath}`);
  console.log(`Pemilik (Owner)    : ${ownerName}`);
  console.log(`Baris pesan terbaca: ${parsed.totalParsedLines}`);
  console.log(`Baris sistem       : ${parsed.systemLinesCount}`);
  console.log(`Media/dihapus skip : ${parsed.filteredOutCount}`);
  console.log(`Pesan valid total  : ${parsed.messages.length}`);
  console.log(`Pesan dari kamu    : ${ownerMessages.length}`);
  console.log(`Pasangan Q&A       : ${qaPairs.length} (disimpan ke data/examples.json)`);
  console.log(`Arsip chat         : ${ARCHIVE_PATH}`);
  console.log(`Gaya ketik         : rata-rata ${stats.avgChars} karakter, ${stats.allLowerPct}% huruf kecil semua`);
  console.log(`Persona diperbarui : ${PERSONA_PATH}`);
}

main();
