const express = require('express');
const path = require('path');
const app = express();

// Zeabur 會透過環境變數指定 Port，若沒有則預設 3000
const PORT = process.env.PORT || 3000;

// 解析 JSON 請求
app.use(express.json());

// 託管 public 資料夾內的靜態 HTML 檔案
// 例如訪問 https://您的網域.zeabur.app/index.html 即可看到前台
app.use(express.static(path.join(__dirname, 'public')));

// 測試用 API
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'TOYHEART Backend is running smoothly on Zeabur!' });
});

// ==========================================
// 預留：未來接收前端預購單的 API
// ==========================================
app.post('/api/orders', (req, res) => {
    const { userId, productName, quantity, totalDeposit } = req.body;
    console.log(`收到來自 LINE UID [${userId}] 的預購：${productName} x ${quantity}，訂金：${totalDeposit}`);
    
    // TODO: 寫入資料庫邏輯
    
    res.json({ success: true, message: '預購單建立成功！' });
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`Server is running and listening on port ${PORT}`);
});
