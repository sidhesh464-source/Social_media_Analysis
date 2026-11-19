#!/usr/bin/env python3
import sys
current = None
total = 0
for line in sys.stdin:
    parts = line.strip().split("\t")
    if len(parts) != 2:
        continue
    key, value = parts
    try:
        count = int(value)
    except ValueError:
        continue
    if current is not None and key != current:
        print(f"{current}\t{total}")
        total = 0
    current = key
    total += count
if current is not None:
    print(f"{current}\t{total}")
