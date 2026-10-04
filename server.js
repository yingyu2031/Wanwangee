const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
        is_allocated BOOLEAN DEFAULT FALSE,
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


// --- 3. 商品與預購專案 API ---
app.get('/api/products', async (req, res) => {
  try {
    const { year_month, keyword } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    let values = [];
    let paramIndex = 1;

    // 1. 發售年月篩選（如果不是 all 且有填寫，才加入條件）
    if (year_month && year_month !== 'all' && year_month.trim() !== '') {
      query += ` AND year_month ILIKE $${paramIndex}`;
      values.push(`%${year_month.trim()}%`);
      paramIndex++;
    }

    // 2. 品名關鍵字搜尋
    if (keyword && keyword.trim() !== '') {
      query += ` AND name ILIKE $${paramIndex}`;
      values.push(`%${keyword.trim()}%`);
      paramIndex++;
    }

    // 3. 排序規則：第一排序發售年月新到舊，第二排序預購截止日新到舊
    query += ' ORDER BY year_month DESC, end_time DESC';

    const result = await pool.query(query, values);
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
    const values = [
      name, 
      image_url || '', 
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

// --- 修改/更新商品 API ---
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, image_url, year_month, quota, start_time, end_time, price, pre_price, is_limited, limit_qty, need_deposit, deposit_amount, memo, status } = req.body;
    
    // 如果沒有上傳新圖片（image_url 是空的），我們可以選擇保留原本的圖片或更新
    let query = `
      UPDATE products 
      SET name = $1, image_url = $2, year_month = $3, quota = $4, start_time = $5, end_time = $6, price = $7, pre_price = $8, is_limited = $9, limit_qty = $10, need_deposit = $11, deposit_amount = $12, memo = $13, status = $14
      WHERE id = $15
      RETURNING *;
    `;
    
    const values = [
      name, 
      image_url || '', 
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
      status || 'pre_ordering',
      id
    ];

    const result = await pool.query(query, values);
    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.status(404).json({ success: false, message: '找不到該商品無法更新' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 用 ID 取得單一商品資料
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.status(404).json({ success: false, message: '找不到該商品' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 刪除商品 API ---
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length > 0) {
      res.json({ success: true, message: '商品已成功刪除' });
    } else {
      res.status(404).json({ success: false, message: '找不到該商品' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 取得指定商品的預購人明細 API ---
app.get('/api/products/:id/orders', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT o.order_no, o.quantity, o.order_time, o.status, o.shipping_status, o.payment_status, o.memo, o.is_allocated,
             u.real_name, u.uid, u.line_nickname
      FROM orders o
      LEFT JOIN users u ON o.uid = u.uid
      WHERE o.product_id = $1
      ORDER BY o.order_time ASC;
    `;
    
    const result = await pool.query(query, [id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 後端接收儲存分派與實際到貨量
app.post('/api/products/:id/allocate', async (req, res) => {
    const productId = req.params.id;
    const { actual_stock, allocations } = req.body;

    try {
        // 1. 更新 products 表的 actual_stock
        await pool.query(
            'UPDATE products SET actual_stock = $1 WHERE id = $2',
            [actual_stock, productId]
        );

        // 2. 檢查總勾選人數是否超過 actual_stock（後端嚴格防呆）
        const checkedCount = allocations.filter(item => item.is_allocated).length;
        if (checkedCount > actual_stock) {
            return res.status(400).json({ success: false, message: '勾選分派人數大於實際到貨量！' });
        }

        // 3. 批次更新各個訂單的 is_allocated 欄位
        for (const item of allocations) {
            await pool.query(
                'UPDATE orders SET is_allocated = $1 WHERE id = $2',
                [item.is_allocated, item.order_id]
              );
          }

        res.json({ success: true, message: '更新成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '資料庫更新失敗' });
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