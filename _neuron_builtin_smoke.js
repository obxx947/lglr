/* 神经元实验室 · 内置存档冒烟：读 manifest → 装入全部 12 岛 → 用 isle0 续跑（应显示"从快照第 1100 代恢复"）
   用法：node _neuron_builtin_smoke.js */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGEERROR:', String(e.message).slice(0, 200)));
    p.on('dialog', async d => { console.log('[对话框] ' + String(d.message()).slice(0, 100)); await d.accept().catch(() => { }); });
    const ev = async (fn, tag) => { try { return await p.evaluate(fn); } catch (e) { console.log('[' + tag + '] ' + String(e.message).slice(0, 120)); return null; } };

    console.log('== 打开页面：清库 → 读内置清单 ==');
    await p.goto('http://127.0.0.1:3888/neuron.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(3000);
    await ev(() => { try { indexedDB.deleteDatabase('lagrange_neuron'); } catch (e) { } }, 'wipe');
    await sleep(800); await p.reload({ waitUntil: 'load' }); await sleep(3500);
    const man = await ev(() => ({
        opts: document.getElementById('builtinState').options.length,
        first: document.getElementById('builtinState').options[0] ? document.getElementById('builtinState').options[0].textContent : null,
        info: (document.getElementById('builtinInfo').textContent || '').slice(0, 90)
    }), 'man');
    console.log('内置清单：', JSON.stringify(man));

    console.log('== 装入全部 12 岛 ==');
    await ev(() => loadBuiltinState(true), 'load');
    await sleep(2000);
    const db = await ev(async () => {
        const one = async k => { const v = await NeuronStore.get('kv', k); return v ? (v.gen !== undefined ? v.gen : (v.archive ? 'arc' + v.archive.length : '?')) : null; };
        return { snap0: await one('snap:0'), snap11: await one('snap:11'), arc0: await one('arc:0'), log0: (await NeuronStore.get('kv', 'log:0') || []).length, snaps: (await NeuronStore.keys('kv', 'snap:')).length };
    }, 'db');
    console.log('IndexedDB：', JSON.stringify(db));

    console.log('== 用 isle0 续跑（tiny 参数）==');
    await ev(() => {
        document.getElementById('isles').value = 1; document.getElementById('islesVal').textContent = '1';
        document.getElementById('pop').value = 2; document.getElementById('oppEval').value = 1;
        document.getElementById('gens').value = 2;
        document.getElementById('maxSec').value = 40; document.getElementById('stall').value = 15;
        document.getElementById('useWarm').checked = false; document.getElementById('autoResume').checked = true;
        startTraining();
    }, 'start');
    let out = null;
    for (let i = 0; i < 70; i++) {
        await sleep(5000);
        const st = await ev(() => {
            try {
                const s = isleState[0];
                const txt = document.getElementById('logBox').textContent;
                const m = /断点续跑：从快照第 (\d+) 代恢复，接着跑第 (\d+) 代/.exec(txt);
                return { gen: s.gen, logLines: (s.log || []).length, resume: m ? m[0] : null, convBadge: document.getElementById('convBadge').textContent };
            } catch (e) { return null; }
        }, 'r' + i);
        if (st && st.gen >= 1) { out = st; break; }
        if (i % 4 === 0) console.log('  …' + (i * 5) + 's：' + JSON.stringify(st));
    }
    console.log('续跑结果：', JSON.stringify(out));
    console.log('结论：' + ((db.snap0 === 1100 && db.snap11 === 100 && out && out.resume && out.gen >= 1101 && out.logLines > 100)
        ? '✅ 内置存档 → 装入 → 续跑（第 1100 代）→ 历史日志接上 全链路成立'
        : '⚠️ 需要人工检查'));
    await ev(() => { try { Object.keys(workers).forEach(k => { workers[k].postMessage({ type: 'stop' }); setTimeout(() => { try { workers[k].terminate(); } catch (e) { } }, 300); }); } catch (e) { } });
    await sleep(800);
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
