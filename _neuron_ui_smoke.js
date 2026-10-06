/* 神经元实验室 · 浏览器冒烟测试 v2（轻参数；裸标识符取页面变量；崩溃捕获）
   用法：node _neuron_ui_smoke.js */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu', '--disable-extensions'] });
    const p = await b.newPage();
    const errors = [];
    let crashed = null;
    p.on('pageerror', e => errors.push('PAGEERROR: ' + String(e.message).slice(0, 300)));
    p.on('error', e => { crashed = '导航/崩溃: ' + String(e.message).slice(0, 200); });
    p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + String(m.text()).slice(0, 200)); });

    const ev = async (fn, tag) => { try { return await p.evaluate(fn); } catch (e) { console.log('  [' + tag + '] evaluate 失败：' + String(e.message).slice(0, 120)); return null; } };

    console.log('== 打开 neuron.html ==');
    await p.goto('http://127.0.0.1:3888/neuron.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(4000);
    const boot = await ev(() => ({ givenA: !!(typeof given !== 'undefined' && given.A && given.A.escort), islesMax: document.getElementById('isles').max }), 'boot');
    console.log('启动状态：', JSON.stringify(boot));

    console.log('== 设置极轻参数并开始 ==');
    await ev(() => {
        document.getElementById('isles').value = 1; document.getElementById('islesVal').textContent = '1';
        document.getElementById('pop').value = 2;
        document.getElementById('oppEval').value = 1;
        document.getElementById('gens').value = 2;
        document.getElementById('maxSec').value = 60;
        document.getElementById('stall').value = 20;
        document.getElementById('useWarm').checked = false;
        document.getElementById('autoResume').checked = false;
    }, 'cfg');
    await ev(() => startTraining(), 'start');

    console.log('== 等第 1 代 ==');
    let gen1 = null;
    for (let i = 0; i < 60; i++) {
        await sleep(5000);
        const st = await ev(() => {
            try { const s = isleState[0]; return s ? { gen: s.gen, status: s.status, hasBest: !!s.best, hasNet: !!(s.net && s.net.nodes) } : { none: true }; } catch (e) { return { err: String(e.message).slice(0, 80) }; }
        }, 'poll' + i);
        if (i % 4 === 0) console.log('  ' + (i * 5) + 's：' + JSON.stringify(st));
        if (st && st.gen >= 1 && st.hasBest && st.hasNet) { gen1 = st; break; }
        if (st === null && crashed) { console.log('  页面已崩：' + crashed); break; }
    }
    console.log('第 1 代：', JSON.stringify(gen1));

    if (gen1) {
        console.log('== 存档检查 ==');
        const snap = await ev(async () => { const s = await NeuronStore.get('kv', 'snap:0'); return s ? { gen: s.gen, hasA: !!(s.A && s.A.net) } : null; }, 'snap');
        console.log('snap:0 →', JSON.stringify(snap));

        console.log('== 暂停/继续 ==');
        await ev(() => pauseAll(), 'pause');
        await sleep(10000);
        const pst = await ev(() => ({ st: isleState[0].status, badge: document.getElementById('runBadge').textContent }), 'pst');
        console.log('暂停后：', JSON.stringify(pst));
        await ev(() => resumeAll(), 'resume');

        console.log('== 结果导出 ==');
        const rep = await ev(() => {
            const r = buildReport(); if (!r) return null;
            const cur = currentFleet(); const ai = toAIFleet(cur.fj.escort, '测试');
            return { main: r.fleet.escort.main.length, aiMain: ai.main.length, txtLen: reportText(r).length };
        }, 'rep');
        console.log('报告：', JSON.stringify(rep));
    }

    console.log('== 3D 页 ==');
    const p2 = await b.newPage();
    const errors2 = [];
    p2.on('pageerror', e => errors2.push(String(e.message).slice(0, 200)));
    try {
        await p2.goto('http://127.0.0.1:3888/neuron3d.html', { waitUntil: 'load', timeout: 60000 });
        await sleep(2500);
        await p2.evaluate(() => loadExample()); await sleep(1200);
        const d3 = await p2.evaluate(() => document.getElementById('statBox').textContent);
        console.log('3D 页：', d3, '｜错误：', errors2.length ? errors2 : '无');
    } catch (e) { console.log('3D 页失败：', String(e.message).slice(0, 150)); }

    console.log('\n===== 总结 =====');
    console.log('崩溃：', crashed || '无');
    console.log('neuron.html 错误：', errors.length ? errors.slice(0, 8) : '无');
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
