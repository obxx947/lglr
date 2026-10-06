/* 收尾冒烟：① neuron 页暂停→继续 ② chat 首次打招呼 ③ skills 导出按钮 ④ simulator 战报按钮函数 ⑤ neuron3d 已有 */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 600000, args: ['--no-sandbox', '--disable-gpu'] });
    const out = [];
    const mk = async (url, fn, tag) => {
        const p = await b.newPage();
        const errs = [];
        p.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
        p.on('dialog', async d => { await d.accept().catch(() => { }); });
        try { await p.goto(url, { waitUntil: 'load', timeout: 60000 }); await sleep(2500); } catch (e) { errs.push('goto: ' + e.message.slice(0, 100)); }
        let r = null;
        try { r = fn ? await fn(p) : null; } catch (e) { errs.push('fn: ' + String(e.message).slice(0, 150)); }
        out.push({ tag, result: r, errors: errs });
        await p.close().catch(() => { });
    };

    /* ① neuron：暂停→继续 */
    {
        const p = await b.newPage();
        p.on('pageerror', e => out.push({ tag: 'neuron', errors: [String(e.message).slice(0, 150)] }));
        p.on('dialog', async d => { await d.accept().catch(() => { }); });
        await p.goto('http://127.0.0.1:3888/neuron.html', { waitUntil: 'load', timeout: 60000 });
        await sleep(3000);
        await p.evaluate(() => {
            document.getElementById('isles').value = 1; document.getElementById('islesVal').textContent = '1';
            document.getElementById('pop').value = 2; document.getElementById('oppEval').value = 1;
            document.getElementById('gens').value = 999;
            document.getElementById('maxSec').value = 40; document.getElementById('stall').value = 15;
            document.getElementById('useWarm').checked = false; document.getElementById('autoResume').checked = false;
            startTraining();
        });
        let started = false;
        for (let i = 0; i < 40; i++) { await sleep(5000); const g = await p.evaluate(() => { try { return isleState[0].gen; } catch (e) { return -1; } }); if (g >= 1) { started = true; break; } }
        await p.evaluate(() => pauseAll());
        let paused = false;
        for (let i = 0; i < 40; i++) {
            await sleep(5000);
            const st = await p.evaluate(() => { try { return { status: isleState[0].status, badge: document.getElementById('runBadge').textContent }; } catch (e) { return null; } });
            if (st && st.status === '已暂停') { paused = true; break; }
        }
        await p.evaluate(() => resumeAll());
        await sleep(3000);
        const after = await p.evaluate(() => { try { return { status: isleState[0].status, badge: document.getElementById('runBadge').textContent }; } catch (e) { return null; } });
        out.push({ tag: 'neuron 暂停/继续', result: { started, paused, after } });
        await p.evaluate(() => { try { Object.keys(workers).forEach(k => { workers[k].postMessage({ type: 'stop' }); setTimeout(() => { try { workers[k].terminate(); } catch (e) { } }, 300); }); } catch (e) { } });
        await sleep(800); await p.close().catch(() => { });
    }

    /* ② chat 首次打招呼（清掉 greeted 标记和会话，重建） */
    await mk('http://127.0.0.1:3888/chat.html', async (p) => {
        await p.evaluate(() => { localStorage.removeItem('lglr_greeted'); localStorage.removeItem('lagrange_conversations'); });
        await p.reload({ waitUntil: 'load' }); await sleep(2500);
        const r = await p.evaluate(() => {
            const ids = Object.keys(conversations);
            const c = conversations[ids[0]];
            return { convs: ids.length, msgs: c ? c.messages.length : 0, firstRole: c && c.messages[0] ? c.messages[0].role : null, firstLen: c && c.messages[0] ? c.messages[0].content.length : 0, hasExportFn: typeof exportConvJSON === 'function' };
        });
        return r;
    }, 'chat 首次打招呼');

    /* ③ skills 导出按钮 */
    await mk('http://127.0.0.1:3888/skills.html', async (p) => {
        await p.evaluate(() => {
            const arr = [{ id: 'skill_test', name: '测试技能', summary: 's', content: '内容', keywords: ['k'], anti_patterns: [], skill_type: 't', enabled: true, praise: 0, lastUsed: 0, createdAt: Date.now() }];
            localStorage.setItem('lagrange_skills', JSON.stringify(arr));
        });
        await p.reload({ waitUntil: 'load' }); await sleep(2000);
        const r = await p.evaluate(() => ({ hasFn: typeof exportSkillJSON === 'function', hasBtn: document.body.innerHTML.indexOf('导出JSON') >= 0 }));
        return r;
    }, 'skills 导出');

    /* ④ simulator 战报按钮 */
    await mk('http://127.0.0.1:3888/simulator.html', async (p) => {
        const r = await p.evaluate(() => ({ hasSave: typeof _saveReportToLib === 'function', hasSend: typeof _sendReportToAI === 'function', hasData: typeof _reportData === 'function' }));
        return r;
    }, 'simulator 战报按钮');

    /* ⑤ agent 工具注册 */
    await mk('http://127.0.0.1:3888/chat.html', async (p) => {
        const r = await p.evaluate(() => {
            try {
                const t = AgentEngine && AgentEngine.getTools ? AgentEngine.getTools() : null;
                const names = t ? t.map(x => x.function && x.function.name) : [];
                return { count: names.length, has: { reports: names.includes('get_battle_reports'), neuron: names.includes('get_neuron_status'), crawl: names.includes('crawl_web_page') } };
            } catch (e) { return { err: String(e.message).slice(0, 120) }; }
        });
        return r;
    }, 'agent 工具');

    console.log(JSON.stringify(out, null, 1));
    await b.close().catch(() => { });
    process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
