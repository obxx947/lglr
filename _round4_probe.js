/* 第四轮验收：
   ①机制开关：关掉的机制【不进战斗】——页面侧跑两场（on:false vs 开启）对比 _condFired
   ②开关 UI：toggleMech 写 on:false / 删除 on；清单显示"启用 N 条"
   ③提议流程：AI 输出 json 不再直接写 → 出现提议卡（✅写入/✕忽略）→ 点写入才落库；点忽略不落库
   ④提示词：sysPrompt 含"绝对不要输出 json"（没让你写就别写） */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CUSTOM = {
    id: 'custom_onoff', name: '开关测试舰', variant: '自定义', type: 'cruiser', size: 'small', position: '中排',
    hp: 120000, physicalArmor: 150, energyArmor: 10, commandValue: 15, serviceLimit: 8,
    speed: { cruise: '500-1200', warp: 2500 },
    modules: { M1: { name: '主武器系统', type: 'weapon', weapons: [{ name: '测试炮', dmgType: 'physical', weaponType: 'direct', singleDmg: 3000, cooldown: 6, lockTime: 4, atkDuration: 2, ammo: 1, attacks: 1, lockEfficiency: 100, priority: 'small', targets: [{ types: ['巡洋舰'], hitMin: 70, hitMax: 90 }] }] } },
    condEffects: [{ cond: { kind: 'battleStart' }, stat: 'dmgBonus', val: 100, note: '开场伤害翻倍' }]
};
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));

    /* ① 关掉的机制不进战斗（模拟器页真跑） */
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(2000);
    await p.evaluate(cs => localStorage.setItem('lagrange_custom_ships', JSON.stringify({ [cs.id]: cs })), CUSTOM);
    await p.reload({ waitUntil: 'load' });
    await sleep(4500);
    const r1 = await p.evaluate((id) => {
        function run(off) {
            const s = JSON.parse(JSON.stringify(SHIP_DATABASE[id]));
            s.condEffects = JSON.parse(JSON.stringify(SHIP_DATABASE[id].condEffects || []));
            if (off) s.condEffects.forEach(c => c.on = false); else s.condEffects.forEach(c => { delete c.on; });
            SHIP_DATABASE[id] = s;
            const mk = (src, n) => { const e = JSON.parse(JSON.stringify(src)); e.count = n; try { e.uid = ensureUid(e); } catch (x) { } return e; };
            Object.keys(fleetData).forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].flagship = null; });
            fleetData['ally-escort'].main = [mk(s, 3)];
            const en = JSON.parse(JSON.stringify(s)); en.condEffects = []; fleetData['enemy-escort'].main = [mk(en, 3)];
            prepareBattle();
            let t = 0; while (battleState && !battleState.ended && t < 3000) { processBattleTick(0.5); t += 0.5; }
            const A = battleState.allyShips || [];
            return { fired: A.reduce((n, x) => n + (x._condFired || 0), 0), copied: A.reduce((n, x) => n + ((x.condEffects || []).length ? 1 : 0), 0), t: Math.round(t) };
        }
        const off = run(true), on = run(false);
        Object.keys(fleetData).forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; });
        return { off, on };
    }, CUSTOM.id);
    console.log('① 关掉的机制：触发数 =', r1.off.fired, '（应 0）｜实例带机制艘数 =', r1.off.copied, '（应 0）');
    console.log('   开启的机制：触发数 =', r1.on.fired, '（应 >0）｜实例带机制艘数 =', r1.on.copied, '（应 3）');

    /* ② + ③ 配队页：开关 UI + 提议流程 */
    await p.goto('http://127.0.0.1:3888/fleet.html', { waitUntil: 'load' });
    await sleep(2800);
    const r23 = await p.evaluate(async (cs) => {
        localStorage.setItem('lagrange_custom_ships', JSON.stringify({ [cs.id]: JSON.parse(JSON.stringify(cs)) }));
        localStorage.setItem('lagrange_static_config', JSON.stringify({ models: [{ id: 'main', name: 'stub', api_key: 'stub', api_url: 'https://api.deepseek.com', model: 'deepseek-chat' }], active_model_id: 'main' }));
        /* 开关：关掉那条 */
        CustomShip.open(cs.id);
        CustomShip.toggleMech(0, false);
        const afterOff = JSON.parse(localStorage.getItem('lagrange_custom_ships'))[cs.id].condEffects[0];
        const cntText1 = document.getElementById('csMechCnt').textContent;
        CustomShip.toggleMech(0, true);
        const afterOn = JSON.parse(localStorage.getItem('lagrange_custom_ships'))[cs.id].condEffects[0];
        /* 提议流程：stub 让 AI 输出一条新机制 */
        let calls = 0;
        window.fetch = async (u) => {
            if (String(u).includes('/chat/completions')) {
                calls++;
                return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '给你一条。\n```json\n{"mechanics":[{"when":{"kind":"everySec","threshold":30,"dur":5},"then":{"cooldownReduction":20},"note":"周期加速"}]}\n```' }, finish_reason: 'stop' }] }) };
            }
            return new Response('', { status: 404 });
        };
        document.getElementById('csChatInput').value = '给我加一条';
        await CustomShip.send();
        const beforeApply = (JSON.parse(localStorage.getItem('lagrange_custom_ships'))[cs.id].condEffects || []).length;
        const pendBtnShown = document.getElementById('csChat').innerHTML.includes('applyPending');
        const sysHasPromptRule = true; // 提示词在 sysPrompt 里，静态断言见下
        CustomShip.applyPending();
        const afterApply = (JSON.parse(localStorage.getItem('lagrange_custom_ships'))[cs.id].condEffects || []).length;
        /* 忽略路径 */
        document.getElementById('csChatInput').value = '再来一条';
        await CustomShip.send();
        const beforeIgnore = (JSON.parse(localStorage.getItem('lagrange_custom_ships'))[cs.id].condEffects || []).length;
        CustomShip.discardPending();
        const afterIgnore = (JSON.parse(localStorage.getItem('lagrange_custom_ships'))[cs.id].condEffects || []).length;
        /* 清理 */
        const all = JSON.parse(localStorage.getItem('lagrange_custom_ships') || '{}'); delete all[cs.id]; localStorage.setItem('lagrange_custom_ships', JSON.stringify(all));
        return { afterOff: afterOff.on, cntText1: cntText1, afterOnOn: afterOn.on, beforeApply: beforeApply, pendBtnShown: pendBtnShown, afterApply: afterApply, beforeIgnore: beforeIgnore, afterIgnore: afterIgnore, calls: calls };
    }, CUSTOM);
    console.log('② 开关：关掉后 on =', r23.afterOff, '（应 false）｜清单 =', r23.cntText1.trim(), '｜再开启后 on =', r23.afterOnOn, '（应 undefined）');
    console.log('③ 提议：写入前机制数 =', r23.beforeApply, '（应 1，未自动写）｜提议卡带按钮 =', r23.pendBtnShown, '｜点✅写入后 =', r23.afterApply, '（应 1，整份替换）｜点✕忽略后 =', r23.afterIgnore, '（应不变 1）');

    /* ④ 提示词静态断言 */
    const css = require('fs').readFileSync(__dirname + '/js/custom_ship.js', 'utf8');
    const r4 = { noJsonRule: css.includes('绝对不要输出 json'), onRule: css.includes('启用开关'), pendingRule: css.includes('页面**不会直接写入**') };
    console.log('④ 提示词铁律：没让你写就别写 =', r4.noJsonRule, '｜on 说明 =', r4.onRule, '｜提议说明 =', r4.pendingRule);

    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    const pass = r1.off.fired === 0 && r1.off.copied === 0 && r1.on.fired > 0 && r1.on.copied === 3
        && r23.afterOff === false && /启用 0 条/.test(r23.cntText1) && r23.afterOnOn === undefined
        && r23.beforeApply === 1 && r23.pendBtnShown && r23.afterApply === 1 && r23.afterIgnore === 1
        && r4.noJsonRule && r4.onRule && r4.pendingRule && !errs.length;
    console.log(pass ? '\n✅ 全部通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
