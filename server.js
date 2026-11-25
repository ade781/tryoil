require('dotenv').config();
const path = require('path');
const express = require('express');
const pool = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_CATEGORIES = new Set(['Joran', 'Reel', 'Senar', 'Umpan', 'Aksesoris']);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function validateProductPayload(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const brand = typeof body.brand === 'string' ? body.brand.trim() : '';
  const price = Number(body.price);
  const stock = Number(body.stock);
  const description =
    body.description === undefined || body.description === null
      ? null
      : String(body.description).trim();

  if (!name) return { error: 'Nama produk wajib diisi.' };
  if (!ALLOWED_CATEGORIES.has(category)) {
    return { error: 'Kategori harus salah satu dari: Joran, Reel, Senar, Umpan, Aksesoris.' };
  }
  if (!brand) return { error: 'Merek produk wajib diisi.' };
  if (!Number.isInteger(price) || price < 0) {
    return { error: 'Harga harus berupa bilangan bulat >= 0.' };
  }
  if (!Number.isInteger(stock) || stock < 0) {
    return { error: 'Stok harus berupa bilangan bulat >= 0.' };
  }

  return { data: { name, category, brand, price, stock, description } };
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const conditions = [];
    const params = [];

    if (req.query.category && String(req.query.category).trim()) {
      conditions.push('category = ?');
      params.push(String(req.query.category).trim());
    }

    if (req.query.q && String(req.query.q).trim()) {
      const keyword = `%${String(req.query.q).trim()}%`;
      conditions.push('(name LIKE ? OR brand LIKE ? OR description LIKE ?)');
      params.push(keyword, keyword, keyword);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM products ${whereClause} ORDER BY id DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data produk.' });
  }
});

app.post('/api/products', async (req, res) => {
  const { error, data } = validateProductPayload(req.body || {});
  if (error) return res.status(400).json({ error });

  try {
    const [result] = await pool.query(
      'INSERT INTO products (name, category, brand, price, stock, description) VALUES (?, ?, ?, ?, ?, ?)',
      [data.name, data.category, data.brand, data.price, data.stock, data.description]
    );
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambahkan produk.' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID produk tidak valid.' });
  }

  const { error, data } = validateProductPayload(req.body || {});
  if (error) return res.status(400).json({ error });

  try {
    const [result] = await pool.query(
      'UPDATE products SET name = ?, category = ?, brand = ?, price = ?, stock = ?, description = ? WHERE id = ?',
      [data.name, data.category, data.brand, data.price, data.stock, data.description, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    }
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui produk.' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID produk tidak valid.' });
  }

  try {
    const [result] = await pool.query('DELETE FROM products WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    }
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus produk.' });
  }
});

app.listen(PORT, () => {
  console.log(`Toko Pancing server running on port ${PORT}`);
});
