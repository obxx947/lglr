/* 架构改动后的浏览器验证：
   ① 页面无错 ② 顶部模式栏已消失（#modeBar 不存在）③ 底部计划/普通开关可用
   ④ run_subagents 工具已注册 ⑤ 真跑一轮：主Agent 派子Agent（走 DeepSeek，端到端）
   用法：DS_KEY=sk-xxx node _arch_smoke.js     ← key 只从环境变量读，禁止写进文件（lglr 是公开仓库） */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const KEY = process.env.DS_KEY || '';
if (!KEY) { console.error('缺少 DS_KEY：请用  DS_KEY=sk-xxx node _arch_smoke.js  运行'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(3500);

    /* ① 结构检查 */
    const s1 = await p.evaluate(() => ({
        modeBar: !!document.getElementById('modeBar'),
        modeToggle: !!document.getElementById('modeToggle'),
        setRunModeType: typeof window.setRunMode,
        paintModeType: typeof window.paintMode,
        switchModeType: typeof window.switchMode
    }));
    console.log('① 结构：', JSON.stringify(s1));

    /* ③ 底部开关：切到计划再切回 */
    const s2 = await p.evaluate(() => {
        switchMode(true);
        const on = document.getElementById('modePlan').classList.contains('on');
        const cfg1 = JSON.parse(localStorage.getItem('lagrange_static_config') || '{}').plan_mode;
        switchMode(false);
        const cfg2 = JSON.parse(localStorage.getItem('lagrange_static_config') || '{}').plan_mode;
        return { planBtnOn: on, plan_mode_after_plan: cfg1, plan_mode_after_normal: cfg2 };
    });
    console.log('③ 底部开关：', JSON.stringify(s2));

    /* ④ 工具注册 */
    const s3 = await p.evaluate(() => {
        const names = AgentEngine.getTools().map(t => t.function && t.function.name);
        return { count: names.length, has: names.indexOf('run_subagents') >= 0, names: names.slice(-6) };
    });
    console.log('④ 工具：', JSON.stringify(s3));

    /* ⑤ 端到端：配 DeepSeek key → 发一条会触发"派子Agent"的消息 */
    await p.evaluate((key) => {
        const cfg = JSON.parse(localStorage.getItem('lagrange_static_config') || '{}');
        cfg.models = [{ id: 'ds', name: 'DeepSeek(flash)', api_key: key, api_url: 'https://api.deepseek.com', model: 'deepseek-chat', provider: 'custom' }];
        cfg.active_model_id = 'ds';
        cfg.plan_mode = false;
        localStorage.setItem('lagrange_static_config', JSON.stringify(cfg));
    }, KEY);
    await p.reload({ waitUntil: 'load' }); await sleep(3500);
    await p.evaluate(() => {
        const ta = document.getElementById('chatInput');
        ta.focus();
        ta.value = '派 2 个子Agent 并行回答：A 用一句话说清"永恒风暴级-攻击战列巡洋舰"的定位；B 用一句话说清它的 C2 模块（雷暴无人机护盾系统）作用。然后你汇总成两行。';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        doSend();
    });
    let lastStatus = '', sawSub = [], ans = '';
    for (let i = 0; i < 90; i++) {
        await sleep(3000);
        const st = await p.evaluate(() => {
            const lines = Array.from(document.querySelectorAll('#chatMsgs .status-line, #chatMsgs .msg')).map(x => x.textContent || '');
            const last = lines.length ? lines[lines.length - 1] : '';
            const subs = Array.from(document.querySelectorAll('#chatMsgs *')).map(x => x.textContent || '').join('\n');
            const m = subs.match(/🤖[^\n]{0,80}/g) || [];
            const ansEl = document.querySelector('#chatMsgs .msg.assistant:last-of-type');
            return { last: last.slice(0, 120), subs: m.slice(-4), answer: ansEl ? (ansEl.textContent || '').slice(0, 400) : '', streaming: typeof isStreaming !== 'undefined' ? isStreaming : null };
        });
        if (st.subs.join('|') !== sawSub.join('|')) { sawSub = st.subs; console.log('  子Agent进展:', st.subs.map(x => x.slice(0, 70))); }
        if (st.last && st.last !== lastStatus) { lastStatus = st.last; console.log('  状态:', lastStatus); }
        if (st.answer && st.streaming === false) { ans = st.answer; break; }
    }
    console.log('⑤ 最终回答:', ans ? ans.slice(0, 300) : '（未取到）');
    console.log('页面错误:', errs.length ? errs.slice(0, 5) : '无');
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 250)); process.exit(1); });
