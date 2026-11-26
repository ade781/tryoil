#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { generateCloneReply } = require('../src/ai');

const senderName = process.argv[2] || 'sasa';
const jid = `terminal-test-${senderName}`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('=== Simulasi Chat Terminal (Tanpa WhatsApp) ===');
console.log(`Kamu berperan sebagai: ${senderName}`);
console.log('Ketik pesan lalu Enter untuk lihat balasan kloninganmu.');
console.log('Ketik "exit" untuk keluar.\n');

function ask() {
  rl.question(`${senderName} > `, async (line) => {
    const input = line.trim();
    if (!input) {
      return ask();
    }
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === '/exit') {
      rl.close();
      return;
    }

    try {
      const reply = await generateCloneReply(jid, senderName, input);
      if (!reply) {
        console.log(`17summa > [Read saja / tidak dibalas oleh Decision 1]\n`);
      } else {
        console.log(`17summa > ${reply}\n`);
      }
    } catch (err) {
      console.error(`[ERROR] ${err.message}\n`);
    }
    ask();
  });
}

ask();
