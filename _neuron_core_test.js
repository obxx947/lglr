/* neuron_core.js 的 Node 自测：内存 store + 真实引擎 + 真战报配队，跑 2 代。
   目的：在写页面之前先把「移植后的训练核心」跑通（钩子/适应度/存档/暂停消息 全走一遍）。
   用法：node _neuron_core_test.js */
const path = require('path');
const fs = require('fs');
const E = require('./engine/lagrange_engine.js');
const Core = require('./js/neuron/neuron_core.js');

const D = 'C:/Users/Administrator/Desktop/拉格朗日_战报2';
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const given = {
    A: {
        escort: J(path.join(D, '资料3', '我方护航能二.json')).plans[0].fleets[0],
        escorted: J(path.join(D, '资料3', '我方被护航能二.json')).plans[0].fleets[0],
        ap: J(path.join(D, '资料3', '我方加点能二.json')).addpoints || {}
    },
    B: {
        escort: J(path.join(D, '敌方护航赐天与彼.json')).plans[0].fleets[0],
        escorted: J(path.join(D, '敌方被护航赐天与彼.json')).plans[0].fleets[0],
        ap: J(path.join(D, '敌方加点赐天与彼.json')).addpoints || {}
    }
};
/* 内存 store（模拟 IndexedDB 的接口） */
const M = new Map();
const store = {
    put: (s, k, v) => Promise.resolve(M.set(k, JSON.parse(JSON.stringify(v)))),
    get: (s, k) => Promise.resolve(M.get(k)),
    keys: (s, p) => Promise.resolve([...M.keys()].filter(k => !p || k.indexOf(p) === 0)),
    entries: (s, p) => Promise.resolve([...M.entries()].filter(([k]) => !p || k.indexOf(p) === 0).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
    del: (s, k) => Promise.resolve(M.delete(k)),
    addReport: r => Promise.resolve(r),
    listReports: () => Promise.resolve([])
};

const seen = { hello: 0, log: 0, gen: 0, saved: 0, done: 0, paused: 0, error: 0 };
const post = m => {
    if (seen[m.type] !== undefined) seen[m.type]++;
    if (m.type === 'log') console.log('  [log] ' + m.msg);
    if (m.type === 'gen') {
        const r = m.rec;
        console.log('  [gen ' + r.gen + '] A 分=' + r.A.score + ' 胜率=' + r.A.wins + '% 网=' + r.A.nodes + '/' + r.A.conns +
            ' ｜ B 分=' + r.B.score + ' 胜率=' + r.B.wins + '% 网=' + r.B.nodes + '/' + r.B.conns +
            ' ｜ A队CV=' + r.A.cv.join('/') + ' 旗舰=' + JSON.stringify(r.A.flagships));
        console.log('        A 配队: 护航 ' + m.best.A.fleet.escort.main.map(x => x.name + '×' + x.count).join('、'));
        if (m.net) console.log('        net3d: ' + m.net.side + ' ' + m.net.nodes.length + ' 节点 / ' + m.net.conns.length + ' 连接; acts len=' + (m.acts ? m.acts.length : 0));
    }
    if (m.type === 'error') console.log('  [ERROR] ' + m.msg);
    if (m.type === 'done') console.log('  [done] bestEver=' + (m.bestEver || 0).toFixed(0));
};

(async () => {
    const t0 = Date.now();
    const core = Core.start(E, {
        isle: 0, given: given, pop: 2, oppEval: 1, oppSample: 1,
        maxSec: 300, stallSec: 45, dt: 0.5, throttle: 1.0,
        gens: 2, saveEvery: 1, store: store, seedBase: 20261004,
        evolve: { A: true, B: true }
    }, post);
    await core.run();
    console.log('用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's，消息统计：', JSON.stringify(seen));
    console.log('store 里存了什么键：', [...M.keys()].join(', '));
    const snap = M.get('snap:0');
    console.log('快照：gen=' + (snap && snap.gen) + ' A.nodes=' + (snap && snap.A.net ? snap.A.net.nodes.length : '-') +
        ' fit.A.dw=' + (snap && snap.fit ? snap.fit.A.dw.toFixed(2) : '-'));
    /* ---- 第二个岛：给 B 固定（打指定对手模式）---- */
    const seen2 = {};
    const post2 = m => { seen2[m.type] = (seen2[m.type] || 0) + 1; if (m.type === 'gen') console.log('  [I01 gen ' + m.rec.gen + '] A 分=' + m.rec.A.score + ' B(固定) evolve=' + m.rec.B.evolve + ' net=' + m.rec.B.nodes + '/' + m.rec.B.conns); if (m.type === 'error') console.log('  [I01 ERROR] ' + m.msg); };
    const core2 = Core.start(E, {
        isle: 1, given: given, pop: 2, oppEval: 1, oppSample: 1,
        maxSec: 300, stallSec: 45, dt: 0.5, throttle: 1.0,
        gens: 1, saveEvery: 1, store: store, seedBase: 777,
        evolve: { A: true, B: false }
    }, post2);
    await core2.run();
    console.log('I01（B 固定模式）消息统计：', JSON.stringify(seen2));
})().catch(e => { console.error('崩了：', e); process.exit(1); });
