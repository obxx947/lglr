/* 自定义舰船 + 机制 + 首页跳转 验收（不花 LLM 钱）
   ① index.html 打开应跳转到 chat.html
   ② fleet.html：注入一艘自定义舰 → ALL/ALLMAP 认识它、FleetCheck 不报"未知舰船"、导出带 _ship 快照
   ③ simulator.html：__engineAddMechanic 可用且白名单校验正确、写入 localStorage
   ④ chat 页：抽出 setShipMechanic 源码跑（AI 工具口径）——合法写入/非法拒绝 */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CUSTOM = {
    id: 'custom_probe1', name: '测试舰', variant: '自定义', type: 'cruiser', size: 'small', position: '中排',
    hp: 100000, physicalArmor: 200, energyArmor: 10, commandValue: 15, serviceLimit: 5,
    modules: { M1: { name: '主武器系统', type: 'weapon', weapons: [{ name: '测试炮', dmgType: 'physical', singleDmg: 2000, cooldown: 6, lockTime: 4, atkDuration: 2, ammo: 1, attacks: 1, targets: [{ types: ['巡洋舰'], hitMin: 60, hitMax: 80 }] }] } },
    condEffects: []
};
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 180000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));

    /* ① index.html 跳转 */
    await p.goto('http://127.0.0.1:3888/index.html', { waitUntil: 'domcontentloaded' });
    await sleep(1500);
    console.log('① index.html 跳转到:', p.url());

    /* 种子：写入自定义舰 */
    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'domcontentloaded' });
    await sleep(1200);
    await p.evaluate(cs => localStorage.setItem('lagrange_custom_ships', JSON.stringify({ [cs.id]: cs })), CUSTOM);
    await p.reload({ waitUntil: 'load' }); await sleep(3000);

    /* ② 配队页认识自定义舰 + FleetCheck 放行（FleetCheck 期望条目已带 id/name） */
    const r2 = await p.evaluate(() => {
        const inALL = ALL.some(s => s.id === 'custom_probe1');
        const viaGet = !!(window.SHIP_DB && SHIP_DB.get('custom_probe1'));
        let fc = null;
        try { fc = FleetCheck.check({ main: [{ id: 'custom_probe1', name: '测试舰', count: 1 }] }, {}); } catch (e) { fc = { error: String(e.message) }; }
        const errs2 = (fc && fc.errors) || [];
        return { inALL, viaGet, fcErrors: errs2, hasUnknownErr: errs2.some(x => String(x).includes('未知') || String(x).includes('不是舰船库')) };
    });
    console.log('② 配队页：自定义舰在列表 =', r2.inALL, '｜SHIP_DB.get 认识 =', r2.viaGet, '｜FleetCheck 报错 =', JSON.stringify(r2.fcErrors), '｜含"未知舰船"错误 =', r2.hasUnknownErr);

    /* ②b 把自定义舰加进当前舰队 → 导出应带 _ship 快照 */
    const r2c = await p.evaluate(() => {
        try {
            pickMode = 'ship'; pickSection = 'main'; pickSel = ['custom_probe1'];
            confirmPick();
            const out = exportFleet();
            const item = (out.main || [])[0] || {};
            return { itemCount: (out.main || []).length, got: !!item._ship, hasCond: !!(item._ship && Array.isArray(item._ship.condEffects)), name: item.name, qty: item.qty };
        } catch (e) { return { error: String(e.message) }; }
    });
    console.log('②b 加进舰队后 exportFleet：船数 =', r2c.itemCount, '｜_ship 快照 =', r2c.got, '｜含 condEffects =', r2c.hasCond, r2c.error ? ('｜错误: ' + r2c.error) : '');

    /* ③ simulator：__engineAddMechanic 白名单校验 + 写入 */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    const r3 = await p.evaluate(() => {
        if (typeof window.__engineAddMechanic !== 'function') return { fn: false };
        const okRes = window.__engineAddMechanic('custom_probe1', [{ when: { kind: 'hpBelow', threshold: 50, dur: 10, cd: 20 }, then: { dmgBonus: 30 }, note: '半血狂暴' }], true);
        const badRes = window.__engineAddMechanic('custom_probe1', [{ when: { kind: 'whenSomething' }, then: { dmgBonus: 999 } }]);
        const libRes = window.__engineAddMechanic('ST59', [{ when: { kind: 'battleStart' }, then: { dmgBonus: 10 } }]);
        const saved = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}').custom_probe1 || {};
        return { fn: true, ok: okRes.ok, 拒绝条数: (badRes.拒绝 || []).length, lib拒绝: libRes.ok === false, savedCond: (saved.condEffects || []).length, savedStat: (saved.condEffects || [])[0] && saved.condEffects[0].stat };
    });
    console.log('③ __engineAddMechanic：存在 =', r3.fn, '｜合法写入 =', r3.ok, '｜非法kind被拒 =', r3.拒绝条数 >= 1, '｜原库船被拒 =', r3.lib拒绝, '｜落盘 condEffects =', r3.savedCond, '条，首条 stat =', r3.savedStat);

    /* ④ chat 页：AI 工具 setShipMechanic（抽源码跑） */
    const src = fs.readFileSync(__dirname + '/js/agent.js', 'utf8');
    const st = src.indexOf('    function setShipMechanic(args){');
    const en = src.indexOf('    /* 旧版简化公式估算');
    const fnText = src.slice(st, en).trim();
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load' });
    await sleep(2500);
    const r4 = await p.evaluate(async (fnText) => {
        localStorage.setItem('lagrange_custom_ships', JSON.stringify({
            custom_probe1: { id: 'custom_probe1', name: '测试舰', variant: '自定义', condEffects: [] }
        }));
        const fn = new Function('return (' + fnText + ')')();
        const good = JSON.parse(fn({ ship: '测试舰', mechanics: [{ when: { kind: 'everySec', threshold: 30, dur: 5 }, then: { cooldownReduction: 25 }, note: '周期加速' }] }));
        const bad = JSON.parse(fn({ ship: '测试舰', mechanics: [{ when: { kind: 'magicWhen' }, then: { dmgBonus: 1 } }, { when: { kind: 'battleStart' }, then: { notAField: 5 } }] }));
        const lib = JSON.parse(fn({ ship: '不存在的船', mechanics: [{ when: { kind: 'battleStart' }, then: { dmgBonus: 1 } }] }));
        const saved = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}').custom_probe1 || {};
        return { good: good.ok, count: (saved.condEffects || []).length, bad: bad.ok === false && (bad.拒绝 || []).length === 2, missing: lib.ok === false };
    }, fnText);
    console.log('④ AI工具 setShipMechanic：合法写入 =', r4.good, '｜落盘【共】', r4.count, '条（含前面引擎写的 1 条）｜非法全拒 =', r4.bad, '｜找不到船被拒 =', r4.missing);

    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    const pass = p.url().includes('chat.html') && r2.inALL && r2.viaGet && !r2.hasUnknownErr && r2c.got && r2c.hasCond
        && r3.fn && r3.ok && r3.拒绝条数 >= 1 && r3.lib拒绝 && r3.savedCond >= 1
        && r4.good && r4.bad && r4.missing;
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
