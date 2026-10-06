/* ============================================================
   构建「神经元训练 Worker」：js/neuron/worker_bundle.js
   ------------------------------------------------------------
   组成（顺序敏感）：
     1. Worker 垫片（window=self / document 空元素 / localStorage 内存版 / fetch 前缀到项目根 / console 转发）
     2. js/fleet_check.js（舰队校验/载机位 —— 引擎的真依赖）
     3. simulator.html 的内联脚本（引擎本体 —— 与 Node 引擎同一来源）
     4. 引擎导出块（★ 直接从 _build_engine.js 里抽，保证 Node/browser 两份导出永远一致）
     5. js/neuron/neuron_store.js（IndexedDB 存储层）
     6. js/neuron/neuron_core.js（训练核心，方案二A 移植）
     7. Worker 胶水（onmessage: start/pause/resume/stop → NeuronCore）
   用法：node _build_neuron_worker.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

/* ---------- 1. 抽取 simulator.html 内联脚本（与 _build_engine.js 同一套边界规则） ---------- */
const html = fs.readFileSync(path.join(ROOT, 'simulator.html'), 'utf8').split('\n');
let start = -1, end = -1;
html.forEach((l, i) => {
    if (start < 0 && l.trim() === '<script>' && i > 800) start = i + 1;
    else if (start >= 0 && end < 0 && l.trim() === '</script>' && i > start) end = i;
});
if (start < 0 || end < 0) throw new Error('没找到内联 <script> 边界');
const engineSrc = html.slice(start, end).join('\n');
console.log('内联脚本行数 = ' + (end - start));

/* ---------- 2. fleet_check.js ---------- */
const checkSrc = fs.readFileSync(path.join(ROOT, 'js', 'fleet_check.js'), 'utf8');

