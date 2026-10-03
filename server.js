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

// --- 1. 會員相關 API ---
app.post('/api/users/bind', async (req, res) => {
  try {
    const { uid, line_nickname, real_name, phone, address, birthday, gender } = req.body;
    const query = `
      INSERT INTO users (uid, line_nickname, real_name, phone, address, birthday, gender, join_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
      ON CONFLICT (uid) 
      DO UPDATE SET 
        line_nickname = COALESCE($2, users.line_nickname),
        real_name = COALESCE($3, users.real_name),
        phone = COALESCE($4, users.phone),
        address = COALESCE($5, users.address),
        birthday = COALESCE($6, users.birthday),
        gender = COALESCE($7, users.gender)
      RETURNING *;
    `;
    const values = [uid, line_nickname, real_name, phone, address, birthday, gender];
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

// --- 2. 商品與預購專案 API ---
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY start_time DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, image_url, year_month, quota, start_time, end_time, price, pre_price, is_limited, limit_qty, need_deposit, deposit_amount, memo, status } = req.body;
    const query = `
      INSERT INTO products (name, image_url, year_month, quota, start_time, end_time, price, pre_price, is_limited, limit_qty, need_deposit, deposit_amount, memo, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;
    const values = [name, image_url, year_month, quota, start_time, end_time, price, pre_price, is_limited || false, limit_qty || 1, need_deposit || false, deposit_amount || 0, memo || '', status || 'pre_ordering'];
    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 3. 預購與訂單主檔 API ---
app.post('/api/orders', async (req, res) => {
  try {
    const { uid, product_id, quantity, memo } = req.body;
    
    const prodRes = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (prodRes.rows.length === 0) return res.status(404).json({ success: false, message: '商品不存在' });
    const product = prodRes.rows[0];

    const now = new Date();
    if (now < new Date(product.start_time) || now > new Date(product.end_time)) {
      return res.status(400).json({ success: false, message: '目前不在預購時間範圍內' });
    }

    if (product.is_limited && quantity > product.limit_qty) {
      return res.status(400).json({ success: false, message: `每人限購 ${product.limit_qty} 隻` });
    }

    const total_amount = product.pre_price * quantity;
    const deposit_paid = product.need_deposit ? (product.deposit_amount * quantity) : 0;
    const balance_amount = total_amount - deposit_paid;

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomNum = Math.floor(100 + Math.random() * 900);
    const order_no = `#TH${dateStr}${randomNum}`;

    const query = `
      INSERT INTO orders (order_no, uid, product_id, quantity, total_amount, deposit_paid, balance_amount, order_time, status, shipping_status, payment_status, memo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, 'trading', 'unshipped', 'unpaid', $8)
      RETURNING *;
    `;
    const values = [order_no, uid, product_id, quantity, total_amount, deposit_paid, balance_amount, memo || ''];
    const result = await pool.query(query, values);

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 取得特定商品的預購排隊明細（依下單時間排序，實現先後排隊分派）
app.get('/api/products/:product_id/orders', async (req, res) => {
  try {
    const query = `
      SELECT o.*, u.line_nickname, u.real_name, u.phone 
      FROM orders o
      JOIN users u ON o.uid = u.uid
      WHERE o.product_id = $1
      ORDER BY o.order_time ASC;
    `;
    const result = await pool.query(query, [req.params.product_id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 後台：取消訂單與名額改派
app.post('/api/orders/:order_id/cancel-and-reassign', async (req, res) => {
  try {
    const { admin_name, new_uid } = req.body;
    const orderId = req.params.order_id;

    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rows.length === 0) return res.status(404).json({ success: false, message: '找不到該訂單' });
    const targetOrder = orderRes.rows[0];

    await pool.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [orderId]);

    const auditQuery = `
      INSERT INTO audit_logs (admin_name, action, target_order_no, detail, created_at)
      VALUES ($1, 'CANCEL_AND_REASSIGN', $2, $3, CURRENT_TIMESTAMP)
      RETURNING *;
    `;
    const detail = `取消訂單 ${targetOrder.order_no}，並將名額改派給 UID: ${new_uid || '未指定'}`;
    const auditRes = await pool.query(auditQuery, [admin_name || '管理員', targetOrder.order_no, detail]);

    res.json({ success: true, message: '訂單已取消並完成改派紀錄', audit: auditRes.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 後台：更新出貨與收款狀態
app.patch('/api/orders/:order_id/status', async (req, res) => {
  try {
    const { admin_name, shipping_status, payment_status, memo } = req.body;
    const orderId = req.params.order_id;

    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderRes.rows.length === 0) return res.status(404).json({ success: false, message: '找不到訂單' });
    const order = orderRes.rows[0];

    const newShippingStatus = shipping_status || order.shipping_status;
    const newPaymentStatus = payment_status || order.payment_status;
    const newMemo = memo !== undefined ? memo : order.memo;
    const shippingDate = (shipping_status === 'shipped' && order.shipping_status !== 'shipped') ? new Date() : order.shipping_date;
    const paymentDate = (payment_status === 'paid' && order.payment_status !== 'paid') ? new Date() : order.payment_date;

    const updateQuery = `
      UPDATE orders 
      SET shipping_status = $1, payment_status = $2, memo = $3, shipping_date = $4, payment_date = $5
      WHERE id = $6
      RETURNING *;
    `;
    const updateRes = await pool.query(updateQuery, [newShippingStatus, newPaymentStatus, newMemo, shippingDate, paymentDate, orderId]);

    await pool.query(`
      INSERT INTO audit_logs (admin_name, action, target_order_no, detail, created_at)
      VALUES ($1, 'UPDATE_ORDER_STATUS', $2, $3, CURRENT_TIMESTAMP);
    `, [admin_name || '管理員', order.order_no, `更新出貨狀態: ${newShippingStatus}, 收款狀態: ${newPaymentStatus}`]);

    res.json({ success: true, data: updateRes.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`TOYHEART Server is running on port ${PORT}`);
});
