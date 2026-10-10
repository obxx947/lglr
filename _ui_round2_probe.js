/* 本轮改动验收：①simulator 每支舰队面板有「增加战舰/增加增援」按钮、旧「舰船库」卡片已删、
      点按钮能按目标舰队+段落打开选船弹窗 ②neuron3d 有缩放 API + 手机端媒体查询 ③features 有当前状态块 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 180000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));

    /* ① simulator */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(4500);
    const r1 = await p.evaluate(() => {
        const panels = [...document.querySelectorAll('.fleet-panel')];
        const btnCount = panels.reduce((n, el) => n + [...el.querySelectorAll('button')].filter(x => /增加战舰|增加增援/.test(x.textContent)).length, 0);
        const oldCard = !!document.getElementById('shipSelection');
        const hasStitch = !!document.getElementById('stitchCb');
        const hasCustomBtn = [...document.querySelectorAll('button')].some(x => x.textContent.includes('自定义舰船'));
        // 点第一支舰队的「增加战舰」→ 弹窗应打开且目标=该舰队/main
        let picker = null;
        try {
            const p0 = panels[0];
            const btn = [...p0.querySelectorAll('button')].find(x => x.textContent.includes('增加战舰'));
            btn.click();
            picker = { shown: document.getElementById('shipPickerModal').classList.contains('active'), fleet: spkFleetType, tab: spkTab };
            closeShipPicker();
        } catch (e) { picker = { error: String(e.message) }; }
        return { panels: panels.length, btnCount, oldCard, hasStitch, hasCustomBtn, picker };
    });
    console.log('① simulator：面板数 =', r1.panels, '｜增加按钮数 =', r1.btnCount, '（应 8）｜旧舰船库卡片还在 =', r1.oldCard, '｜缝合开关还在 =', r1.hasStitch, '｜自定义舰船按钮 =', r1.hasCustomBtn);
    console.log('   点「增加战舰」→', JSON.stringify(r1.picker));

    /* ② neuron3d：静态断言（页面在无头环境 rAF 渲染会拖慢，改查源码 + Node 单测见 _net3d_unit.js） */
    const n3 = require('fs').readFileSync(__dirname + '/neuron3d.html', 'utf8');
    const r2 = {
        mediaCss: n3.includes('max-width:760px'),
        tipsHasZoom: n3.includes('缩放'),
        zoomBtns: (n3.match(/view\.zoomIn\(\)|view\.zoomOut\(\)|view\.resetZoom\(\)/g) || []).length
    };
    console.log('② neuron3d（静态）：手机媒体查询 =', r2.mediaCss, '｜提示含缩放 =', r2.tipsHasZoom, '｜缩放按钮/调用数 =', r2.zoomBtns);

    /* ③ features */
    await p.goto('http://127.0.0.1:3888/features.html', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    const r3 = await p.evaluate(() => {
        const t = document.body.innerText;
        return { cur: t.includes('当前状态（2026-10-07'), mech: t.includes('set_ship_mechanic'), engine: t.includes('真引擎推演'), oldNote: t.includes('已停用') };
    });
    console.log('③ features：当前状态块 =', r3.cur, '｜含 set_ship_mechanic =', r3.mech, '｜含真引擎 =', r3.engine, '｜旧章节已加停用说明 =', r3.oldNote);

    const pass = r1.panels === 4 && r1.btnCount === 8 && !r1.oldCard && r1.hasStitch && r1.hasCustomBtn && r1.picker.shown && r1.picker.fleet === 'ally-escort' && r1.picker.tab === 'main'
        && r2.mediaCss && r2.tipsHasZoom && r2.zoomBtns === 3
        && r3.cur && r3.mech && r3.engine && r3.oldNote && !errs.length;
    console.log('页面错误:', errs.length ? errs.slice(0, 3) : '无');
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
