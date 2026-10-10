# -*- coding: utf-8 -*-
"""全站内联 JS 语法检查（回归工具）：把每个 *.html 里的内联 <script> 抽出来跑 node --check。
用途：逮住"注释里写了起止符号把注释提前闭合"这类整块脚本不解析的事故（2026-10-07 chat.html 挂过一次）。
用法：python _check_inline_js.py      （全绿输出 ✅；有错列出文件+块号+node 报错）"""
import io, re, os, subprocess, glob, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SCRIPT_RE = re.compile(r'<script([^>]*)>(.*?)</script>', re.S | re.I)
SKIP_TYPE = re.compile(r'type\s*=\s*["\']?(importmap|application/json|application/ld\+json|text/template)', re.I)
bad = 0; checked = 0
for f in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
    html = io.open(f, encoding='utf-8', errors='replace').read()
    for i, m in enumerate(SCRIPT_RE.finditer(html)):
        attrs, body = m.group(1), m.group(2)
        if 'src=' in attrs or SKIP_TYPE.search(attrs): continue
        if len(body.strip()) < 40: continue
        checked += 1
        tmp = os.path.join(ROOT, '_chk_inline_%d.mjs' % i)
        io.open(tmp, 'w', encoding='utf-8', newline='\n').write(body)
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
        os.remove(tmp)
        if r.returncode != 0:
            bad += 1
            # 从 node 报错的行号反推 html 里的行号
            mm = re.search(r'_chk_inline_\d+\.mjs:(\d+)', r.stderr or '')
            line_in_html = (html[:m.start(2)].count('\n') + 1 + (int(mm.group(1)) if mm else 0))
            print('❌ %s 第%d个内联script（html 约第 %d 行起）' % (os.path.basename(f), i, line_in_html))
            print('   ' + '\n   '.join((r.stderr or '').strip().split('\n')[-4:]))
print(('✅ 全部通过：检查了 %d 个内联 script 块' % checked) if bad == 0 else ('❌ 有 %d 个坏块 / 共 %d 个' % (bad, checked)))
sys.exit(1 if bad else 0)
