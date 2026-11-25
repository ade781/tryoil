# WhatsApp AI Clone (`wa-clone`)

Bot WhatsApp pribadi berbasis AI (Gemini) yang meniru gaya ketikan kamu berdasarkan riwayat chat WhatsApp.

---

## 1. Cara Mendapatkan Gemini API Key (Gratis)

1. Buka [Google AI Studio](https://aistudio.google.com/) dan login menggunakan akun Google kamu.
2. Klik **Get API key** di menu sebelah kiri (atau pojok kanan atas).
3. Klik **Create API key**, lalu pilih project Google Cloud yang tersedia (atau buat project baru).
4. Salin (copy) API key yang muncul dan simpan untuk dimasukkan ke file `.env`.

---

## 2. Export Chat WhatsApp & Latih Gaya Ketikan Bot

Agar bot bisa meniru gaya bahasa dan ketikan kamu, ekspor riwayat chat dari HP lalu impor ke proyek ini.

### Export Chat dari HP
- **Android**: Buka chat yang ingin dijadikan referensi -> ketuk ikon titik tiga (`⋮`) -> **Lainnya (More)** -> **Ekspor chat (Export chat)** -> pilih **Tanpa media (Without media)** -> simpan file `.txt`.
- **iOS (iPhone)**: Buka chat -> ketuk nama kontak/grup di atas -> gulir ke bawah dan pilih **Ekspor Chat (Export Chat)** -> pilih **Tanpa Media (Without Media)** -> simpan/bagikan file `.txt`.

### Import ke Bot
1. Pindahkan file hasil export (misalnya `chat.txt`) ke folder proyek `wa-clone`.
2. Jalankan perintah berikut, ganti `"Nama Kamu"` dengan nama persis kamu yang tertera di dalam file `.txt` tersebut:
   ```bash
   node scripts/import-chat.js chat.txt "Nama Kamu"
   ```
3. Gaya ketikan dan contoh percakapan akan tersimpan untuk dipakai bot saat membalas pesan.

---

## 3. Deploy & Menjalankan Bot di VPS

Asumsikan folder proyek berada di `/opt/wa-clone` dan Node.js serta `pm2` sudah terpasang di VPS.

1. **Masuk ke direktori proyek dan install dependencies:**
   ```bash
   cd /opt/wa-clone
   npm install --omit=dev
   ```

2. **Konfigurasi `.env`:**
   Salin file contoh jika ada (`cp .env.example .env`) atau buat file `.env` baru, lalu isi variabel yang dibutuhkan (termasuk Gemini API Key):
   ```env
   GEMINI_API_KEY=isi_api_key_gemini_kamu_di_sini
   ```

3. **Scan QR WhatsApp pertama kali:**
   Jalankan bot secara langsung terlebih dahulu untuk memunculkan QR Code di terminal:
   ```bash
   npm start
   ```
   Buka WhatsApp di HP -> **Perangkat Tertaut (Linked Devices)** -> **Tautkan Perangkat (Link a Device)** -> scan QR yang tampil di terminal. Setelah terhubung, hentikan proses dengan menekan `Ctrl + C`.

4. **Jalankan di background 24/7 dengan PM2:**
   ```bash
   pm2 start src/bot.js --name wa-clone
   pm2 save
   ```
   *(Opsional)* Cek log bot kapan saja dengan `pm2 logs wa-clone`.

---

## 4. Perintah Kontrol dari HP Sendiri

Kamu bisa mengontrol bot langsung dengan mengirim pesan ke chat kamu sendiri (atau di chat yang dipantau bot):

| Perintah | Fungsi |
| :--- | :--- |
| `!clone off` | Mematikan auto-reply bot sementara |
| `!clone on` | Mengaktifkan kembali auto-reply bot |
| `!clone status` | Mengecek status bot saat ini (aktif/nonaktif) |
