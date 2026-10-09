/* 验收：AI 战斗 Worker（真引擎）跑一场 + 量耗时/返回结构
   ① 直接在页面里 new Worker('js/neuron/battle_worker.js')，postMessage {type:'battle'} 跑 4×风暴 vs 6×ST59
   ② 校验返回：ok / 胜负 / 时长 / 我方敌方汇总 / 逐型号行；打印计算耗时
   用法：先起 3888 静态服务，再 node _battle_worker_probe.js */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(2500);
    /* 工具清单里 battle_simulate 还在吗（新 schema） */
    const tools = await p.evaluate(() => {
        const t = AgentEngine.getTools().find(x => x.function && x.function.name === 'battle_simulate');
        return t ? Object.keys(t.function.parameters.properties) : null;
    });
    console.log('① battle_simulate 新参数:', JSON.stringify(tools));

    const res = await p.evaluate(() => new Promise(resolve => {
        try {
            const w = new Worker('js/neuron/battle_worker.js');
            const logs = [];
            const to = setTimeout(() => resolve({ ok: false, error: 'worker 超时(120s)｜先收到的消息: ' + JSON.stringify(logs.slice(0, 5)) }), 120000);
            w.onmessage = ev => {
                const m = ev.data || {};
                if (m.type === 'battleResult') { clearTimeout(to); resolve(m); w.terminate(); return; }
                logs.push(String(m.type || '?'));   // hello/log/console 之类先记下
            };
            w.onerror = e => { clearTimeout(to); resolve({ ok: false, error: 'worker error: ' + (e.message || '') }); };
            w.postMessage({ type: 'battle', id: 1, opt: {
                A: [{ id: 'eternal-storm', count: 4, mods: { M: 'M2', A: 'A2' } }],
                B: [{ id: 'ST59', count: 6 }],
                maxSec: 4400, dt: 0.5, stallSec: 120
            } });
        } catch (e) { resolve({ ok: false, error: String(e.message || e) }); }
    }));
    console.log('② worker 返回 ok=', res.ok, '| ms=', res.ms, '| 胜负=', res.胜负, '| 时长秒=', res.时长, '| 结束=', res.结束, '| 僵局=', res.僵局);
    if (res.ok) {
        console.log('   我方汇总:', JSON.stringify(res.我方));
        console.log('   敌方汇总:', JSON.stringify(res.敌方));
        console.log('   逐型号-我方(前4):', JSON.stringify((res.逐型号.我方 || []).slice(0, 4)));
    } else console.log('   错误:', res.error);
    console.log('页面错误:', errs.length ? errs.slice(0, 3) : '无');
    await b.close().catch(() => { }); process.exit(res.ok ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
