/* 用打包好的内置快照跑 Node 复现：找出"第 N 代迟迟不完成"的卡点
   用法：node _neuron_resume_node_test.js */
const fs = require('fs');
const E = require('./engine/lagrange_engine.js');
const Core = require('./js/neuron/neuron_core.js');
const D = 'C:/Users/Administrator/Desktop/拉格朗日_战报2';
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const given = {
    A: { escort: J(D + '/资料3/我方护航能二.json').plans[0].fleets[0], escorted: J(D + '/资料3/我方被护航能二.json').plans[0].fleets[0], ap: J(D + '/资料3/我方加点能二.json').addpoints || {} },
    B: { escort: J(D + '/敌方护航赐天与彼.json').plans[0].fleets[0], escorted: J(D + '/敌方被护航赐天与彼.json').plans[0].fleets[0], ap: J(D + '/敌方加点赐天与彼.json').addpoints || {} }
};
const M = new Map();
const store = {
    put: (s, k, v) => Promise.resolve(M.set(k, JSON.parse(JSON.stringify(v)))),
    get: (s, k) => Promise.resolve(M.get(k)),
    keys: (s, p) => Promise.resolve([...M.keys()].filter(k => !p || k.indexOf(p) === 0)),
    entries: (s, p) => Promise.resolve([...M.entries()].filter(([k]) => !p || k.indexOf(p) === 0).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
    del: (s, k) => Promise.resolve(M.delete(k)),
    addReport: r => Promise.resolve(r), listReports: () => Promise.resolve([])
};
/* 装入内置存档（isle 0） */
M.set('snap:0', J('./data/neuron/state/snap_isle00.json'));
M.set('arc:0', J('./data/neuron/state/arc_isle00.json'));
M.set('log:0', J('./data/neuron/state/log_isle00.json'));
const snap = M.get('snap:0');
console.log('快照：gen=' + snap.gen + ' A护航主舰队 ' + snap.A.escort.main.length + ' 条 / 载机 ' + (snap.A.escort.main.reduce((a, x) => a + (x.air || []).reduce((b, y) => b + (y.qty || 1), 0), 0)) + ' 架');
console.log('        B护航主舰队 ' + snap.B.escort.main.length + ' 条');

const t0 = Date.now();
const post = m => {
    const ms = Date.now() - t0;
    if (m.type === 'log') console.log('  [' + (ms / 1000).toFixed(1) + 's][log] ' + m.msg.slice(0, 140));
    if (m.type === 'gen') console.log('  ★[' + (ms / 1000).toFixed(1) + 's][gen ' + m.rec.gen + '] A 分=' + m.rec.A.score + ' 胜率=' + m.rec.A.wins + '% 网=' + m.rec.A.nodes + '/' + m.rec.A.conns + ' B 分=' + m.rec.B.score);
    if (m.type === 'saved') console.log('  [' + (ms / 1000).toFixed(1) + 's][saved] gen=' + m.gen);
    if (m.type === 'done') console.log('  [' + (ms / 1000).toFixed(1) + 's][done]');
    if (m.type === 'error') console.log('  [' + (ms / 1000).toFixed(1) + 's][ERROR] ' + m.msg.slice(0, 200));
};
(async () => {
    const core = Core.start(E, {
        isle: 0, given: given, pop: 2, oppEval: 1, oppSample: 3,
        maxSec: 40, stallSec: 15, dt: 0.5, throttle: 1.0,
        gensCount: 2, saveEvery: 1, store: store, resume: true, seedBase: 20261004,
        evolve: { A: true, B: true }
    }, post);
    await core.run();
    console.log('总用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch(e => { console.error('崩了：', e); process.exit(1); });
