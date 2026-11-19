#!/usr/bin/env python3
import sys, json, re
POS={"amazing","excellent","good","great","love","wonderful","best","happy","awesome","fantastic","recommend","satisfied","useful","beautiful","super"}
NEG={"bad","terrible","worst","hate","awful","poor","sad","angry","broken","disappointing","waste","problem","slow","useless","horrible"}
for line in sys.stdin:
    try:
        obj=json.loads(line)
        text=str(obj.get("text","")).lower()
    except Exception:
        text=line.lower()
    words=re.findall(r"[a-z']+",text)
    pos=sum(w in POS for w in words)
    neg=sum(w in NEG for w in words)
    label="positive" if pos>neg else "negative" if neg>pos else "neutral"
    print(f"{label}\t1")
