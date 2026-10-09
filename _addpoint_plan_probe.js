/* 验收：save_addpoint_plan 的落盘逻辑（真实页面环境，不用 LLM）
   做法：从 js/agent.js 抽【已发布】的 saveAddpointPlan 源码 → 注入页面执行 → 检查 localStorage 里的方案
   断言：① 风暴的节点被存进 lagrange_addpoint_sets ② 非法节点被跳过列明 ③ 未找到的船被列出 ④ 收尾清理测试数据 */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const src = fs.readFileSync(__dirname + '/js/agent.js', 'utf8');
    const s = src.indexOf('    async function saveAddpointPlan(args){');
    const e = src.indexOf('let _battleWorker=null');
    if (s < 0 || e < 0 || e <= s) { console.error('✗ 抽取失败'); process.exit(1); }
    const fnText = src.slice(s, e).trim();
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', x => errs.push(String(x.message).slice(0, 150)));
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(2500);
    const r = await p.evaluate(async (fnText) => {
        const fn = new Function('return (' + fnText + ')')();
        const out = await fn({
            set_name: 'AI验收-临时方案',
            ships: [
                { ship: '风暴', nodes: { 201: 5, 202: 3, 9999: 3, '602010204': 4 } },   // 短号+长号都要能入库；9999 应为"不存在节点"被跳过
                { ship: '不存在的船xyz', nodes: { 101: 1 } }                              // 应为"未找到"
            ]
        });
        const parsed = JSON.parse(out);
        const all = JSON.parse(localStorage.getItem('lagrange_addpoint_sets') || '[]');
        const rec = all.find(x => x.name === 'AI验收-临时方案');
        const cdn = rec ? Object.keys(rec.addpoints)[0] : null;
        const lv = rec && cdn ? rec.addpoints[cdn].lv : null;
        // 清理测试数据
        const clean = all.filter(x => x.name !== 'AI验收-临时方案');
        localStorage.setItem('lagrange_addpoint_sets', JSON.stringify(clean));
        return { parsed: parsed, 存到了: !!rec, cdnId: cdn, lv: lv, 清理后: JSON.parse(localStorage.getItem('lagrange_addpoint_sets') || '[]').length };
    }, fnText);
    console.log('ok =', r.parsed.ok, '｜已保存 =', JSON.stringify(r.parsed.舰船), '｜未找到 =', JSON.stringify(r.parsed.未找到的舰船));
    console.log('跳过/钳制 =', JSON.stringify(r.parsed.跳过或钳制的节点));
    console.log('落盘检查：方案在库里 =', r.存到了, '｜cdnId =', r.cdnId, '｜lv =', JSON.stringify(r.lv), '｜清理后库内方案数 =', r.清理后);
    const pass = r.parsed.ok === true && r.存到了 && r.lv
        && r.lv['602010201'] === 5 && r.lv['602010202'] === 3 && r.lv['602010204'] === 4   // 短号201/202 + 长号6040204 都入库为长号
        && !r.lv['9999']
        && r.parsed.未找到的舰船 && r.parsed.未找到的舰船.length === 1
        && (r.parsed.跳过或钳制的节点 || []).some(x => String(x).includes('9999'));
    console.log('页面错误:', errs.length ? errs.slice(0, 3) : '无');
    console.log(pass ? '\n✅ save_addpoint_plan 验收通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
