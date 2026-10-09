/* chat.html 改动回归冒烟（不花 LLM 钱）：
   ① 页面无错 ② 注入"带运行快照 + 未完成标记"的会话 → switchConv 后应恢复：已思考折叠块 / AI运行状态折叠块 / ⚠️未完成+重发按钮
   ③ activeConv 已写入 localStorage ④ postMessage 断言新函数存在 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(2500);
    const fns = await p.evaluate(() => ({
        resendPendingRound: typeof resendPendingRound, _snapshotRun: typeof _snapshotRun, hydrateRun: typeof hydrateRun
    }));
    console.log('① 新函数存在性:', JSON.stringify(fns));

    const r = await p.evaluate(() => {
        const conv = { id: 't1', title: '测试会话', createdAt: Date.now(), messages: [
            { role: 'user', content: '测试提问' },
            { role: 'assistant', content: '回答正文OK', meta: { sources: [], run: { sec: 12, think: '思考内容X', status: ['🔧 调用工具: x', '✅ 完成'] } } }
        ], pendingRound: { startLen: 1, startedAt: Date.now() } };
        conversations['t1'] = conv;
        switchConv('t1');
        return {
            thinkAcc: document.querySelectorAll('#chatMsgs .think-acc').length,
            statusAcc: document.querySelectorAll('#chatMsgs .status-acc').length,
            thinkHead: (document.querySelector('#chatMsgs .think-acc .acc-head span') || {}).textContent || '',
            statusHead: (document.querySelector('#chatMsgs .status-acc .acc-head span') || {}).textContent || '',
            retryBtn: !!document.querySelector('#chatMsgs button[onclick="resendPendingRound()"]'),
            activeStored: localStorage.getItem('lglr_active_conv')
        };
    });
    console.log('② 恢复结果:', JSON.stringify(r, null, 1));
    console.log('③ 页面错误:', errs.length ? errs.slice(0, 3) : '无');
    const pass = r.thinkAcc === 1 && r.statusAcc === 1 && r.retryBtn && r.activeStored === 't1' && fns.resendPendingRound === 'function' && !errs.length;
    console.log(pass ? '\n✅ 回归冒烟通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
