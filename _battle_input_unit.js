/* 单测：从 js/agent.js 抽出【已发布】的 _sideFromInput/_flagshipId，用桩 SHIP_DB 跑转换规则
   断言：舰名→id、mods 字符串→对象、载机 "名×N"→{id,qty}、增援并入、未知船丢弃 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/js/agent.js', 'utf8');
const start = src.indexOf('    function _sideFromInput(f){');
const end = src.indexOf('    function _apOfSet(name){');
if (start < 0 || end < 0) { console.error('✗ 抽取失败'); process.exit(1); }
const seg = src.slice(start, end);
/* 桩：SHIP_DB.search 按名字/黑话返回 {id} */
const DB = { '风暴': 'eternal-storm', '永恒风暴': 'eternal-storm', 'ST59': 'ST59', '五九': 'ST59', '米斯特拉': 'mistral', 'T800': 't800' };
const SHIP_DB = { search: q => { const s = String(q).trim(); for (const k of Object.keys(DB)) { if (s === k || s.includes(k)) return [{ id: DB[k] }]; } return []; } };
const sandbox = {};
new Function('SHIP_DB', 'exports', seg + '\nexports.side = _sideFromInput; exports.flagship = _flagshipId;')(SHIP_DB, sandbox);

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? ' → ' + extra : '')); } };

const side = sandbox.side({
    main: [{ ship: '风暴', count: 4, mods: 'M2+A2', air: '米斯特拉×5', pos: '中排' }],
    reinforcement: [{ ship: '五九', count: 2 }],
    flagship: '风暴'
});
console.log(JSON.stringify(side, null, 0));
ok('增援并入（2 条）', side.length === 2);
ok('舰名→引擎 id', side[0].id === 'eternal-storm');
ok('数量/站位', side[0].count === 4 && side[0].position === '中排');
ok('mods 字符串→对象', side[0].mods.M === 'M2' && side[0].mods.A === 'A2');
ok('载机 名×N→{id,qty}', side[0].air.length === 1 && side[0].air[0].id === 'mistral' && side[0].air[0].qty === 5);
ok('黑话 五九→ST59', side[1].id === 'ST59' && side[1].count === 2);
ok('未知船被丢弃', sandbox.side({ main: [{ ship: '不存在的船', count: 1 }] }).length === 0);
ok('flagship 名→id', sandbox.flagship({ flagship: '风暴' }) === 'eternal-storm');
ok('旧参数 ally_ships 兼容', sandbox.side({ ally_ships: [{ id: 'ST59', count: 3 }] })[0].id === 'ST59');
ok('载机数组形式', sandbox.side({ main: [{ ship: '风暴', count: 1, air: [{ name: 'T800', qty: 3 }] }] })[0].air[0].id === 't800');
console.log(fail === 0 ? '\n✅ 全过（' + pass + '/' + pass + '）' : '\n❌ 失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