/* ---------- 4. 从 _build_engine.js 抽导出块（单一来源） ---------- */
const be = fs.readFileSync(path.join(ROOT, '_build_engine.js'), 'utf8');
const m = be.match(/const EXPORT = `([\s\S]*?)`;\n\n\/\* ---------- 5\./);
if (!m) throw new Error('没能从 _build_engine.js 抽出 EXPORT 块');
const EXPORT_NODE = m[1];
const EXPORT_WORKER = EXPORT_NODE.replace('module.exports = {', 'self.LagrangeEngine = {');
if (!/self\.LagrangeEngine = \{/.test(EXPORT_WORKER)) throw new Error('导出块替换失败');
console.log('导出块已复用（' + EXPORT_NODE.split('\n').length + ' 行）');

/* ---------- 1. Worker 垫片 ---------- */
const SHIM = `/* ============================================================
   Worker 垫片：把浏览器/Node 都能跑的最小环境给引擎用
   ============================================================ */
self.window = self;
self.global = self;
/* localStorage：内存版（引擎用它存加点方案；Worker 里没有真 localStorage） */
(function () { const M = new Map(); self.localStorage = {
    getItem: k => (M.has(String(k)) ? M.get(String(k)) : null),
    setItem: (k, v) => { M.set(String(k), String(v)); },
    removeItem: k => { M.delete(String(k)); },
    clear: () => M.clear(),
    get length() { return M.size; },
    key: i => Array.from(M.keys())[i] || null
}; })();
/* 万能"空元素"：UI 代码对它的任何读写都安静地成功 */
function __mkEl(tag) {
    const el = {
        tagName: (tag || 'div').toUpperCase(), style: {}, dataset: {}, classList: {
            add() { }, remove() { }, toggle() { }, contains() { return false; }
        },
        children: [], childNodes: [], value: '', innerHTML: '', innerText: '', textContent: '',
        checked: false, disabled: false, selectedIndex: 0, options: [],
        appendChild(c) { return c; }, removeChild() { }, insertBefore(c) { return c; },
        insertAdjacentHTML() { }, setAttribute() { }, getAttribute() { return null; },
        removeAttribute() { }, addEventListener() { }, removeEventListener() { },
        dispatchEvent() { return true; }, focus() { }, blur() { }, click() { }, remove() { },
        querySelector() { return null; }, querySelectorAll() { return []; },
        getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
        closest() { return null; }, contains() { return false; }, scrollIntoView() { },
        getContext() { return null; }, toDataURL() { return ''; }, play() { }, pause() { },
        width: 0, height: 0
    };
    el.parentNode = null; el.firstChild = null; el.lastChild = null; el.nextSibling = null;
    return el;
}
const __elCache = new Map();
const __el = id => { if (!__elCache.has(id)) __elCache.set(id, __mkEl('div')); return __elCache.get(id); };
self.document = {
    getElementById: id => (id ? __el(id) : null),
    querySelector: sel => (sel ? __el('sel:' + sel) : null),
    querySelectorAll: () => [],
    createElement: t => __mkEl(t),
    createTextNode: t => ({ nodeValue: t }),
    createDocumentFragment: () => __mkEl('frag'),
    addEventListener() { }, removeEventListener() { },
    get body() { return __el('body'); },
    get documentElement() { return __el('html'); },
    get head() { return __el('head'); },
    get readyState() { return 'complete'; },
    get title() { return ''; }, set title(v) { }
};
self.navigator = self.navigator || { userAgent: 'worker', language: 'zh-CN' };
try { self.screen = self.screen || { width: 1920, height: 1080 }; } catch (e) { }
self.alert = () => { };
self.confirm = () => true;
self.prompt = () => null;
self.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);
self.cancelAnimationFrame = id => clearTimeout(id);
self.scrollTo = () => { };
self.getComputedStyle = () => ({ getPropertyValue: () => '' });
self.Image = function () { return __mkEl('img'); };
self.Audio = function () { return { play() { }, pause() { }, addEventListener() { } }; };
self.XMLHttpRequest = function () { };
self.speechSynthesis = { speak() { }, cancel() { }, getVoices: () => [] };
self.SpeechSynthesisUtterance = function () { };
self.Notification = function () { };
self.ResizeObserver = function () { return { observe() { }, disconnect() { } }; };
self.IntersectionObserver = function () { return { observe() { }, disconnect() { } }; };
/* fetch：相对路径 → 项目根（worker 在 js/neuron/ 下 ⇒ 根 = ../../） */
(function () {
    const __orig = self.fetch.bind(self);
    const BASE = new URL('../../', self.location.href).href;
    self.fetch = function (u, o) {
        const s = String(u == null ? '' : u);
        if (!/^(https?:)?\\/\\//.test(s) && !s.startsWith('/') && !s.startsWith('data:')) return __orig(BASE + s, o);
        return __orig(u, o);
    };
})();
/* console：转发给主线程（页面日志面板；同时保留本地输出） */
(function () {
    const fwd = (lv) => { const o = console[lv].bind(console); console[lv] = function () { const s = Array.prototype.map.call(arguments, x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (e) { return String(x); } }).join(' '); try { self.postMessage({ type: 'console', msg: s }); } catch (e) { } o.apply(null, arguments); }; };
    ['log', 'warn', 'error'].forEach(fwd);
})();
`;

/* ---------- 7. Worker 胶水 ---------- */
const GLUE = `
/* ============================================================
   Worker 胶水：主线程消息 → 训练核心
   ============================================================ */
let __ctl = null;
function __post(m) { try { self.postMessage(m); } catch (e) { } }
self.onmessage = async function (ev) {
    const m = ev.data || {};
    try {
        if (m.type === 'start') {
            const core = self.NeuronCore.start(self.LagrangeEngine, Object.assign({}, m.cfg || {}, { store: self.NeuronStore }), __post);
            __ctl = core;
            await core.run();
        } else if (m.type === 'pause' || m.type === 'resume' || m.type === 'stop') {
            if (__ctl && __ctl.control[m.type]) __ctl.control[m.type]();
        }
    } catch (e) {
        __post({ type: 'error', msg: String((e && e.stack) || e) });
    }
};
`;

/* ---------- 写出 ---------- */
const storeSrc = fs.readFileSync(path.join(ROOT, 'js', 'neuron', 'neuron_store.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(ROOT, 'js', 'neuron', 'neuron_core.js'), 'utf8');
const out = [
    '/* ★ 本文件是构建产物：node _build_neuron_worker.js 生成，请勿手改（改源见脚本头部注释）。 */',
    SHIM, checkSrc, engineSrc, EXPORT_WORKER, storeSrc, coreSrc, GLUE
].join('\n');
fs.writeFileSync(path.join(ROOT, 'js', 'neuron', 'worker_bundle.js'), out, 'utf8');
console.log('已生成 js/neuron/worker_bundle.js（' + out.split('\n').length + ' 行，' + (Buffer.byteLength(out) / 1024).toFixed(0) + ' KB）');
