/* 神经元实验室 · 配队选择器冒烟：往 localStorage 种"模拟器舰队 + 配队页我的配队 + 加点方案"，
   验证四个下拉能读出来、点选后 given 结构正确、能按选取的配队真的开始训练。
   用法：node _neuron_picker_smoke.js */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGEERROR:', String(e.message).slice(0, 200)));
    p.on('dialog', async d => { console.log('[对话框] ' + String(d.message()).slice(0, 80)); await d.accept().catch(() => { }); });
    await p.goto('http://127.0.0.1:3888/neuron.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(3000);

    console.log('== 种入假数据（模拟器四舰队 + 配队页方案 + 加点方案）==');
    const seeded = await p.evaluate(async () => {
        const J = u => fetch(u).then(r => r.json());
        const ae = (await J('data/neuron/war_default/a_escort.json')).plans[0].fleets[0];
        const ad = (await J('data/neuron/war_default/a_escorted.json')).plans[0].fleets[0];
        const be = (await J('data/neuron/war_default/b_escort.json')).plans[0].fleets[0];
        const ba = (await J('data/neuron/war_default/b_ap.json')).addpoints || {};
        /* 模拟器舰队格式现实里是"整船对象 + count/selectedModules/position/aircraft"，这里用最小字段近似（转换器按 qty/count 兼容） */
        const simFleet = f => ({ main: (f.main || []).map(x => ({ id: x.id, name: x.name, count: x.qty || 1, position: x.pos || '', selectedModules: x.mods || {}, aircraft: (x.air || []).map(a => ({ id: a.id, name: a.name, kind: a.kind, count: a.qty || 1, slot: a.slot || '' })) })) });
        localStorage.setItem('lagrange_sim_fleets', JSON.stringify({
            'ally-escort': simFleet(ae), 'ally-escorted': simFleet(ad),
            'enemy-escort': simFleet(be), 'enemy-escorted': simFleet(be)
        }));
        /* 配队页「我的配队」格式：{plans:[{name,fleets:[{name,main:[{id,pos,qty,mods,air}],reinforce,flagship}]}]} */
        localStorage.setItem('lagrange_fleets', JSON.stringify({ plans: [{ id: 'p1', name: '测试方案甲', fleets: [{ name: '主队', flagship: ae.main[0].id, main: ae.main, reinforce: [], }] }] }));
        /* 加点整套方案 */
        localStorage.setItem('lagrange_addpoint_sets', JSON.stringify([{ name: '测试加点方案', addpoints: ba, updatedAt: Date.now() }]));
        await refreshPickers();
        const opt = sel => Array.from(document.getElementById(sel).options).map(o => o.textContent);
        return {
            sim: document.getElementById('fsEscort_A').querySelectorAll('optgroup[label="模拟器舰队"] option').length,
            plans: document.getElementById('fsEscort_A').querySelectorAll('optgroup[label="配队页 · 我的配队"] option').length,
            apSets: document.getElementById('apSet_A').options.length - 1,
            srcInfo: document.getElementById('srcInfo').textContent.slice(0, 120)
        };
    });
    console.log('下拉统计：', JSON.stringify(seeded));

    console.log('== 一键用模拟器舰队填满 + 选加点 ==');
    const picked = await p.evaluate(() => {
        fillFromSimulator();
        /* 加点选第一套 */
        ['A', 'B'].forEach(s => { const sel = document.getElementById('apSet_' + s); if (sel.options.length > 1) sel.value = '0'; });
        onPick('A'); onPick('B');
        return {
            aEscortMain: given.A.escort.main.length, aEscort1: given.A.escort.main[0].id,
            aEscorted1: given.A.escorted.main[0].id,
            bEscort1: given.B.escort.main[0].id,
            apShips: Object.keys(given.A.ap || {}).length,
            sumA: document.getElementById('sumA').textContent.slice(0, 110)
        };
    });
    console.log('选取结果：', JSON.stringify(picked));

    console.log('== 用选取的配队开始训练（tiny）==');
    await p.evaluate(() => {
        document.getElementById('isles').value = 1; document.getElementById('islesVal').textContent = '1';
        document.getElementById('pop').value = 2; document.getElementById('oppEval').value = 1;
        document.getElementById('gens').value = 999;
        document.getElementById('maxSec').value = 40; document.getElementById('stall').value = 15;
        document.getElementById('useWarm').checked = false; document.getElementById('autoResume').checked = false;
        startTraining();
    });
    let gen1 = null;
    for (let i = 0; i < 40; i++) {
        await sleep(5000);
        const st = await p.evaluate(() => { try { const s = isleState[0]; return s && s.rec ? { gen: s.gen, escort1: s.best.A.fleet.escort.main[0].id, apShips: Object.keys(s.best.A.fleet.ap || {}).length } : null; } catch (e) { return null; } });
        if (st) { gen1 = st; break; }
        if (i % 4 === 0) console.log('  …等第 1 代');
    }
    console.log('第 1 代：', JSON.stringify(gen1));
    console.log('结论：' + ((gen1 && picked.aEscort1 && gen1.escort1 === picked.aEscort1) ? '✅ 选取的配队真的进了训练（A 护航首舰一致：' + gen1.escort1 + '）' : '⚠️ 需要人工看一下'));
    await p.evaluate(() => { try { Object.keys(workers).forEach(k => { workers[k].postMessage({ type: 'stop' }); setTimeout(() => { try { workers[k].terminate(); } catch (e) { } }, 300); }); } catch (e) { } });
    await sleep(800);
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
