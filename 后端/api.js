const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cors = require('cors');
const https = require('https');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const DB_PATH = '/srv/fund-app/funds.db';

// --- 1. 初始化数据库 ---
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
    // 基础数据表 (存储项目信息)
    // last_nav -> 基准参考值
    // est_nav -> 动态监测值
    db.run(`CREATE TABLE IF NOT EXISTS funds (
        code TEXT PRIMARY KEY, name TEXT, last_nav TEXT, last_date TEXT, 
        est_nav TEXT, est_rate TEXT, update_time TEXT
    )`);
    // 历史记录表 (用于绘制趋势)
    db.run(`CREATE TABLE IF NOT EXISTS fund_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, est_nav REAL, 
        time_str TEXT, date_str TEXT
    )`);
    // 用户反馈表
    db.run(`CREATE TABLE IF NOT EXISTS feedbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type INTEGER, content TEXT, 
        contact TEXT, created_at TEXT
    )`);
});

const activeMonitors = new Set();
let lastNightlyUpdateDate = ''; 

const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const client = axios.create({
    timeout: 8000,
    httpsAgent: agent,
    headers: { 'User-Agent': 'Mozilla/5.0' }
});

// --- 辅助函数 ---
function getBeijingTime() {
    return new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Shanghai"}));
}

