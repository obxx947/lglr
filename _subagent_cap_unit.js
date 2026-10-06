/* 单元验证：capSubResult（子Agent结果截断兜底）——直接抽取 js/agent.js 里【已发布】的那段代码来跑
   断言：①正常短文本原样通过 ②空值→'(空输出)' ③超长文本被截到 1200 字并带截断标记 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/js/agent.js', 'utf8');
const start = src.indexOf('const SUBAGENT_RESULT_CAP');
const end = src.indexOf('async function runSubAgentOne');
if (start < 0 || end < 0) { console.error('✗ 抽取失败：找不到常量/函数'); process.exit(1); }
const seg = src.slice(start, end);
const sandbox = {};
new Function('exports', seg + '\nexports.capSubResult = capSubResult; exports.CAP = SUBAGENT_RESULT_CAP;')(sandbox);
const { capSubResult, CAP } = sandbox;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); } };

console.log('capSubResult 单测（硬上限 = ' + CAP + ' 字）');
const short = '结论：风暴定位是抗压输出。证据：A资料66.md#配队与模块。';
ok('短文本原样返回', capSubResult(short) === short);

ok('空值 → (空输出)', capSubResult('') === '(空输出)' && capSubResult(null) === '(空输出)');

const long = '甲'.repeat(5000);
const cut = capSubResult(long);
ok('5000字被截到 ' + CAP + ' 字', cut.length === CAP + '…（超长已截断：请让它压缩成"结论+证据"后重跑）'.length, '实际长度 ' + cut.length);
ok('截断后带标记', cut.indexOf('超长已截断') > 0);
ok('截断后正文恰好 1200 字', cut.slice(0, CAP) === long.slice(0, CAP));

const edge = '乙'.repeat(CAP);
ok('恰好 1200 字不截断', capSubResult(edge) === edge);

console.log(fail === 0 ? '\n✅ 单测全过（' + pass + '/' + pass + '）' : '\n❌ 有失败：' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
