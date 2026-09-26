#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从单行混淆 JS 中提取关键字上下文。
用法: python extract.py <file> <keyword> [before] [after] [max_hits]
"""
import sys, io, re

def main():
    if len(sys.argv) < 3:
        print(__doc__); return 1
    path, kw = sys.argv[1], sys.argv[2]
    before = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    after = int(sys.argv[4]) if len(sys.argv) > 4 else 400
    limit = int(sys.argv[5]) if len(sys.argv) > 5 else 8
    src = io.open(path, 'r', encoding='utf-8', errors='replace').read()
    idx = 0; hit = 0
    while True:
        i = src.find(kw, idx)
        if i < 0: break
        hit += 1
        if hit > limit:
            print("... (more hits truncated)"); break
        s = max(0, i - before); e = min(len(src), i + len(kw) + after)
        print("=" * 20, "HIT", hit, "at", i, "=" * 20)
        seg = src[s:e]
        # 在常见分隔符处插入换行，提升可读性
        seg = seg.replace(';', ';\n').replace('{', '{\n').replace('}', '\n}\n')
        lines = [l for l in seg.split('\n') if l.strip()]
        print('\n'.join(lines)[:6000])
        print()
        idx = i + len(kw)
    return 0

if __name__ == '__main__':
    sys.exit(main())