function getTodayStr() {
    const now = getBeijingTime();
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 活跃时间段 (监测数据变动的时间窗口)
function isTradingTime() {
    const now = getBeijingTime();
    const day = now.getDay();
    const t = now.getHours() * 100 + now.getMinutes();
    if (day === 0 || day === 6) return false; 
    return (t >= 915 && t <= 1130) || (t >= 1300 && t <= 1505);
}

function getStockPrefix(code) {
    if (/^6/.test(code)) return `sh${code}`;
    if (/^(0|3)/.test(code)) return `sz${code}`;
    return `sh${code}`;
}

// --- 获取远程源数据 (用于校准) ---
async function fetchOfficialData(code) {
    try {
        const url = `http://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
        const res = await client.get(url);
        const match = res.data.match(/jsonpgz\((.*?)\);/);
        if (match && match[1]) {
            const data = JSON.parse(match[1]);
            return {
                name: data.name,
                last_nav: data.dwjz,   // 昨收/基准值
                last_date: data.jzrq,  // 日期
                est_nav: data.gsz,     // 当前监测值
                est_rate: data.gszzl,  // 变动比率
                time: data.gztime
            };
        }
    } catch (e) {
        // 忽略网络错误
    }
    return null;
}

// --- 晚间校准任务 (21:00) ---
function runNightlyCalibration() {
    console.log('🌙 [系统校准] 开始同步源数据...');
    
    db.all("SELECT code FROM funds", [], async (err, rows) => {
        if (err || !rows) return;
        
        let count = 0;
        const updateTime = getBeijingTime().toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"});

        for (const row of rows) {
            const offData = await fetchOfficialData(row.code);
            if (offData) {
                // 将监测值强制同步为官方基准值，消除误差
                db.run(`UPDATE funds SET 
                    last_nav = ?, 
                    est_nav = ?,  
                    est_rate = ?, 
                    last_date = ?, 
                    name = ?, 
                    update_time = ? 
                    WHERE code = ?`, 
                    [
                        offData.last_nav, 
                        offData.last_nav, 
                        offData.est_rate, 
                        offData.last_date,
                        offData.name,
                        updateTime,
                        row.code
                    ]);
                count++;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        console.log(`🌙 [校准完成] 已同步 ${count} 条数据。`);
    });
}

// --- 核心计算逻辑 (根据组成权重计算变动) ---
async function performCalculation(fundCode, dbLastNav, dbName) {
    try {
        // 获取配置组成
        const hUrl = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${fundCode}&topline=10`;
        const hRes = await client.get(hUrl);
        const holdings = [];
        const codeRegex = />(\d{6})<\/a>/g;
        const percentRegex = /<td class='tor'>([\d\.]+)%<\/td>/g;
        let cM, pM;
        while ((cM = codeRegex.exec(hRes.data)) && (pM = percentRegex.exec(hRes.data))) {
            holdings.push({ code: getStockPrefix(cM[1]), percent: parseFloat(pM[1]) });
            if (holdings.length >= 10) break;
        }

        // 获取类型权重
        const pUrl = `https://fundf10.eastmoney.com/zcpz_${fundCode}.html`;
        const pRes = await client.get(pUrl);
        const sMatch = pRes.data.match(/股票占净比.*?<td class='tor'>([\d\.]+)%<\/td>/);
        const bMatch = pRes.data.match(/债券占净比.*?<td class='tor'>([\d\.]+)%<\/td>/);
        const stockWeight = sMatch ? parseFloat(sMatch[1]) : 88.0;
        const bondWeight = bMatch ? parseFloat(bMatch[1]) : 0.0;

        if (!holdings.length) return null; 
        const stockCodes = holdings.map(h => h.code).join(',');
        const qRes = await client.get(`http://qt.gtimg.cn/q=${stockCodes},sh000012`, { responseType: 'arraybuffer' });
        const marketData = new TextDecoder('gbk').decode(qRes.data);

        let stockChange = 0;
        let top10Weight = 0;
        holdings.forEach(s => {
            const m = marketData.match(new RegExp(`v_${s.code}="([^"]+)"`));
            if (m) {
                const d = m[1].split('~');
                const close = parseFloat(d[4]);
                if (close > 0) {
                    stockChange += ((parseFloat(d[3]) - close) / close) * s.percent;
                    top10Weight += s.percent;
                }
            }
        });

        let bondRate = 0;
        const bM = marketData.match(/v_sh000012="([^"]+)"/);
        if (bM) {
            const d = bM[1].split('~');
            bondRate = (parseFloat(d[3]) - parseFloat(d[4])) / parseFloat(d[4]);
        }

        let finalRate = 0;
        if (top10Weight > 0) {
            const avgStockRate = stockChange / top10Weight;
            finalRate = (avgStockRate * stockWeight / 100) + (bondRate * bondWeight / 100);
        }

        const baseNav = dbLastNav || 1.0;
        const estNav = baseNav * (1 + finalRate);
        const nowObj = getBeijingTime();
        const timeStr = `${nowObj.getHours().toString().padStart(2,'0')}:${nowObj.getMinutes().toString().padStart(2,'0')}`;
        const dateStr = getTodayStr();

        // 写入趋势数据 (仅活跃时段)
        db.get(`SELECT id FROM fund_history WHERE code = ? AND date_str = ? AND time_str = ?`, 
            [fundCode, dateStr, timeStr], (err, row) => {
            if (!row) {
                db.run(`INSERT INTO fund_history (code, est_nav, time_str, date_str) VALUES (?, ?, ?, ?)`, 
                    [fundCode, estNav, timeStr, dateStr]);
            }
        });

        const updateTimeStr = nowObj.toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"});
        db.run(`INSERT OR REPLACE INTO funds (code, name, last_nav, last_date, est_nav, est_rate, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
            [fundCode, dbName, baseNav, dateStr, estNav.toFixed(4), (finalRate * 100).toFixed(2), updateTimeStr]);

        return { estNav: estNav.toFixed(4), estRate: (finalRate * 100).toFixed(2), time: updateTimeStr, lastNav: baseNav };
    } catch (e) { return null; }
}

// --- 定时任务 ---
// 1. 活跃时段每60秒更新监测值
setInterval(() => {
    if (isTradingTime()) {
        activeMonitors.forEach(code => {
            db.get('SELECT last_nav, name FROM funds WHERE code = ?', [code], (err, row) => {
                if (row) performCalculation(code, row.last_nav, row.name);
            });
        });
    } else {
        activeMonitors.clear(); 
    }
}, 60 * 1000);

// 2. 每天 21:00 执行数据校准
setInterval(() => {
    const now = getBeijingTime();
    const hour = now.getHours();
    const todayStr = getTodayStr();
    if (hour === 21 && lastNightlyUpdateDate !== todayStr) {
        lastNightlyUpdateDate = todayStr;
        runNightlyCalibration();
    }
}, 30 * 1000);


// ================= API 接口 =================

// 1. 获取监测数据
app.get('/api/valuation', async (req, res) => {
    const code = req.query.code;
    if (code && isTradingTime()) activeMonitors.add(code);

    db.get('SELECT * FROM funds WHERE code = ?', [code], async (err, row) => {
        if (isTradingTime()) {
            if (row && row.update_time) {
                const now = getBeijingTime();
                const dbTimeStr = row.update_time.split(' ')[1] || '';
                const currentMinute = `${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
                if (dbTimeStr.startsWith(currentMinute)) return res.json({ code: 200, data: row });
            }
            let lastNav = row ? parseFloat(row.last_nav) : 1.0;
            let name = row ? row.name : '未命名';
            if (!row) {
                const offData = await fetchOfficialData(code);
                if (offData) { name = offData.name; lastNav = offData.last_nav; }
            }
            const result = await performCalculation(code, lastNav, name);
            if (result) {
                res.json({ code: 200, data: { ...row, name, est_nav: result.estNav, est_rate: result.estRate, update_time: result.time, last_nav: lastNav } });
            } else {
                res.json({ code: 200, data: row || {} });
            }
        } else {
            res.json({ code: 200, data: row || {} });
        }
    });
});

// 2. 获取趋势记录
app.get('/api/history', (req, res) => {
    const code = req.query.code;
    const today = getTodayStr();
    db.all(`SELECT time_str, est_nav FROM fund_history WHERE code = ? AND date_str = ? ORDER BY time_str ASC`, [code, today], (err, rows) => {
        res.json({ code: 200, data: rows || [] });
    });
});

// 3. 用户反馈
app.post('/api/feedback', (req, res) => {
    const { type, content, contact } = req.body;
    if (!content) return res.json({ code: 400, msg: '无内容' });
    const timeStr = getBeijingTime().toLocaleString('zh-CN');
    db.run(`INSERT INTO feedbacks (type, content, contact, created_at) VALUES (?, ?, ?, ?)`, 
        [type, content, contact, timeStr], () => res.json({ code: 200 }));
});

// 4. 反馈列表
app.get('/api/admin/feedbacks', (req, res) => {
    db.all("SELECT * FROM feedbacks ORDER BY id DESC", [], (err, rows) => res.json({ code: 200, data: rows }));
});

app.listen(3000, () => { console.log('API V19.0 (Data Monitor) Running'); });