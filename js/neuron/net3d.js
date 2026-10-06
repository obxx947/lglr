/* ============================================================
   神经网络 3D 状态渲染器（无依赖，canvas 2D + 透视投影）
   ------------------------------------------------------------
   数据形状：{ nodes:[{id,type:'in'|'hidden'|'out',act}], conns:[{in,out,w,enabled}] }
   可选激活：acts = [{id,v}]（最近一次决策里每个节点的输出值）
   用法：const v = Net3D(document.getElementById('cv'), {}); v.setData(net, acts);
   ============================================================ */
(function (root) {
    'use strict';
    function Net3D(canvas, opt) {
        const o = Object.assign({ autoRotate: true, showLabels: true }, opt || {});
        const ctx = canvas.getContext('2d');
        let W = 0, H = 0, DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        let net = null, acts = null, ang = 0, tilt = -0.25, drag = null;
        let pos = {}, actsMap = null;
        function resize() {
            const r = canvas.getBoundingClientRect();
            W = Math.max(320, r.width); H = Math.max(240, r.height);
            canvas.width = W * DPR; canvas.height = H * DPR;
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        }
        function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) / 4294967296; }
        function layout() {
            pos = {};
            if (!net) return;
            const ins = net.nodes.filter(n => n.type === 'in');
            const hid = net.nodes.filter(n => n.type === 'hidden');
            const out = net.nodes.filter(n => n.type === 'out');
            ins.forEach((n, i) => { const a = i / Math.max(1, ins.length) * Math.PI * 2; pos[n.id] = { x: -150, y: Math.cos(a) * (60 + (i % 7) * 4), z: Math.sin(a) * (60 + (i % 7) * 4) }; });
            hid.forEach((n, i) => {
                const t = hash(n.id), t2 = hash(n.id + 'x'), t3 = hash(n.id + 'y');
                const r = 55 + t * 45;
                const a = t2 * Math.PI * 2;
                pos[n.id] = { x: (t3 - 0.5) * 90, y: Math.cos(a) * r, z: Math.sin(a) * r };
            });
            out.forEach((n, i) => { const a = i / Math.max(1, out.length) * Math.PI * 2; pos[n.id] = { x: 150, y: Math.cos(a) * 55, z: Math.sin(a) * 55 }; });
        }
        function project(p) {
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const x1 = p.x * ca - p.z * sa, z1 = p.x * sa + p.z * ca;
            const ct = Math.cos(tilt), st = Math.sin(tilt);
            const y1 = p.y * ct - z1 * st, z2 = p.y * st + z1 * ct;
            const F = 620, zc = z2 + F;
            const s = F / Math.max(40, zc) * 1.15;
            return { x: W / 2 + x1 * s, y: H / 2 + y1 * s, s: s, z: z2 };
        }
        const NEWS = h => (h | 0).toString(16).padStart(6, '0');
        function draw() {
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = 'rgba(10,14,26,1)'; ctx.fillRect(0, 0, W, H);
            if (!net) { ctx.fillStyle = '#5a7a9a'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('还没有数据 —— 去「神经元实验室」开始训练，或从存档里载入一个网络', W / 2, H / 2); return; }
            /* 连接 */
            const edges = net.conns.map(c => {
                const a = pos[c.in], b = pos[c.out];
                if (!a || !b) return null;
                const pa = project(a), pb = project(b);
                return { pa: pa, pb: pb, w: c.w || 0, z: (pa.z + pb.z) / 2 };
            }).filter(Boolean).sort((x, y) => x.z - y.z);
            edges.forEach(e => {
                const aw = Math.min(1, Math.abs(e.w) / 4);
                ctx.strokeStyle = e.w >= 0 ? 'rgba(0,212,255,' + (0.08 + aw * 0.5).toFixed(2) + ')' : 'rgba(255,71,87,' + (0.08 + aw * 0.5).toFixed(2) + ')';
                ctx.lineWidth = Math.max(0.4, Math.min(2.4, Math.abs(e.w) * 0.5)) * Math.min(1.4, e.pa.s);
                ctx.beginPath(); ctx.moveTo(e.pa.x, e.pa.y); ctx.lineTo(e.pb.x, e.pb.y); ctx.stroke();
            });
            /* 节点 */
            const nodes = net.nodes.map(n => {
                const p3 = pos[n.id]; if (!p3) return null;
                const p = project(p3);
                let v = null;
                if (actsMap && actsMap.has(n.id)) v = actsMap.get(n.id);
                return { n: n, p: p, v: v };
            }).filter(Boolean).sort((a, b) => a.p.z - b.p.z);
            nodes.forEach(x => {
                const rad = Math.max(2.2, (x.n.type === 'in' ? 2.6 : x.n.type === 'out' ? 5 : 3.6) * x.p.s);
                let col = x.n.type === 'in' ? '#4a9eff' : x.n.type === 'out' ? '#2ed573' : '#ffd700';
                let alpha = 0.9;
                if (x.v !== null && x.v !== undefined) {
                    const a = Math.min(1, Math.abs(x.v));
                    alpha = 0.25 + a * 0.75;
                    if (x.n.type === 'hidden' || x.n.type === 'out') col = x.v >= 0 ? '#00d4ff' : '#ff4757';
                }
                ctx.globalAlpha = alpha;
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.arc(x.p.x, x.p.y, rad, 0, Math.PI * 2); ctx.fill();
                if (o.showLabels && x.n.type === 'out') {
                    ctx.globalAlpha = 0.95; ctx.fillStyle = '#e8f4ff';
                    ctx.font = Math.max(9, 10 * x.p.s) + 'px sans-serif'; ctx.textAlign = 'left';
                    const lbl = x.n.id === 'o8' ? '不开火' : ('候选' + x.n.id.slice(1));
                    ctx.fillText(lbl, x.p.x + 8, x.p.y + 3);
                }
                ctx.globalAlpha = 1;
            });
        }
        function loop() {
            if (o.autoRotate && !drag) ang += 0.0042;
            draw();
            requestAnimationFrame(loop);
        }
        canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, ang: ang, tilt: tilt }; try { canvas.setPointerCapture(e.pointerId); } catch (er) { } });
        canvas.addEventListener('pointermove', e => {
            if (!drag) return;
            ang = drag.ang + (e.clientX - drag.x) * 0.008;
            tilt = Math.max(-1.2, Math.min(1.2, drag.tilt + (e.clientY - drag.y) * 0.006));
        });
        canvas.addEventListener('pointerup', () => { drag = null; });
        canvas.addEventListener('wheel', e => { e.preventDefault(); }, { passive: false });
        window.addEventListener('resize', () => { resize(); draw(); });
        resize(); requestAnimationFrame(loop);
        return {
            setData: function (n, a) {
                net = n || null;
                actsMap = null;
                if (a && a.length) { actsMap = new Map(); a.forEach(x => actsMap.set(x.id, x.v)); }
                layout();
            },
            setOptions: function (p) { Object.assign(o, p || {}); },
            get angles() { return { ang: ang, tilt: tilt }; }
        };
    }
    root.Net3D = Net3D;
})(window);
