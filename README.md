# Toko Pancing — Panduan Deployment VPS (1 GB RAM) & Backup Google Drive

Panduan ringkas untuk menjalankan aplikasi CRUD **Toko Pancing** (Node.js + MySQL) di VPS Ubuntu/Debian dengan RAM 1 GB, reverse proxy Nginx, serta backup otomatis harian ke Google Drive menggunakan `rclone`.

---

## 1. Instalasi Node.js 20 LTS & MySQL Server

Update sistem dan pasang dependensi dasar:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx rclone
```

Pasang **Node.js 20 LTS** via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

Pasang **MySQL Server**:

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
```

---

## 2. Tuning MySQL untuk VPS 1 GB RAM

Edit konfigurasi MySQL (`/etc/mysql/mysql.conf.d/mysqld.cnf`) agar penggunaan memori tetap aman di VPS 1 GB RAM:

```bash
sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
```

Tambahkan atau sesuaikan di bawah bagian `[mysqld]`:

```ini
[mysqld]
innodb_buffer_pool_size = 128M
innodb_log_file_size = 32M
max_connections = 50
performance_schema = OFF
```

Restart MySQL untuk menerapkan perubahan:

```bash
sudo systemctl restart mysql
```

> **Tips opsional:** Jika VPS belum memiliki swap, tambahkan swap 1 GB (`fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`) untuk mencegah OOM saat proses `npm install` atau `mysqldump`.

---

## 3. Membuat Database, User & Import `schema.sql`

Masuk ke MySQL shell:

```bash
sudo mysql
```

Jalankan perintah SQL berikut (ganti `PASSWORD_KUAT` dengan kata sandi Anda):

```sql
CREATE DATABASE IF NOT EXISTS toko_pancing
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'toko_user'@'127.0.0.1' IDENTIFIED BY 'PASSWORD_KUAT';
GRANT ALL PRIVILEGES ON toko_pancing.* TO 'toko_user'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

Import skema database dari root direktori proyek:

```bash
mysql -u toko_user -p -h 127.0.0.1 toko_pancing < schema.sql
```

---

## 4. Menjalankan Aplikasi CRUD

Salin `.env.example` menjadi `.env` (jika tersedia) dan sesuaikan kredensial database:

```bash
cp .env.example .env
nano .env
```

Pastikan variabel berikut terisi dengan benar:

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=toko_user
DB_PASSWORD=PASSWORD_KUAT
DB_NAME=toko_pancing
```

Pasang dependensi produksi:

```bash
npm install --omit=dev
```

### Opsi A: Menggunakan PM2 (Disarankan)

```bash
sudo npm install -g pm2
pm2 start server.js --name toko-pancing
pm2 save
pm2 startup
```

*(Jalankan perintah `sudo env PATH=...` yang ditampilkan oleh `pm2 startup` agar aplikasi otomatis menyala saat VPS reboot.)*

### Opsi B: Menggunakan `systemd`

Buat file `/etc/systemd/system/toko-pancing.service`:

```ini
[Unit]
Description=Toko Pancing CRUD App
After=network.target mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/toko-pancing
EnvironmentFile=/var/www/toko-pancing/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Aktifkan service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now toko-pancing
```

---

## 5. Konfigurasi Nginx Reverse Proxy

Buat konfigurasi site baru di `/etc/nginx/sites-available/toko-pancing`:

```nginx
server {
    listen 80;
    server_name domain-anda.com _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Aktifkan konfigurasi dan reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/toko-pancing /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. Setup `rclone` (Google Drive Headless Auth)

Karena VPS tidak memiliki browser, lakukan otorisasi melalui PC/laptop lokal yang memiliki browser dan `rclone`:

1. Di **VPS**, jalankan:
   ```bash
   rclone config
   ```
   - Pilih `n` (New remote) -> beri nama `gdrive`
   - Pilih `drive` (Google Drive)
   - `client_id` & `client_secret`: tekan Enter (kosongkan) atau isi milik Anda sendiri
   - `scope`: pilih `1` (Full access)
   - `Use web browser to automatically authenticate rclone with remote?`: pilih **`n`** (No / headless)

2. Di **PC/Laptop Lokal** (yang ada browser), jalankan perintah yang muncul di layar VPS:
   ```bash
   rclone authorize "drive"
   ```
   Login ke akun Google di browser, lalu salin token JSON yang tercetak di terminal lokal dan tempelkan ke prompt di **VPS**.

3. Uji koneksi ke Google Drive dari VPS:
   ```bash
   rclone lsd gdrive:
   ```

---

## 7. Backup Otomatis Harian via `crontab`

Beri izin eksekusi pada skrip backup dan buat direktori backup:

```bash
chmod +x scripts/backup-gdrive.sh
sudo mkdir -p /var/backups/mysql
sudo chown "$USER":"$USER" /var/backups/mysql
```

*(Opsional)* Jika tidak ingin mengandalkan `.env`, Anda dapat menyimpan kredensial di `~/.my.cnf` dengan izin `chmod 600 ~/.my.cnf`:

```ini
[client]
user=toko_user
password=PASSWORD_KUAT
host=127.0.0.1
```

Uji skrip secara manual terlebih dahulu:

```bash
./scripts/backup-gdrive.sh
```

Tambahkan jadwal cron harian (misalnya setiap pukul **02:00 WIB/server**) menggunakan `crontab -e`:

```bash
crontab -e
```

Tambahkan baris berikut (sesuaikan path proyek Anda):

```cron
0 2 * * * /var/www/toko-pancing/scripts/backup-gdrive.sh >> /var/log/backup-toko-pancing.log 2>&1
```

Skrip akan melakukan dump database `toko_pancing` (`--single-transaction --quick`), mengompresinya ke `/var/backups/mysql/*.sql.gz`, mengunggah ke `gdrive:backup-mysql-toko-pancing`, dan menghapus backup lokal yang berumur lebih dari 7 hari.
