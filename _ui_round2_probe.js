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
        const panelBtns = panels.reduce((n, el) => n + [...el.querySelectorAll('button')].filter(x => /增加战舰|增加增援/.test(x.textContent)).length, 0);
        const oldCard = !!document.getElementById('shipSelection');
        const hasStitch = !!document.getElementById('stitchCb');
        const hasMgrBtn = [...document.querySelectorAll('button')].some(x => x.textContent.includes('自定义舰船'));
        // 点开第一支舰队 → 下方编辑区应出现（配队页同款：两段切换 + 整宽加船按钮）
        let ed = null;
        try {
            panels[0].click();
            const ie = document.getElementById('inlineFleetEditor');
            const addBtn = [...ie.querySelectorAll('button')].find(x => /增加战舰|增加增援/.test(x.textContent));
            ed = { shown: ie.style.display !== 'none', hasAddBtn: !!addBtn, addLabel: addBtn ? addBtn.textContent.trim().slice(0, 12) : '',
                   hasReinfTab: /增援舰队/.test(ie.textContent), hasMainTab: /主舰队/.test(ie.textContent) };
            // 点整宽加船按钮 → 弹窗打开且目标=该舰队+当前段落
            if (addBtn) { addBtn.click(); ed.picker = { shown: document.getElementById('shipPickerModal').classList.contains('active'), fleet: spkFleetType, tab: spkTab }; closeShipPicker(); }
        } catch (e) { ed = { error: String(e.message) }; }
        return { panels: panels.length, panelBtns, oldCard, hasStitch, hasMgrBtn, ed };
    });
    console.log('① simulator：面板数 =', r1.panels, '｜面板内加船按钮 =', r1.panelBtns, '（应 0，已撤回）｜旧舰船库卡片 =', r1.oldCard, '｜缝合开关 =', r1.hasStitch, '｜管理按钮 =', r1.hasMgrBtn);
    console.log('   点舰队 → 编辑区:', JSON.stringify(r1.ed));

    /* ①b 配队页：tabs 行有「⚙️ 自定义舰船」入口 + 管理弹窗带列表条 */
    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'load' });
    await sleep(2800);
    const r1b = await p.evaluate(() => {
        const tabBtn = [...document.querySelectorAll('.tabs button')].some(x => x.textContent.includes('自定义舰船'));
        // 先造一艘，验证管理列表会列出它
        localStorage.setItem('lagrange_custom_ships', JSON.stringify({ custom_mgr1: { id: 'custom_mgr1', name: '管理测试舰', variant: '自定义', condEffects: [] } }));
        CustomShip.open();
        const listChips = [...document.querySelectorAll('#csList .cs-chip')].map(x => x.textContent);
        const hasNew = [...document.querySelectorAll('#customShipOverlay button')].some(x => x.textContent.includes('新建'));
        CustomShip.close();
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}'); delete all.custom_mgr1; localStorage.setItem('lagrange_custom_ships', JSON.stringify(all));
        return { tabBtn, listChips, hasNew };
    });
    console.log('①b 配队页：tabs 入口 =', r1b.tabBtn, '｜管理列表 =', JSON.stringify(r1b.listChips), '｜有新建按钮 =', r1b.hasNew);

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

    const pass = r1.panels === 4 && r1.panelBtns === 0 && !r1.oldCard && r1.hasStitch && r1.hasMgrBtn && r1.ed.shown && r1.ed.hasAddBtn && r1.ed.hasReinfTab && r1.ed.hasMainTab && r1.ed.picker && r1.ed.picker.shown && r1.ed.picker.fleet === 'ally-escort' && r1.ed.picker.tab === 'main'
        && r2.mediaCss && r2.tipsHasZoom && r2.zoomBtns === 3
        && r1b.tabBtn && r1b.listChips.includes('管理测试舰') && r1b.hasNew && r3.cur && r3.mech && r3.engine && r3.oldNote && !errs.length;
    console.log('页面错误:', errs.length ? errs.slice(0, 3) : '无');
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
