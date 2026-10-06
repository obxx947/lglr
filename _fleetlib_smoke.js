/* 配队库接线 + 系统提示词的浏览器验证：FleetLib 能检索到 8 条「进化产物」
   用法：node _fleetlib_smoke.js */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGEERROR:', String(e.message).slice(0, 200)));
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(3000);
    const r = await p.evaluate(async () => {
        for (let i = 0; i < 20 && !window.FleetLib; i++) await new Promise(x => setTimeout(x, 200));
        if (!window.FleetLib) return { err: 'FleetLib 未加载' };
        const all = await FleetLib.all();
        const hit1 = await FleetLib.searchAsync('游骑兵 ST59 护航', { topK: 3 });
        const hit2 = await FleetLib.searchAsync('大帝', { topK: 3 });
        const idx = FleetLib.indexText(all, 30);
        return {
            allCount: all.length,
            hit1: hit1.map(e => e.name),
            hit1Text: hit1[0] ? FleetLib.entryToText(hit1[0]).slice(0, 260) : null,
            hit2Count: hit2.length,
            indexSnippet: idx.split('\n').slice(0, 3)
        };
    });
    console.log(JSON.stringify(r, null, 1));
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 200)); process.exit(1); });
