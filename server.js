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
        category_id INT REFERENCES categories(id) ON DELETE SET NULL,
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
        status VARCHAR(50) DEFAULT 'pre_ordering',
        actual_stock INT DEFAULT 0
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
        status VARCHAR(50) DEFAULT '',
        is_allocated BOOLEAN DEFAULT FALSE,
        shipping_status VARCHAR(50) DEFAULT 'unshipped',
        shipping_date TIMESTAMP,
        payment_status VARCHAR(50) DEFAULT 'unpaid',
        payment_date TIMESTAMP,
        last_notify_time TIMESTAMP,
        memo TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
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
// 後台api
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



// 後台取得所有會員清單
app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY join_date DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 取得所有分類的 API
app.get('/api/categories', async (req, res) => {
    try {
        // 從資料庫撈出 id 和 name，並依據 id 排序
        const result = await pool.query('SELECT id, name FROM categories ORDER BY id ASC');
        
        // 將結果以 JSON 格式回傳給前端
        res.json(result.rows);
    } catch (err) {
        console.error('獲取分類失敗:', err.message);
        res.status(500).json({ error: '伺服器錯誤' });
    }
});

// --- 取得商品列表 (加入分類篩選) ---
app.get('/api/products', async (req, res) => {
  try {
    const { year_month, keyword, category_id } = req.query; // 新增 category_id
    let query = `SELECT p.*, a.qty FROM products p
      LEFT JOIN (
          SELECT product_id, SUM(quantity) as qty 
          FROM orders 
          WHERE is_allocated IS TRUE 
          GROUP BY product_id
      ) a ON p.id = a.product_id
     WHERE 1=1`;
    let values = [];
    let paramIndex = 1;

    // 1. 發售年月篩選
    if (year_month && year_month !== 'all' && year_month.trim() !== '') {
      query += ` AND p.year_month ILIKE $${paramIndex}`;
      values.push(`%${year_month.trim()}%`);
      paramIndex++;
    }

    // 2. 品名關鍵字搜尋
    if (keyword && keyword.trim() !== '') {
      query += ` AND p.name ILIKE $${paramIndex}`;
      values.push(`%${keyword.trim()}%`);
      paramIndex++;
    }

    // 3. 分類篩選 (新增)
    if (category_id && category_id.trim() !== '') {
      query += ` AND p.category_id = $${paramIndex}`;
      values.push(category_id);
      paramIndex++;
    }

    // 排序規則
    query += ' ORDER BY p.year_month DESC, p.end_time DESC';

    const result = await pool.query(query, values);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// --- 新增商品 API (加入 category_id) ---
app.post('/api/products', async (req, res) => {
  try {
    const { category_id, name, image_url, year_month, quota, start_time, end_time, price, pre_price, is_limited, limit_qty, need_deposit, deposit_amount, memo, status } = req.body;
    
    const query = `
      INSERT INTO products (category_id, name, image_url, year_month, quota, start_time, end_time, price, pre_price, is_limited, limit_qty, need_deposit, deposit_amount, memo, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;
    const values = [
      category_id || null, // 沒填就給 null
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


// --- 修改/更新商品 API (加入 category_id) ---
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, name, image_url, year_month, quota, start_time, end_time, price, pre_price, is_limited, limit_qty, need_deposit, deposit_amount, memo, status } = req.body;
    
    let query = `
      UPDATE products 
      SET category_id = $1, name = $2, image_url = $3, year_month = $4, quota = $5, start_time = $6, end_time = $7, price = $8, pre_price = $9, is_limited = $10, limit_qty = $11, need_deposit = $12, deposit_amount = $13, memo = $14, status = $15
      WHERE id = $16
      RETURNING *;
    `;
    
    const values = [
      category_id || null, // 沒填就給 null
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
    const query = `
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id 
        WHERE p.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.status(404).json({ success: false, message: '找不到該商品' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 刪除商品 API  ---
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
      SELECT o.id, o.order_no, o.quantity, o.order_time, o.status, o.shipping_status, o.payment_status, o.memo, o.is_allocated,
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

        // 2. 先從資料庫撈出目前該商品所有訂單的原本狀態與分派狀況（用於防呆驗證）
        const currentOrdersRes = await pool.query(
            'SELECT order_no, status, is_allocated FROM orders WHERE product_id = $1',
            [productId]
        );
        const dbOrdersMap = new Map();
        currentOrdersRes.rows.forEach(row => dbOrdersMap.set(row.order_no, row));

        // 3. 檢查總勾選數量是否超過 actual_stock（後端嚴格防呆）
        const checkedQty = allocations
            .filter(item => item.is_allocated)
            .reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
            
        if (checkedQty > actual_stock) {
            return res.status(400).json({ success: false, message: '勾選分派的總數量大於實際到貨量！' });
        }

        // 4. 批次更新各個訂單的 is_allocated 與 status
        if (allocations && Array.isArray(allocations)) {
            for (const item of allocations) {
                const dbOrder = dbOrdersMap.get(item.order_no);
                
                // 防呆保護：如果資料庫中原本就是「成交」狀態，不允許透過前端分派介面做任何變動
                if (dbOrder && dbOrder.status === '成交') {
                    continue; 
                }

                if (item.is_allocated) {
                    // 勾選分派時（不管是原本空白、取消、還是未分派）：is_allocated 設為 true，狀態改為「交易中」
                    await pool.query(
                        'UPDATE orders SET is_allocated = TRUE, status = \'交易中\' WHERE order_no = $1',
                        [item.order_no]
                    );
                } else {
                    await pool.query(
                        `UPDATE orders 
                         SET is_allocated = FALSE, status = CASE WHEN status = '交易中' THEN NULL ELSE status END 
                         WHERE order_no = $1`,
                        [item.order_no]
                    );
                }
            }
        }

        res.json({ success: true, message: '更新成功' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '資料庫更新失敗' });
    }
});

// 到貨與出貨對帳名單明細 api
app.get('/api/admin/orders', async (req, res) => {
    try {
        const { status = '交易中', keyword = '' } = req.query;

        let query = `
            SELECT o.*, 
                   u.real_name, 
                   u.line_nickname, 
                   p.name AS product_name,
                   o.status AS status_zh
            FROM orders o
            JOIN users u ON o.uid = u.uid
            JOIN products p ON o.product_id = p.id
            WHERE o.status = $1 
              AND o.status IS NOT NULL 
              AND o.status != ''
              /* 💡 關鍵修復：如果是取消狀態，就不強求 is_allocated 必須為 TRUE */
              AND (o.is_allocated = TRUE OR o.status = '取消')
        `;
        let params = [status];

        if (keyword) {
            query += ` AND (u.line_nickname ILIKE $2 OR p.name ILIKE $2 OR o.order_no ILIKE $2)`;
            params.push(`%${keyword}%`);
        }

        query += ` ORDER BY o.order_time DESC`;

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('取得對帳名單錯誤:', err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// 更新出貨或收款狀態
app.patch('/api/admin/orders/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { type, status, date } = req.body; // type: 'shipping' 或 'payment'

        let updateField = '';
        let dateField = '';

        if (type === 'shipping') {
            updateField = 'shipping_status';
            dateField = 'shipping_date';
        } else if (type === 'payment') {
            updateField = 'payment_status';
            dateField = 'payment_date';
        } else {
            return res.status(400).json({ success: false, message: '無效的更新類型' });
        }

        // 1. 更新指定欄位與日期 (若 date 為空則清空日期)
        const query = `
            UPDATE orders 
            SET ${updateField} = $1, ${dateField} = $2 
            WHERE id = $3 
            RETURNING *;
        `;
        const result = await pool.query(query, [status, date || null, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: '找不到該訂單' });
        }

        let updatedOrder = result.rows[0];

        // 2. 檢查狀態決定總 status 是「成交」還是「交易中」
        const isShipped = (updatedOrder.shipping_status === '已寄出' || updatedOrder.shipping_status === 'shipped');
        const isPaid = (updatedOrder.payment_status === '已收款' || updatedOrder.payment_status === 'paid');

        let newOverallStatus = '交易中';
        if (isShipped && isPaid) {
            newOverallStatus = '成交';
        }

        // 3. 回寫總 status
        const statusQuery = `UPDATE orders SET status = $1 WHERE id = $2 RETURNING *;`;
        const statusResult = await pool.query(statusQuery, [newOverallStatus, id]);
        updatedOrder = statusResult.rows[0];

        res.json({ success: true, data: updatedOrder });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});

// 2. 更新訂單備註 API
app.patch('/api/admin/orders/:id/memo', async (req, res) => {
    try {
        const { id } = req.params;
        const { memo } = req.body;

        const query = `UPDATE orders SET memo = $1 WHERE id = $2 RETURNING *;`;
        const result = await pool.query(query, [memo, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: '找不到該訂單' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
});


// 取消訂單並將名額改派給其他候補預購人
app.patch('/api/admin/orders/reassign', async (req, res) => {
    // 💡 防呆保護：避免前端傳來字串 "undefined" 搞崩資料庫
    const { cancelOrderId, reassignOrderId } = req.body;
    
    if (!cancelOrderId || cancelOrderId === 'undefined') {
        return res.status(400).json({ success: false, message: '無效的取消訂單 ID' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // 開啟交易

        // 1. 將原本的訂單標記為取消、解除分派，並清空出貨/收款狀態
        const cancelQuery = `
            UPDATE orders 
            SET is_allocated = FALSE, status = '取消', shipping_status = '未寄出', payment_status = '未收款'
            WHERE id = $1
            RETURNING *;
        `;
        const cancelRes = await client.query(cancelQuery, [cancelOrderId]);

        if (cancelRes.rowCount === 0) {
            throw new Error('找不到要取消的訂單');
        }

        // 2. 如果有選擇改派對象 (且不是 undefined)，則將其標記為已分派
        if (reassignOrderId && reassignOrderId !== 'undefined') {
            const reassignQuery = `
                UPDATE orders 
                SET is_allocated = TRUE, status = '交易中'
                WHERE id = $1;
            `;
            await client.query(reassignQuery, [reassignOrderId]);
        }

        await client.query('COMMIT'); // 提交交易
        res.json({ success: true, message: '改派成功！' });
    } catch (err) {
        await client.query('ROLLBACK'); // 若有報錯，倒退所有更改
        console.error('改派失敗:', err);
        res.status(500).json({ success: false, message: err.message || '伺服器錯誤' });
    } finally {
        client.release();
    }
});


// ==========================================
// 前台：下單與個人訂單 API
// ==========================================



// ---  會員相關 API ---

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

// 提交預購訂單 (含防呆邏輯：檢查限購、檢查總配額)
app.post('/api/orders', async (req, res) => {
    const { uid, product_id, quantity } = req.body;
    
    if (!uid || !product_id || !quantity) {
        return res.status(400).json({ success: false, message: '缺少必要參數' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // 開啟交易鎖定，避免超賣

        // 檢查商品是否存在
        const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [product_id]);
        if (prodRes.rows.length === 0) {
            throw new Error('找不到該商品');
        }
        const product = prodRes.rows[0];

        // 檢查單次數量是否超過個人限購
        if (product.is_limited && quantity > product.limit_qty) {
            throw new Error(`超過限購數量 (每人限購 ${product.limit_qty} 組)`);
        }

        // 檢查該會員是否已經預購過 (歷史訂單 + 本次數量)
        if (product.is_limited) {
            const userOrdersRes = await client.query(`
                SELECT SUM(quantity) as user_total 
                FROM orders 
                WHERE product_id = $1 AND uid = $2 AND status != '取消'
            `, [product_id, uid]);
            const userTotal = parseInt(userOrdersRes.rows[0].user_total || 0);
            
            if (userTotal + quantity > product.limit_qty) {
                throw new Error(`您已預購過 ${userTotal} 組，加上本次數量將超過限購 ${product.limit_qty} 組的限制`);
            }
        }

        // 檢查總配額是否已滿
        const totalBookedRes = await client.query(`
            SELECT SUM(quantity) as total_booked 
            FROM orders 
            WHERE product_id = $1 AND status != '取消'
        `, [product_id]);
        const totalBooked = parseInt(totalBookedRes.rows[0].total_booked || 0);
        
        if (totalBooked + quantity > product.quota) {
            throw new Error(`抱歉，該商品預購名額不足 (剩餘 ${product.quota - totalBooked} 組)`);
        }

        // 計算金額
        const total_amount = product.pre_price * quantity;
        const deposit_paid = product.need_deposit ? (product.deposit_amount * quantity) : 0;
        const balance_amount = total_amount - deposit_paid;
        
        // 產生訂單編號
        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
        const order_no = `ORD-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

        const insertQuery = `
            INSERT INTO orders (order_no, uid, product_id, quantity, total_amount, deposit_paid, balance_amount, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, order_no
        `;
        const result = await client.query(insertQuery, [
            order_no, uid, product_id, quantity, total_amount, deposit_paid, balance_amount, '交易中'
        ]);

        await client.query('COMMIT');
        res.json({ success: true, data: result.rows[0], message: '預購成功' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('下單失敗:', err);
        res.status(400).json({ success: false, message: err.message || '下單失敗' });
    } finally {
        client.release();
    }
});

//  取得個人的預購訂單清單
app.get('/api/users/:uid/orders', async (req, res) => {
    const { uid } = req.params;
    try {
        const query = `
            SELECT o.*, p.name as product_name, p.image_url, p.year_month
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.uid = $1
            ORDER BY o.order_time DESC
        `;
        const result = await pool.query(query, [uid]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: '讀取訂單失敗' });
    }
});


app.listen(PORT, () => {
  console.log(`Wanwangee Server is running on port ${PORT}`);
});
