/* 浏览器验证：主库重建后 KB.load() 能载 1212 块、检索可用 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 180000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(4000);
    const r = await p.evaluate(async () => {
        for (let i = 0; i < 25 && !window.KB; i++) await new Promise(x => setTimeout(x, 200));
        const ok = await KB.load();
        const hits = KB.search('大帝 配队', 5).map(x => ({ src: x.source, score: Math.round(x.score * 100) / 100 }));
        const hits2 = KB.search('永恒风暴 拦截', 3).map(x => x.source);
        const hits3 = KB.search('实例', 2).map(x => x.source);
        return { ok, chunks: (KB.chunks || []).length, hits, hits2, hits3 };
    });
    console.log(JSON.stringify(r, null, 1));
    console.log('页面错误:', errs.length ? errs.slice(0, 4) : '无');
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 200)); process.exit(1); });
