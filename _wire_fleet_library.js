/* 把「方案二A 神经元进化」的两套头名配队接进配队库（data/fleet_library.json）
   来源（桌面解压件，只读）：
     A) 方案二A-完整状态-2026-10-05/收尾成绩/目前最好配队-岛02-第1000代.md   —— 跨方案对照最快（139.5s vs 人类基线 842.2s）
     B) 方案二A-完整状态-2026-10-05/收尾成绩/最终成绩-2026-10-05-1810停止.md —— 全局最佳（岛6，第94代，fscore 9174）
   产出：8 条配队库条目（岛02 / 岛6 各 我方护航/被护航/敌方护航/被护航），全部带
        tags:['进化产物','未实战验证'] + note 免责说明（Agent 会自动检索并注入，必须标注）
   用法：node _wire_fleet_library.js            （干跑：只打印解析结果，不写文件）
         node _wire_fleet_library.js --write    （写回 data/fleet_library.json） */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC_DIR = 'C:/Users/Administrator/Desktop/方案二A-完整状态-2026-10-05/收尾成绩';
const DOC_A = path.join(SRC_DIR, '目前最好配队-岛02-第1000代.md');
const DOC_B = path.join(SRC_DIR, '最终成绩-2026-10-05-1810停止.md');
const WRITE = process.argv.includes('--write');

