/* net3d.js 单测（Node，桩 canvas）：缩放 API / 滚轮缩放 / 双指捏合 / 上下限夹取
   运行：node _net3d_unit.js */
const L = {};
const ctxStub = new Proxy({}, { get: (t, k) => { if (k === 'canvas') return canvasStub; return () => { }; }, set: () => true });
const canvasStub = {
    getContext: () => ctxStub,
    addEventListener: (n, f) => { (L[n] = L[n] || []).push(f); },
    setPointerCapture: () => { },
    getBoundingClientRect: () => ({ width: 800, height: 600 })
};
global.window = { devicePixelRatio: 1, addEventListener: () => { } };
global.requestAnimationFrame = () => 0;                  // 不启动渲染循环
require(__dirname + '/js/neuron/net3d.js');
const view = global.window.Net3D(canvasStub, { autoRotate: false });
const fire = (name, ev) => (L[name] || []).forEach(f => f(ev));
const wheel = dy => fire('wheel', { preventDefault() { }, deltaY: dy });
const pd = (id, x, y) => fire('pointerdown', { pointerId: id, clientX: x, clientY: y });
const pm = (id, x, y) => fire('pointermove', { pointerId: id, clientX: x, clientY: y });
const pu = id => fire('pointerup', { pointerId: id });

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? ' → ' + extra : '')); } };

ok('初始 zoom = 1', view.zoom === 1);
wheel(-120); const z1 = view.zoom;
ok('滚轮向上 = 放大', z1 > 1, 'zoom=' + z1);
wheel(120); wheel(120);
ok('滚轮向下 = 缩小', view.zoom < z1);
view.resetZoom();
ok('复位 = 1', view.zoom === 1);
view.zoomIn(); view.zoomIn(); const z2 = view.zoom;
view.zoomOut();
ok('zoomIn/zoomOut 对称', Math.abs(z2 / view.zoom - 1.25) < 1e-9);
for (let i = 0; i < 60; i++) wheel(-120);
ok('上限夹取 5', Math.abs(view.zoom - 5) < 1e-9, 'zoom=' + view.zoom);
for (let i = 0; i < 120; i++) wheel(120);
ok('下限夹取 0.25', Math.abs(view.zoom - 0.25) < 1e-9, 'zoom=' + view.zoom);
view.resetZoom();
/* 双指捏合：两指距离 100 → 放大到 200（×2） */
pd(1, 100, 300); pd(2, 200, 300);
pm(1, 50, 300); pm(2, 250, 300);      // 距离 200
ok('捏合放大 ≈ ×2', Math.abs(view.zoom - 2) < 0.01, 'zoom=' + view.zoom);
pm(1, 125, 300); pm(2, 175, 300);     // 距离 50 → ×0.5
ok('捏合缩小 ≈ ×0.5（相对按下时基准）', Math.abs(view.zoom - 0.5) < 0.02, 'zoom=' + view.zoom);
pu(1); pu(2);
/* 单指拖动在捏合结束后恢复旋转（角度应变化） */
const a0 = view.angles.ang;
pd(3, 400, 300); pm(3, 500, 300); pu(3);
ok('捏合后单指拖动仍可旋转', view.angles.ang !== a0, 'dAng=' + (view.angles.ang - a0).toFixed(3));

console.log(fail === 0 ? '\n✅ net3d 单测全过（' + pass + '/' + pass + '）' : '\n❌ 失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
