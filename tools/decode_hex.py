#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""批量解码混淆JS中的逗号分隔hex字符串常量 -> 明文清单"""
import re, sys, io, os

def main():
    d = sys.argv[1] if len(sys.argv) > 1 else 'dxjs'
    pat = re.compile(r'\b((?:[0-9a-fA-F]{2},){2,}[0-9a-fA-F]{2})\b')
    allmap = {}
    for f in sorted(os.listdir(d)):
        if not f.endswith('.js'):
            continue
        src = io.open(os.path.join(d, f), 'r', encoding='utf-8', errors='replace').read()
        found = set()
        for m in pat.finditer(src):
            hx = m.group(1)
            try:
                raw = bytes(int(x, 16) for x in hx.split(','))
                txt = raw.decode('utf-8')
            except Exception:
                continue
            if all(32 <= ord(c) < 127 for c in txt) and len(txt) >= 3:
                found.add((hx, txt))
        for hx, txt in sorted(found, key=lambda x: x[1]):
            allmap.setdefault(txt, set()).add(f)
        print("===== %s : %d hex strings =====" % (f, len(found)))
    print()
    print("##### UNIQUE DECODED (%d) #####" % len(allmap))
    for txt in sorted(allmap):
        print("%-60s  <- %s" % (txt, ','.join(sorted(allmap[txt]))))

if __name__ == '__main__':
    main()
