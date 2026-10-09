/* @引用 修复验收（不花 LLM 钱）：
   桩 AgentEngine.chat 捕获 (userMessage, referencedContext)，真跑 send() 三条路径：
   A. 纯 @（没打字）→ 应发出，userMessage='（引用对话）'，上下文只含 用户输入+AI最终回答（无摘要/无📝/无空行）
   B. @ + 内容 → userMessage='帮我看看'，上下文同上
   C. 引用的会话没有可注入内容 → 不发送（chat 不被调用） */
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox', '--disable-gpu'] });
    const p = await b.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await p.goto('http://127.0.0.1:3888/chat.html', { waitUntil: 'load', timeout: 60000 });
    await sleep(2500);
    const r = await p.evaluate(async () => {
        /* 桩：拦截 LLM，只记参数 */
        window.__cap = [];
        try { AgentEngine.getActiveLLM = () => ({ apiKey: 'stub', model: 'stub' }); } catch (e) { }
        try { AgentEngine.chat = async (msg, history, emit, resume, ref) => { window.__cap.push({ msg: msg, ref: ref }); return {}; }; } catch (e) { return { fatal: 'AgentEngine 无法打桩: ' + e.message }; }
        /* 构造被引用的会话：含用户输入 / AI最终回答 / 摘要 / 空内容 / 📝前缀 五类 */
        conversations['conv_ref'] = { id: 'conv_ref', title: '被引用会话', createdAt: Date.now(), messages: [
            { role: 'user', content: '你好，帮我配个队' },
            { role: 'assistant', content: '这是AI最终回答（非思考）' },
            { role: 'system', content: '【对话摘要】这段不该被注入' },
            { role: 'assistant', content: '   ' },
            { role: 'user', content: '📝 选择: 420护航 | 补充: 用大盾' }
        ] };
        conversations['conv_empty'] = { id: 'conv_empty', title: '空会话', createdAt: Date.now(), messages: [ { role: 'system', content: '只有系统行' } ] };
        if (!conversations['conv_main']) { newChat(); }
        activeConv = Object.keys(conversations)[0];
        const input = document.getElementById('chatInput');

        async function fire(text) {
            input.value = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const before = window.__cap.length;
            await send();
            return window.__cap.length > before ? window.__cap[window.__cap.length - 1] : null;
        }
        /* A. 纯 @（选择后输入框里只剩 @id） */
        referencedConvId = 'conv_ref';
        const a = await fire('@conv_ref ');
        /* B. @ + 内容 */
        referencedConvId = 'conv_ref';
        const bb = await fire('@conv_ref 帮我看看');
        /* C. 引用空会话（没有可注入内容）→ 不该发 */
        referencedConvId = 'conv_empty';
        const beforeC = window.__cap.length;
        input.value = '@conv_empty '; input.dispatchEvent(new Event('input', { bubbles: true }));
        await send();
        const cSent = window.__cap.length > beforeC;
        return { a: a, b: bb, cSent: cSent, nowActive: activeConv };
    });
    if (r.fatal) { console.log('✗ ' + r.fatal); process.exit(1); }
    console.log('A 纯@：userMessage =', JSON.stringify(r.a && r.a.msg));
    console.log('A 注入上下文:\n' + String((r.a && r.a.ref) || '').split('\n').map(x => '   ' + x).join('\n'));
    console.log('B @+内容：userMessage =', JSON.stringify(r.b && r.b.msg));
    console.log('C 引用空会话是否被拦住:', r.cSent === false ? '是（未发送 ✓）' : '否（错误地发了 ✗）');
    const ctx = String((r.a && r.a.ref) || '');
    const pass = r.a && r.a.msg === '（引用对话）'
        && ctx.includes('用户: 你好，帮我配个队') && ctx.includes('AI: 这是AI最终回答（非思考）')
        && !ctx.includes('对话摘要') && !ctx.includes('📝') && !ctx.includes('只有系统行')
        && r.b && r.b.msg === '帮我看看'
        && r.cSent === false;
    console.log('页面错误:', errs.length ? errs.slice(0, 3) : '无');
    console.log(pass ? '\n✅ @引用修复验收通过' : '\n❌ 有不符合预期项');
    await b.close().catch(() => { }); process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR', String(e.message).slice(0, 300)); process.exit(1); });
