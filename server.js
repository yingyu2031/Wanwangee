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


// --- 1. 管理員登入 API ---
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'Wanwangee' && password === '123') {
    res.json({ success: true, message: '登入成功', token: 'wanwangee-admin-token-secret' });
  } else {
    res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
  }
});



// --- 2. 會員相關 API ---

// 檢查會員綁定
app.get('/api/users/check/:uid', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE uid = $1', [req.params.uid]);
    
    // 只要資料庫找得到這筆 UID，就直接視為已綁定過！
    if (result.rows.length > 0) {
      res.json({ success: true, bound: true, data: result.rows[0] });
    } else {
      res.json({ success: true, bound: false, data: null });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 會員註冊&更新資料 ---
app.post('/api/users/bind', async (req, res) => {
  try {
    const { uid, line_nickname, real_name, phone, email, address, birthday, gender } = req.body;
    
    // 檢查前端是否有確實傳送必要欄位
    if (!uid || !real_name || !phone) {
      return res.status(400).json({ success: false, message: '缺少必要欄位 (uid, real_name, phone)' });
    }

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
    
    const values = [
      uid, 
      line_nickname || '', 
      real_name, 
      phone, 
      email || '', 
      address || '', 
      birthday || '', 
      gender || '不透露'
    ];
    
    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('會員綁定錯誤:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 後台取得所有會員清單
app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY join_date DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


const multer = require('multer');
const fs = require('fs');

// 確保 uploads 資料夾存在，若不存在則自動建立
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 設定上傳檔案儲存的資料夾與檔名
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); 
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// 另外別忘了讓 Express 可以對外公開存取 uploads 資料夾內的圖片
app.use('/uploads', express.static(uploadDir));

// --- 3. 商品與預購專案 API ---
app.get('/api/products', async (req, res) => {
  try {
    const { year_month } = req.query;
    let query = 'SELECT * FROM products';
    let values = [];
    if (year_month && year_month !== 'all') {
      query += ' WHERE year_month = $1';
      values.push(year_month);
    }
    query += ' ORDER BY start_time DESC';
    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 加上 upload.single('image') 來接收前端上傳名為 image 的檔案
app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    const { name, year_month, quota, start_time, end_time, price, pre_price, is_limited, limit_qty, need_deposit, deposit_amount, memo, status } = req.body;
    
    // 如果有上傳檔案，自動組出圖片的存取路徑；若沒有則為空字串
    const image_url = req.file ? `/uploads/${req.file.filename}` : (req.body.image_url || '');

    const query = `
      INSERT INTO products (name, image_url, year_month, quota, start_time, end_time, price, pre_price, is_limited, limit_qty, need_deposit, deposit_amount, memo, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;
    const values = [
      name, 
      image_url, 
      year_month, 
      quota, 
      start_time, 
      end_time, 
      price, 
      pre_price, 
      is_limited === 'true' || is_limited === true, 
      limit_qty || 1, 
      need_deposit === 'true' || need_deposit === true, 
      deposit_amount || 0, 
      memo || '', 
      status || 'pre_ordering'
    ];

    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// --- 4. 訂單與派貨管理 API ---
app.get('/api/admin/orders', async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT o.*, u.line_nickname, u.real_name, u.phone, p.name AS product_name 
      FROM orders o
      JOIN users u ON o.uid = u.uid
      JOIN products p ON o.product_id = p.id
    `;
    let values = [];
    if (status) {
      query += ' WHERE o.status = $1';
      values.push(status);
    }
    query += ' ORDER BY o.order_time ASC';
    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.patch('/api/orders/:order_id/status', async (req, res) => {
  try {
    const { shipping_status, payment_status, memo } = req.body;
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

    res.json({ success: true, data: updateRes.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Wanwangee Server is running on port ${PORT}`);
});