/* ---------- 舰船库：id ↔ 名字 ---------- */
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ship_database.json'), 'utf8'));
const byId = {}, byName = {}, byNameNoParen = {};
Object.values(DB).forEach(s => {
    byId[s.id] = s;
    byName[norm(s.name)] = s.id;
    byNameNoParen[stripParen(norm(s.name))] = byNameNoParen[stripParen(norm(s.name))] || s.id;
});
function norm(s) { return String(s == null ? '' : s).replace(/[\s\u3000]/g, ''); }
function stripParen(s) { return String(s == null ? '' : s).replace(/[（(][^）)]*[）)]/g, ''); }
const unresolved = [];
function resolve(name) {
    const n = norm(name);
    if (byName[n]) return byName[n];
    const sp = stripParen(n);
    if (byNameNoParen[sp]) return byNameNoParen[sp];
    /* 宽松：唯一前缀/包含匹配 */
    const cands = Object.keys(byName).filter(k => k.indexOf(sp) === 0 || sp.indexOf(k) === 0);
    if (cands.length === 1) return byName[cands[0]];
    unresolved.push(name + (cands.length > 1 ? ('（多个候选：' + cands.slice(0, 3).join('/') + '）') : '（找不到）'));
    return null;
}
function modsFromCell(cell) {
    const mods = {};
    (String(cell || '').match(/[A-Z]\d+/g) || []).forEach(t => {
        const m = /^([A-Z])(\d+)$/.exec(t);
        if (!m) return;
        if (m[2] === '0') return;                 // C0 = 无模块
        mods[m[1]] = t;
    });
    return mods;
}
function modsFromPairs(cell) {                    // "M=M3 A=A3 B=B3 C=C0" / "M1=M1"
    const mods = {};
    (String(cell || '').match(/[A-Z]\d*=[A-Z]\d+/g) || []).forEach(t => {
        const [k, v] = t.split('=');
        if (/0$/.test(v)) return;                 // C0 = 无模块
        const slot = /^[A-Z]\d*$/.test(k) ? k[0] : k;   // M1=M1 → 槽 M、变体 M1
        mods[slot] = v;
    });
    return mods;
}
function airFromCellA(cell) {                     // "CV-T800型-脉冲炮艇×3[槽M1|corvette]，…"
    const out = [];
    String(cell || '').split(/[，,]/).forEach(seg => {
        const m = /^(.+?)×(\d+)(?:\[槽([^|\]]+)\|(\w+)\])?$/.exec(seg.trim());
        if (!m) return;
        const id = resolve(m[1]);
        if (!id) return;
        const t = byId[id] || {};
        out.push({ id, name: t.name || m[1], kind: m[4] || ((t.aircraftType === 'corvette' || t.type === 'corvette') ? 'corvette' : 'fighter'), slot: m[3] || '', qty: parseInt(m[2], 10) });
    });
    return out;
}
function airFromNamesB(cell) {                    // "CV-T800型-脉冲炮艇×3、S-列维9号-重型鱼雷艇×3"
    const out = [];
    String(cell || '').split(/[、，,]/).forEach(seg => {
        const m = /^(.+?)×(\d+)$/.exec(seg.trim());
        if (!m) return;
        const id = resolve(m[1]);
        if (!id) return;
        const t = byId[id] || {};
        out.push({ id, name: t.name || m[1], kind: (t.aircraftType === 'corvette' || t.type === 'corvette') ? 'corvette' : 'fighter', slot: '', qty: parseInt(m[2], 10) });
    });
    return out;
}
function mkShipA(cells, airCell) {   // | `id` | 名称 | 数量 | 单舰CV | 小计 | 站位 | 模块 | 载机 |
    return { id: cells[1].replace(/`/g, ''), name: cells[2], qty: parseInt(cells[3], 10), pos: cells[6], mods: modsFromCell(cells[7]), air: airFromCellA(airCell), _cvDoc: parseInt(cells[5], 10) };
}
function mkShipB(cells) {   // | # | 舰船 | 数量 | 站位 | 模块 | 载机 | 指挥值 |
    const id = resolve(cells[2]);
    if (!id) return null;
    return { id, name: (byId[id] || {}).name || cells[2], qty: parseInt(cells[3], 10), pos: cells[4], mods: modsFromPairs(cells[5]), air: airFromNamesB(cells[6]), _cvDoc: parseInt(cells[7], 10) };
}

/* ---------- 解析 A（岛02，带 id） ---------- */
function parseDocA() {
    const L = fs.readFileSync(DOC_A, 'utf8').split('\n');
    const res = {};
    let side = null, fleet = null, sec = null;
    for (const line of L) {
        if (/^# 一、我方/.test(line)) { side = 'A'; fleet = null; sec = null; continue; }
        if (/^# 二、敌方/.test(line)) { side = 'B'; fleet = null; sec = null; continue; }
        if (/^### /.test(line) || /^\*\*决策网络\*\*/.test(line)) { sec = null; continue; }   // 加点表/网络行不算舰船
        const fm = /^\*\*[①②③④] (护航队|被护航队) · (主舰队|增援)/.exec(line);
        if (fm) { fleet = fm[1]; sec = fm[2]; res[side] = res[side] || {}; res[side][fleet] = res[side][fleet] || { main: [], rein: [], flagship: null }; continue; }
        const fl = /^\*\*旗舰\*\*：护航队 `([^`]+)`.*被护航队 `([^`]+)`/.exec(line);
        if (fl && side) {
            res[side] = res[side] || {};
            res[side].护航队 = res[side].护航队 || { main: [], rein: [], flagship: null };
            res[side].被护航队 = res[side].被护航队 || { main: [], rein: [], flagship: null };
            res[side].护航队.flagship = fl[1];
            res[side].被护航队.flagship = fl[2];
            continue;
        }
        if (side && fleet && sec && line.trim().startsWith('|') && /^\| `/.test(line.trim())) {
            const cells = line.split('|').map(x => x.trim());
            /* ★ 载机单元格内部含 `|`（[槽M1|corvette]）→ split 后要拼回来 */
            const airCell = cells.length > 9 ? cells.slice(8, cells.length - 1).join('|') : cells[8];
            const sh = mkShipA(cells, airCell);
            (sec === '主舰队' ? res[side][fleet].main : res[side][fleet].rein).push(sh);
        }
    }
    return res;
}
/* ---------- 解析 B（岛6，只有名字） ---------- */
function parseDocB() {
    const L = fs.readFileSync(DOC_B, 'utf8').split('\n');
    const res = {};
    let side = null;
    for (let i = 0; i < L.length; i++) {
        const line = L[i];
        if (/^### 我方/.test(line)) { side = 'A'; continue; }
        if (/^### 敌方/.test(line)) { side = 'B'; continue; }
        if (/^## 三、/.test(line)) break;                    // 后面的"一览"不算
        const fm = /^#### (护航队|被护航队)　主舰队指挥值 \d+ \/ \d+　旗舰：(.+)$/.exec(line);
        if (fm && side) {
            const fleet = fm[1];
            res[side] = res[side] || {};
            res[side][fleet] = res[side][fleet] || { main: [], rein: [], flagship: resolve(fm[2].trim()) };
            let j = i + 1;
            for (; j < L.length; j++) {
                const l2 = L[j];
                if (/^\*\*增援/.test(l2)) {
                    const mm = l2.match(/：(.+)$/);
                    if (mm) mm[1].split('、').forEach(seg => {
                        const m2 = /^(.+?)×(\d+)$/.exec(seg.trim()); if (!m2) return;
                        const id = resolve(m2[1]); if (!id) return;
                        res[side][fleet].rein.push({ id, name: (byId[id] || {}).name || m2[1], qty: parseInt(m2[2], 10), pos: '增援', mods: {}, air: [] });
                    });
                    break;
                }
                if (l2.trim().startsWith('|') && /^\| \d+ \|/.test(l2.trim())) {
                    const cells = l2.split('|').map(x => x.trim());
                    const sh = mkShipB(cells);
                    if (sh) res[side][fleet].main.push(sh);
                }
            }
        }
    }
    return res;
}

/* ---------- 组装条目 ---------- */
const NOTE = '⚠️ 模拟器进化产物：只在战斗模拟器内验证过（同一人类基线 842.2s，本套最快 139.5s），未经真实游戏验证；引用时必须说明这一点，并优先与知识库里的实战配队交叉校验。加点明细见桌面《方案二A-完整状态-2026-10-05/收尾成绩/》。';
function buildEntries() {
    const out = [];
    const add = (srcTag, isle, sideCN, fleetCN, f) => {
        const main = (f.main || []).map(s => ({ id: s.id, name: (byId[s.id] || {}).name || s.name, pos: s.pos || '', qty: s.qty || 1, mods: s.mods || {}, air: s.air || [] }));
        const rein = (f.rein || []).map(s => ({ id: s.id, name: (byId[s.id] || {}).name || s.name, pos: '增援', qty: s.qty || 1, mods: {}, air: [] }));
        if (!main.length) { console.log('⚠️ 跳过空条目 ' + srcTag + ' ' + sideCN + fleetCN); return; }
        const pop = main.reduce((a, s) => a + (((byId[s.id] || {}).commandValue) || 0) * (s.qty || 1), 0);
        const cvDoc = (f.main || []).reduce((a, s) => a + (s._cvDoc || 0), 0);
        if (cvDoc && Math.abs(cvDoc - pop) > 2) console.log('  （CV 对照：文档 ' + cvDoc + ' vs 库算 ' + pop + '  ' + isle + sideCN + fleetCN + '）');
        out.push({
            id: 'evo_' + isle + '_' + (sideCN === '我方' ? 'A' : 'B') + (fleetCN === '护航队' ? '_e' : '_d'),
            name: '进化产物·' + isle + '·' + sideCN + fleetCN + '（方案二A）',
            scenario: '护航战', tags: ['进化产物', '未实战验证', '方案二A', '护航战'],
            pop, reinforce: rein.reduce((a, s) => a + s.qty, 0), flagship: f.flagship || '',
            source: '方案二A 神经元对撞 · ' + srcTag, note: NOTE,
            score: (isle === '岛02' ? 139.5 : null),
            main, reinforceList: rein, createdAt: Date.now()
        });
    };
    const A = parseDocA(), B = parseDocB();
    [['A', '我方'], ['B', '敌方']].forEach(([s, cn]) => {
        ['护航队', '被护航队'].forEach(fl => {
            if (A[s] && A[s][fl]) add('岛02 第1000代（跨方案对照最快 139.5s）', '岛02', cn, fl, A[s][fl]);
            if (B[s] && B[s][fl]) add('岛6 第94代（全局最佳 fscore 9174）', '岛6', cn, fl, B[s][fl]);
        });
    });
    return out;
}

const entries = buildEntries();
console.log('\n=== 解析结果 ===');
entries.forEach(e => {
    console.log(e.id + '  「' + e.name + '」 人口 ' + e.pop + ' + 增援' + e.reinforce + ' 主舰队 ' + e.main.length + ' 条 旗舰 ' + (e.flagship || '—'));
    console.log('   ', e.main.map(x => x.name + '×' + x.qty).join('、'));
    if (e.reinforceList.length) console.log('    增援:', e.reinforceList.map(x => x.name + '×' + x.qty).join('、'));
    const airSum = e.main.reduce((a, x) => a + (x.air || []).reduce((b, y) => b + y.qty, 0), 0);
    if (airSum) console.log('    载机合计', airSum, '架');
});
if (unresolved.length) console.log('\n⚠️ 未解析的名字（' + unresolved.length + '）：\n  ' + unresolved.join('\n  '));

if (WRITE) {
    const P = path.join(ROOT, 'data', 'fleet_library.json');
    const j = { version: 1, updatedAt: Date.now(), fleets: entries };
    fs.writeFileSync(P, JSON.stringify(j, null, 1));
    console.log('\n✅ 已写入 ' + P + '（' + entries.length + ' 条）');
} else {
    console.log('\n（干跑：没有写文件；加 --write 才写）');
}
