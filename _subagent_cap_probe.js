/* 缺口一验证（真跑）：子Agent返回是否"只回结论+证据"、不灌检索原文、且超长被截断。
   做法：真实 LLM 跑一轮（让主Agent派 2 个子Agent做知识库检索型任务），
   用 puppeteer 的 request 事件拦截发往 LLM 的请求体（不依赖页面内 fetch hook，XHR/fetch 都能抓），
   从后来那次请求里取出 run_subagents 的工具结果 JSON，逐个子Agent量：
     ① result 长度（应 ≤1200，且远小于旧上限 3000）
     ② 是否出现"原文粘贴"特征（清洗后 md 的章节头 ## 结论 / ## 配队与模块 / ## 数值与数据 / > 场景）
     ③ 是否引用了来源文件名（应有）
   用法：先起静态服务（3888），再 DS_KEY=sk-xxx node _subagent_cap_probe.js（key 只从环境变量读，禁止写进文件） */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const KEY = process.env.DS_KEY || '';
if (!KEY) { console.error('缺少 DS_KEY：请用  DS_KEY=sk-xxx node _subagent_cap_probe.js  运行'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DUMP_MARKS = ['## 结论', '## 配队与模块', '## 数值与数据', '> 场景', '## 结论思路'];

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
    /* ★ 拦截所有发往 chat/completions 的请求体 */
    const bodies = [];
    p.on('request', req => {
        try { if (req.method() === 'POST' && req.url().indexOf('chat/completions') >= 0) bodies.push(req.postData() || ''); } catch (e) { }
    });
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(3500);
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
        ta.value = '派 2 个子Agent 并行去知识库查资料：A 查《永恒风暴级-攻击战列巡洋舰》的实战评价至少3条；B 查《CV3000级-快速航空母舰》的实战评价至少3条。要求它们给出结论并注明来源文件名。然后你（主Agent）汇总成一段话。';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        doSend();
    });
    let sawSub = [], ans = '';
    for (let i = 0; i < 100; i++) {
        await sleep(3000);
        const st = await p.evaluate(() => {
            const subs = Array.from(document.querySelectorAll('#chatMsgs *')).map(x => x.textContent || '').join('\n');
            const m = subs.match(/🤖[^\n]{0,80}|✅[^\n]{0,80}/g) || [];
            const ansEl = document.querySelector('#chatMsgs .msg.assistant:last-of-type');
            return { subs: m.slice(-6), answer: ansEl ? (ansEl.textContent || '').slice(0, 300) : '', streaming: typeof isStreaming !== 'undefined' ? isStreaming : null };
        });
        if (st.subs.join('|') !== sawSub.join('|')) { sawSub = st.subs; console.log('  进展:', st.subs.map(x => x.slice(0, 70))); }
        if (st.answer && st.streaming === false) { ans = st.answer; break; }
    }
    console.log('\n⑤ 主Agent最终回答（前300字）:', ans ? ans : '（未取到）');

    /* === 从请求体里取出 run_subagents 的工具结果 === */
    console.log('\n=== 请求体拦截：共 ' + bodies.length + ' 条 LLM 请求 ===');
    require('fs').writeFileSync(__dirname + '/_subagent_cap_probe_bodies.json', JSON.stringify(bodies), 'utf8');
    let report = null, reqIdx = -1;
    for (let i = 0; i < bodies.length; i++) {
        try {
            const j = JSON.parse(bodies[i]);
            for (const m of (j.messages || [])) {
                if (m.role !== 'tool') continue;
                let c = null;
                try { c = JSON.parse(m.content); } catch (e) { continue; }
                if (c && Array.isArray(c.agents)) { report = c; reqIdx = i; break; }
            }
        } catch (e) { }
        if (report) break;
    }
    if (!report) { console.log('❌ 没抓到最后一次含子Agent结果的请求体（可能本轮没派子Agent）'); }
    else {
        console.log('（在第 ' + (reqIdx + 1) + ' 条请求里找到 run_subagents 工具结果）');
        const per = (report.agents || []).map(a => ({ 名字: a.name, 成功: a.ok, 轮数: a.rounds, 工具次数: a.toolCalls, 结果字数: String(a.result || '').length }));
        console.table(per);
        let dump = 0, cite = 0, capHit = 0, worst = 0;
        (report.agents || []).forEach(a => {
            const r = String(a.result || '');
            worst = Math.max(worst, r.length);
            DUMP_MARKS.forEach(mk => { dump += r.split(mk).length - 1; });
            if (/\.md|资料|实例|舰船资料/.test(r)) cite++;
            if (r.indexOf('超长已截断') >= 0) capHit++;
        });
        console.log('判定：最大结果字数=' + worst + '（上限1200）｜截断命中=' + capHit + '｜含来源引用=' + cite + '/' + (report.agents || []).length + '｜原文粘贴特征(' + DUMP_MARKS.join('/') + '出现次数)=' + dump);
        console.log('结论：' + (worst <= 1200 && dump === 0 ? '✅ 全部子Agent只回结论+证据、无原文粘贴、在长度上限内' : '⚠️ 有问题，见上'));
        console.log('\n--- 第1个子Agent返回的全文（供人工核对）---\n' + String((report.agents[0] || {}).result || '').slice(0, 1500));
    }
    console.log('\n页面错误:', errs.length ? errs.slice(0, 5) : '无');
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 250)); process.exit(1); });
