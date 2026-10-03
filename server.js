const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL 連線設定 (結合您提供的連線參數與時區設定)
let dbUrl = process.env.DATABASE_URL || 'postgresql://root:vyECdB09Ha6z8gXNO342U1Z5MJrei7bS@localhost:5432/wanwangee_db';

const pool = new Pool({
  connectionString: dbUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  options: '-c timezone=Asia/Taipei'
});

pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring PostgreSQL client:', err.stack);
  }
  console.log('PostgreSQL connected successfully to wanwangee_db');
  release();
});

// 自動初始化資料庫表格
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid VARCHAR(255) UNIQUE NOT NULL,
        line_nickname VARCHAR(255) DEFAULT '',
        real_name VARCHAR(255) DEFAULT '',
        phone VARCHAR(50) DEFAULT '',
        email VARCHAR(255) DEFAULT '',
        address TEXT DEFAULT '',
        birthday VARCHAR(50) DEFAULT '',
        gender VARCHAR(20) DEFAULT '',
        member_level VARCHAR(50) DEFAULT '一般會員',
        total_spent NUMERIC(10, 2) DEFAULT 0,
        join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        image_url TEXT DEFAULT '',
        year_month VARCHAR(20) NOT NULL,
        quota INT NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        pre_price NUMERIC(10, 2) NOT NULL,
        is_limited BOOLEAN DEFAULT FALSE,
        limit_qty INT DEFAULT 1,
        need_deposit BOOLEAN DEFAULT FALSE,
        deposit_amount NUMERIC(10, 2) DEFAULT 0,
        memo TEXT DEFAULT '',
        status VARCHAR(50) DEFAULT 'pre_ordering'
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_no VARCHAR(100) UNIQUE NOT NULL,
        uid VARCHAR(255) REFERENCES users(uid),
        product_id INT REFERENCES products(id),
        quantity INT DEFAULT 1,
        total_amount NUMERIC(10, 2) NOT NULL,
        deposit_paid NUMERIC(10, 2) DEFAULT 0,
        balance_amount NUMERIC(10, 2) DEFAULT 0,
        order_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'trading',
        shipping_status VARCHAR(50) DEFAULT 'unshipped',
        shipping_date TIMESTAMP,
        payment_status VARCHAR(50) DEFAULT 'unpaid',
        payment_date TIMESTAMP,
        last_notify_time TIMESTAMP,
        memo TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        admin_name VARCHAR(255) NOT NULL,
        action VARCHAR(100) NOT NULL,
        target_order_no VARCHAR(100) NOT NULL,
        detail TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
};

initDB();

// ==========================================
// API 路由設計
// ==========================================

// 檢查會員是否已綁定過
app.get('/api/users/check/:uid', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE uid = $1', [req.params.uid]);
    if (result.rows.length > 0 && result.rows[0].real_name && result.rows[0].phone) {
      res.json({ success: true, bound: true, data: result.rows[0] });
    } else {
      res.json({ success: true, bound: false, data: result.rows[0] || null });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 綁定或更新會員資料
app.post('/api/users/bind', async (req, res) => {
  try {
    const { uid, line_nickname, real_name, phone, email, address, birthday, gender } = req.body;
    const query = `
      INSERT INTO users (uid, line_nickname, real_name, phone, email, address, birthday, gender, join_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (uid) 
      DO UPDATE SET 
        line_nickname = COALESCE($2, users.line_nickname),
        real_name = COALESCE($3, users.real_name),
        phone = COALESCE($4, users.phone),
        email = COALESCE($5, users.email),
        address = COALESCE($6, users.address),
        birthday = COALESCE($7, users.birthday),
        gender = COALESCE($8, users.gender)
      RETURNING *;
    `;
    const values = [uid, line_nickname, real_name, phone, email || '', address, birthday, gender];
    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/users/:uid', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE uid = $1', [req.params.uid]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: '找不到會員資料' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY start_time DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`TOYHEART Server is running on port ${PORT}`);
});
