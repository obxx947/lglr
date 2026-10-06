/* 神经元实验室 · 存档→重载→续跑 闭环测试 v2（不要点任何 confirm；直接操作 worker） */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    p.on('pageerror', e => console.log('PAGEERROR:', String(e.message).slice(0, 200)));
    p.on('dialog', async d => { console.log('[对话框自动接受] ' + String(d.message()).slice(0, 60)); await d.accept().catch(() => { }); });
    const ev = async (fn, tag) => { try { return await p.evaluate(fn); } catch (e) { console.log('[' + tag + '] ' + String(e.message).slice(0, 120)); return null; } };
    const stopWorkersHard = () => ev(() => { try { Object.keys(workers).forEach(k => { workers[k].postMessage({ type: 'stop' }); setTimeout(() => { try { workers[k].terminate(); } catch (e) { } }, 300); }); } catch (e) { } });

    console.log('== 清库 + 第一轮（跑到 ≥6 代）==');
    await p.goto('http://127.0.0.1:3888/neuron.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(3000);
    await ev(() => { try { indexedDB.deleteDatabase('lagrange_neuron'); } catch (e) { } }, 'wipe');
    await sleep(1000); await p.reload({ waitUntil: 'load' }); await sleep(3000);
    await ev(() => {
        document.getElementById('isles').value = 1; document.getElementById('islesVal').textContent = '1';
        document.getElementById('pop').value = 2; document.getElementById('oppEval').value = 1;
        document.getElementById('gens').value = 999;
        document.getElementById('maxSec').value = 40; document.getElementById('stall').value = 15;
        document.getElementById('useWarm').checked = false;
        document.getElementById('autoResume').checked = false;
        startTraining();
    }, 'start1');
    let reached = 0;
    for (let i = 0; i < 80; i++) {
        await sleep(5000);
        const g = await ev(() => { try { return isleState[0].gen; } catch (e) { return -1; } }, 'g' + i);
        if (g >= 6) { reached = g; break; }
        if (i % 4 === 0) console.log('  gen=' + g);
    }
    console.log('第一轮到 gen=' + reached);
    await stopWorkersHard();
    await sleep(7000);
    const snapA = await ev(async () => { const s = await NeuronStore.get('kv', 'snap:0'); return s ? { gen: s.gen, hasA: !!(s.A && s.A.net), hasStats: !!(s.mA && s.mA.stats) } : null; }, 'snapA');
    console.log('停止后存档：', JSON.stringify(snapA));
    await stopWorkersHard(); await sleep(1000);

    console.log('== 模拟"断了"：重开页面 ==');
    await p.reload({ waitUntil: 'load' }); await sleep(3000);
    await ev(() => {
        document.getElementById('isles').value = 1; document.getElementById('islesVal').textContent = '1';
        document.getElementById('pop').value = 2; document.getElementById('oppEval').value = 1;
        document.getElementById('gens').value = 999;
        document.getElementById('maxSec').value = 40; document.getElementById('stall').value = 15;
        document.getElementById('useWarm').checked = false;
        document.getElementById('autoResume').checked = true;
        startTraining();
    }, 'start2');
    let mid = null, sawResumeLog = false;
    for (let i = 0; i < 60; i++) {
        await sleep(5000);
        const st = await ev(() => { try { return { gen: isleState[0].gen, lg: document.getElementById('logBox').textContent.indexOf('断点续跑') >= 0 }; } catch (e) { return null; } }, 'r' + i);
        if (st && st.lg) sawResumeLog = true;
        if (st && st.gen > 0) { mid = st; break; }
        if (i % 4 === 0) console.log('  ' + (i * 5) + 's：' + JSON.stringify(st));
    }
    const logTxt = await ev(() => document.getElementById('logBox').textContent, 'log');
    const m = /断点续跑：从快照第 (\d+) 代恢复，接着跑第 (\d+) 代/.exec(logTxt || '');
    console.log('续跑日志：', m ? m[0] : '（未找到）');
    console.log('续跑后 gen=' + (mid && mid.gen));
    console.log('结论：' + ((sawResumeLog && mid && mid.gen >= (snapA ? snapA.gen : 0)) ? '✅ 存档→重载→续跑 闭环成立' : '⚠️ 需要人工检查'));
    await stopWorkersHard();
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
