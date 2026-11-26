const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const PROCESS_TIMEOUT_MS = 90 * 1000;
let mediaQueue = Promise.resolve();

function enqueueMediaJob(fn) {
  const run = mediaQueue.then(fn, fn);
  mediaQueue = run.catch(() => {});
  return run;
}

function runLowPriorityCmd(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const isLinux = process.platform === 'linux';
    const spawnCmd = isLinux ? 'nice' : cmd;
    const spawnArgs = isLinux ? ['-n', '15', cmd, ...args] : args;

    const child = spawn(spawnCmd, spawnArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, PROCESS_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 4096) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(`${cmd} timeout setelah ${PROCESS_TIMEOUT_MS / 1000} detik.`));
      }
      if (code !== 0) {
        return reject(new Error(`${cmd} gagal (code ${code}): ${stderr.trim() || stdout.trim()}`));
      }
      resolve({ stdout, stderr });
    });
  });
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
}

function isValidHttpUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Download a video (<=720p, <=45MB) using yt-dlp.
 * @param {string} url
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
function downloadVideo(url) {
  if (!isValidHttpUrl(url)) {
    return Promise.reject(new Error('URL tidak valid. Kirim link http/https yang benar.'));
  }

  return enqueueMediaJob(async () => {
    const workDir = makeTempDir('wa-dl-vid-');
    try {
      const outTpl = path.join(workDir, 'media.%(ext)s');
      await runLowPriorityCmd(
        'yt-dlp',
        [
          '--no-playlist',
          '--max-filesize',
          '45M',
          '-f',
          'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4]/b',
          '--merge-output-format',
          'mp4',
          '-o',
          outTpl,
          url.trim(),
        ],
        workDir
      );

      const files = fs.readdirSync(workDir).filter((f) => !f.endsWith('.part'));
      if (!files.length) {
        throw new Error('File hasil download tidak ditemukan.');
      }
      const filePath = path.join(workDir, files[0]);
      const stat = fs.statSync(filePath);
      if (stat.size > 48 * 1024 * 1024) {
        throw new Error('Ukuran video melebihi batas aman 48 MB.');
      }
      return { buffer: fs.readFileSync(filePath), filename: files[0] };
    } finally {
      cleanupDir(workDir);
    }
  });
}

/**
 * Download audio as MP3 (<=35MB) using yt-dlp + ffmpeg.
 * @param {string} url
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
function downloadMp3(url) {
  if (!isValidHttpUrl(url)) {
    return Promise.reject(new Error('URL tidak valid. Kirim link http/https yang benar.'));
  }

  return enqueueMediaJob(async () => {
    const workDir = makeTempDir('wa-dl-mp3-');
    try {
      const outTpl = path.join(workDir, 'audio.%(ext)s');
      await runLowPriorityCmd(
        'yt-dlp',
        [
          '--no-playlist',
          '--max-filesize',
          '35M',
          '-x',
          '--audio-format',
          'mp3',
          '--audio-quality',
          '128K',
          '-o',
          outTpl,
          url.trim(),
        ],
        workDir
      );

      const files = fs.readdirSync(workDir).filter((f) => f.endsWith('.mp3'));
      if (!files.length) {
        throw new Error('File MP3 hasil konversi tidak ditemukan.');
      }
      const filePath = path.join(workDir, files[0]);
      return { buffer: fs.readFileSync(filePath), filename: files[0] };
    } finally {
      cleanupDir(workDir);
    }
  });
}

/**
 * Convert an image or short video WAMessage into a 512x512 WebP WhatsApp sticker buffer.
 * @param {object} targetMsg
 * @param {object} sock
 * @returns {Promise<Buffer>}
 */
function createStickerFromMessage(targetMsg, sock) {
  return enqueueMediaJob(async () => {
    const m = targetMsg?.message;
    const isVideo = Boolean(m?.videoMessage);
    const isImage = Boolean(m?.imageMessage);
    if (!isImage && !isVideo) {
      throw new Error('Kirim gambar/video dengan caption !s atau reply gambar/video dengan !s.');
    }

    const mediaBuffer = await downloadMediaMessage(
      targetMsg,
      'buffer',
      {},
      { reuploadRequest: sock.updateMediaMessage }
    );

    const workDir = makeTempDir('wa-sticker-');
    try {
      const inputPath = path.join(workDir, isVideo ? 'input.mp4' : 'input.jpg');
      const outputPath = path.join(workDir, 'sticker.webp');
      fs.writeFileSync(inputPath, mediaBuffer);

      const scalePad =
        'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';

      const args = isVideo
        ? [
            '-y',
            '-i',
            inputPath,
            '-t',
            '6',
            '-vf',
            `fps=12,${scalePad}`,
            '-vcodec',
            'libwebp',
            '-lossless',
            '0',
            '-compression_level',
            '6',
            '-q:v',
            '55',
            '-loop',
            '0',
            '-preset',
            'default',
            '-an',
            '-vsync',
            '0',
            outputPath,
          ]
        : [
            '-y',
            '-i',
            inputPath,
            '-vf',
            scalePad,
            '-vcodec',
            'libwebp',
            '-lossless',
            '0',
            '-q:v',
            '75',
            outputPath,
          ];

      await runLowPriorityCmd('ffmpeg', args, workDir);
      const webpBuffer = fs.readFileSync(outputPath);
      if (webpBuffer.length > 950 * 1024) {
        throw new Error('Ukuran stiker terlalu besar (>950 KB). Coba video lebih pendek.');
      }
      return webpBuffer;
    } finally {
      cleanupDir(workDir);
    }
  });
}

module.exports = {
  downloadVideo,
  downloadMp3,
  createStickerFromMessage,
};
