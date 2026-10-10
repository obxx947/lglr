/* 端到端验证：模拟器页里，自定义舰船 + 自定义机制【真的会在战斗里触发】
   做法：注入一艘自定义舰 → 直接填 fleetData → prepareBattle + processBattleTick 跑完一场
        跑两次：带机制 / 不带机制（同一套配置，唯一差异 = condEffects）
   断言：带机制那场 ①机制触发计数 _condFired > 0 ②输出明显更高 / 赢得更快 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CUSTOM = {
    id: 'custom_mechtest', name: '机制测试舰', variant: '自定义', type: 'cruiser', size: 'small', position: '中排',
    hp: 120000, physicalArmor: 150, energyArmor: 10, commandValue: 15, serviceLimit: 8,
    speed: { cruise: '500-1200', warp: 2500 },
    modules: { M1: { name: '主武器系统', type: 'weapon', weapons: [{ name: '测试炮', dmgType: 'physical', weaponType: 'direct', singleDmg: 3000, cooldown: 6, lockTime: 4, atkDuration: 2, ammo: 1, attacks: 1, lockEfficiency: 100, priority: 'small', targets: [{ types: ['巡洋舰'], hitMin: 70, hitMax: 90 }] }] } },
    condEffects: []
};
const MECHS = [
    { cond: { kind: 'battleStart' }, stat: 'dmgBonus', val: 100, note: '开场伤害翻倍' },
    { cond: { kind: 'hpBelow', threshold: 90, dur: 5, cd: 10 }, stat: 'cooldownReduction', val: 30, note: '血线以下加速' }
];
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
    await p.goto('http://127.0.0.1:3888/simulator.html', { waitUntil: 'domcontentloaded' });
    await sleep(2000);
    await p.evaluate(cs => localStorage.setItem('lagrange_custom_ships', JSON.stringify({ [cs.id]: cs })), CUSTOM);
    await p.reload({ waitUntil: 'load' });
    await sleep(4500);

    const r = await p.evaluate((id, mechs) => {
        if (!SHIP_DATABASE[id]) return { err: '自定义舰未加载进 SHIP_DATABASE' };
        function run(withMech) {
            const s = JSON.parse(JSON.stringify(SHIP_DATABASE[id]));   // 基线（含自定义舰本身）
            s.condEffects = withMech ? JSON.parse(JSON.stringify(mechs)) : [];
            SHIP_DATABASE[id] = s;                                     // prepareBattle 从库读
            const mkE = (src, count) => { const e = JSON.parse(JSON.stringify(src)); e.count = count; try { e.uid = (typeof ensureUid === 'function') ? ensureUid(e) : ('u' + Math.random()); } catch (x) { } return e; };
            Object.keys(fleetData).forEach(k => { fleetData[k].main = []; fleetData[k].reinforcement = []; fleetData[k].flagship = null; });
            fleetData['ally-escort'].main = [mkE(s, 3)];
            const eBase = JSON.parse(JSON.stringify(s)); eBase.condEffects = [];      // 敌方：同型同数，唯一差异 = 不带机制
            fleetData['enemy-escort'].main = [mkE(eBase, 3)];
            const ok = prepareBattle();
            let t = 0;
            while (battleState && !battleState.ended && t < 3000) { processBattleTick(0.5); t += 0.5; }
            const A = battleState.allyShips || [], E = battleState.enemyShips || [];
            const fired = A.reduce((n, x) => n + (x._condFired || 0), 0);
            const condCopied = A.reduce((n, x) => n + ((x.condEffects || []).length ? 1 : 0), 0);
            return {
                ok: !!ok, t: Math.round(t), ended: !!(battleState && battleState.ended),
                触发计数: fired, 实例带机制的艘数: condCopied,
                我方输出: Math.round(A.reduce((n, x) => n + (x._dealtShip || 0), 0)),
                我方存活: A.filter(x => x.alive).length, 敌方存活: E.filter(x => x.alive).length
            };
        }
        const noMech = run(false);
        const withMech = run(true);
        return { noMech, withMech };
    }, CUSTOM.id, MECHS);

    if (r.err) { console.log('✗ ' + r.err); process.exit(1); }
    console.log('不带机制：', JSON.stringify(r.noMech));
    console.log('带机制：  ', JSON.stringify(r.withMech));
    const pass = r.withMech.ok && r.withMech.触发计数 > 0 && r.withMech.实例带机制的艘数 === 3
        && r.withMech.ended && r.withMech.t < r.noMech.t                 // 打得明显更快（伤害提升的直接体现）
        && r.withMech.我方存活 >= r.noMech.我方存活;                      // 且不更差
    console.log(pass ? '\n✅ 机制在模拟器战斗里真的触发了：带机制 ' + r.withMech.t + 's / 不带 ' + r.noMech.t + 's（快 ' + Math.round((1 - r.withMech.t / r.noMech.t) * 100) + '%），触发计数 ' + r.withMech.触发计数 + '，存活 ' + r.withMech.我方存活 + ' vs ' + r.noMech.我方存活 : '\n❌ 未达预期');
    console.log('页面错误:', errs.length ? errs.slice(0, 3) : '无');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
