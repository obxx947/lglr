/* AI 推演打通验收：
   ① chat 页里跑 battle worker（A 带 _ship 快照的自定义舰 vs 库船）→ 应 ok 且 机制触发数>0、带机制实例数>0
   ② 抽 agent.js 的 _sideFromInput 在页面里跑：按自定义舰【名字】应能解析出 id 且带 _ship
   ③ 同一场不带机制 → 机制触发数应为 0（对照） */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CUSTOM = {
    id: 'custom_wp1', name: '推演测试舰', variant: '自定义', type: 'cruiser', size: 'small', position: '中排',
    hp: 120000, physicalArmor: 150, energyArmor: 10, commandValue: 15, serviceLimit: 8,
    speed: { cruise: '500-1200', warp: 2500 },
    modules: { M1: { name: '主武器系统', type: 'weapon', weapons: [{ name: '测试炮', dmgType: 'physical', weaponType: 'direct', singleDmg: 3000, cooldown: 6, lockTime: 4, atkDuration: 2, ammo: 1, attacks: 1, lockEfficiency: 100, priority: 'small', targets: [{ types: ['巡洋舰'], hitMin: 70, hitMax: 90 }] }] } },
    condEffects: [{ cond: { kind: 'battleStart' }, stat: 'dmgBonus', val: 100, note: '开场伤害翻倍' }]
};
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load' });
    await sleep(2000);
    await p.evaluate(cs => localStorage.setItem('lagrange_custom_ships', JSON.stringify({ [cs.id]: cs })), CUSTOM);
    await p.reload({ waitUntil: 'load' });
    await sleep(3000);

    /* ① worker 跑两场：带机制的 _ship vs 不带机制的 _ship（同款船） */
    const r1 = await p.evaluate((cs) => new Promise(resolve => {
        function run(ship, tag) {
            return new Promise(res => {
                const w = new Worker('js/neuron/battle_worker.js');
                const to = setTimeout(() => { try { w.terminate(); } catch (e) { } res({ ok: false, error: 'timeout' }); }, 120000);
                w.onmessage = ev => { const m = ev.data || {}; if (m.type !== 'battleResult') return; clearTimeout(to); try { w.terminate(); } catch (e) { } res(m); };
                w.onerror = e => { clearTimeout(to); res({ ok: false, error: String(e.message || '') }); };
                w.postMessage({ type: 'battle', id: tag, opt: {
                    A: [{ id: cs.id, count: 3, mods: {}, position: '中排', air: [], _ship: ship }],
                    B: [{ id: 'ST59', count: 2 }],
                    maxSec: 1200, dt: 0.5, stallSec: 90
                } });
            });
        }
        const withMech = JSON.parse(JSON.stringify(cs));
        const noMech = JSON.parse(JSON.stringify(cs)); noMech.condEffects = [];
        (async () => {
            const a = await run(withMech, 'with');
            const c = await run(noMech, 'none');
            resolve({ withMech: a, noMech: c });
        })();
    }), CUSTOM);
    const f = r1.withMech, g = r1.noMech;
    console.log('① worker 带机制：ok=' + f.ok, '胜负=' + f.胜负, '时长=' + (f.时长 && Math.round(f.时长)), '机制触发数=' + f.机制触发数, '带机制实例=' + f.带机制实例数, f.error ? ('错误:' + f.error) : '');
    console.log('   worker 不带机制：ok=' + g.ok, '胜负=' + g.胜负, '时长=' + (g.时长 && Math.round(g.时长)), '机制触发数=' + g.机制触发数);

    /* ② _sideFromInput：按自定义舰名字解析 */
    const src = fs.readFileSync(__dirname + '/js/agent.js', 'utf8');
    const st = src.indexOf('    function _sideFromInput(f){');
    const en = src.indexOf('    function _flagshipId(f){');
    const fnText = src.slice(st, en).trim();
    const r2 = await p.evaluate((fnText) => {
        return new Promise(resolve => {
            SHIP_DB.load().then(() => {
                const fn = new Function('SHIP_DB', 'return (' + fnText + ')')(SHIP_DB);
                const side = fn({ main: [{ ship: '推演测试舰', count: 3 }], reinforcement: [{ ship: '推演测试舰', count: 1 }] });
                resolve({
                    n: side.length, id: side[0] && side[0].id, hasShip: !!(side[0] && side[0]._ship),
                    cond: !!(side[0] && side[0]._ship && (side[0]._ship.condEffects || []).length),
                    merged: side.length === 2
                });
            });
        });
    }, fnText);
    console.log('② _sideFromInput：条数=' + r2.n, 'id=' + r2.id, '带_ship=' + r2.hasShip, '含机制=' + r2.cond, '增援并入=' + r2.merged);

    const pass = f.ok && f.机制触发数 > 0 && f.带机制实例数 > 0 && g.ok && g.机制触发数 === 0
        && r2.id === 'custom_wp1' && r2.hasShip && r2.cond && r2.merged;
    console.log('页面错误:', errs.length ? errs.slice(0, 3) : '无');
    console.log(pass ? '\n✅ AI 推演已打通自定义舰与机制' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
