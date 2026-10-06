/* 把另一台设备的 12 岛训练状态打包进网站内置：data/neuron/state/
   产出：
     snap_isleXX.json —— 每岛最新一份完整快照（gen/A/B/mA/mB/fit/frz/born，逐字段兼容）
     arc_isleXX.json  —— 行为档案（新颖性搜索的历史，接续用）
     log_isleXX.json  —— 精简日志（每岛最后 120 代：gen/分数/胜率/网络规模/冻结代数）→ 看板曲线与收敛判定用
     manifest.json    —— 岛清单（代数/分数/网络规模），页面下拉直接用
   （不带：e8map 合计 9.7MB，会自行重建；champ 是中间产物，快照里已有基因组）
   用法：node _pack_neuron_state.js */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '_neuron_src', '方案二A-完整状态-2026-10-05', '状态');
const OUT = path.join(__dirname, 'data', 'neuron', 'state');
fs.mkdirSync(OUT, { recursive: true });

const isles = [];
for (let i = 0; i <= 11; i++) {
    const id = String(i).padStart(2, '0');
    /* 1) 最新快照 */
    const snapDir = path.join(SRC, '_duel_snapshots', 'isle_' + id);
    let snapFile = null;
    try {
        const fs2 = fs.readdirSync(snapDir).filter(f => /^gen_\d+\.json$/.test(f)).sort();
        snapFile = fs2.length ? path.join(snapDir, fs2[fs2.length - 1]) : null;
    } catch (e) { }
    if (!snapFile) { console.log('isle_' + id + ' 没有快照，跳过'); continue; }
    const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    fs.writeFileSync(path.join(OUT, 'snap_isle' + id + '.json'), JSON.stringify(snap));
    /* 2) 行为档案 */
    let arcOk = false;
    try {
        const arc = fs.readFileSync(path.join(SRC, '_duel_isles', 'archive_' + id + '.json'), 'utf8');
        fs.writeFileSync(path.join(OUT, 'arc_isle' + id + '.json'), arc);
        arcOk = true;
    } catch (e) { }
    /* 3) 精简日志（最后 120 代） */
    let nLog = 0;
    try {
        const lines = fs.readFileSync(path.join(SRC, '_duel_isles', 'duel_' + id + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
        const curGen = lines.length ? (JSON.parse(lines[lines.length - 1]).gen || 0) : 0;
        const slim = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
            .filter(x => x && x.A && x.B && x.gen <= curGen)
            .slice(-120)
            .map(r => ({
                gen: r.gen, t: r.t || 0,
                A: { score: r.A.score, fscore: (r.A.fscore != null ? r.A.fscore : r.A.score), wins: r.A.wins, winDur: r.A.winDur, nodes: r.A.nodes, conns: r.A.conns, frozen: r.A.frozen, evolve: true },
                B: { score: r.B.score, fscore: (r.B.fscore != null ? r.B.fscore : r.B.score), wins: r.B.wins, winDur: r.B.winDur, nodes: r.B.nodes, conns: r.B.conns, frozen: r.B.frozen, evolve: true }
            }));
        fs.writeFileSync(path.join(OUT, 'log_isle' + id + '.json'), JSON.stringify(slim));
        nLog = slim.length;
    } catch (e) { }
    const sz = n => (n && n.nodes) ? (n.nodes.filter(x => x.type !== 'in').length + '/' + n.conns.filter(c => c.enabled !== false).length) : '—';
    const fsA = (snap.mA && snap.mA.fscore != null) ? snap.mA.fscore : (snap.mA ? snap.mA.score : null);
    isles.push({
        isle: i, gen: snap.gen || 0,
        fscoreA: fsA != null ? +fsA.toFixed(0) : null,
        winsA: snap.mA ? snap.mA.wins : null,
        nodesA: snap.A && snap.A.net ? snap.A.net.nodes.filter(n => n.type !== 'in').length : 0,
        connsA: snap.A && snap.A.net ? snap.A.net.conns.filter(c => c.enabled).length : 0,
        hasArc: arcOk, logN: nLog,
        files: { snap: 'snap_isle' + id + '.json', arc: arcOk ? 'arc_isle' + id + '.json' : null, log: nLog ? 'log_isle' + id + '.json' : null }
    });
    console.log('isle_' + id + '  gen=' + (snap.gen || 0) + ' fscoreA=' + (isles[isles.length - 1].fscoreA) + ' 网' + sz(snap.A && snap.A.net) + (arcOk ? ' +档案' : '') + (nLog ? ' +日志' + nLog + '行' : ''));
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    source: '方案二A-完整状态-2026-10-05（另一台设备，停机时）',
    note: '每岛最新一份快照 + 行为档案 + 最近 120 代精简日志；E8 图不带（会自行重建）。装入后勾"有本机存档就续跑"即可接着训练。',
    builtAt: new Date().toISOString(),
    islands: isles
}, null, 1));
const total = fs.readdirSync(OUT).reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
console.log('已生成 data/neuron/state/：' + isles.length + ' 个岛，共 ' + (total / 1024 / 1024).toFixed(1) + ' MB（含 manifest）');
