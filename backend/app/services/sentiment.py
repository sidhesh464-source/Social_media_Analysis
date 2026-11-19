import re
from collections import Counter

POSITIVE = {"amazing","excellent","good","great","love","wonderful","best","happy","awesome","fantastic","recommend","satisfied","useful","beautiful","super"}
NEGATIVE = {"bad","terrible","worst","hate","awful","poor","sad","angry","broken","disappointing","waste","problem","slow","useless","horrible"}

def clean_text(value):
    value = re.sub(r"<[^>]+>", " ", str(value or ""))
    value = re.sub(r"https?://\S+|www\.\S+", " ", value)
    value = re.sub(r"[^A-Za-z0-9\s']", " ", value)
    return " ".join(value.lower().split())

def classify(text):
    words = re.findall(r"[a-z']+", clean_text(text))
    counts = Counter(words)
    pos = sum(counts[w] for w in POSITIVE)
    neg = sum(counts[w] for w in NEGATIVE)
    total = pos + neg
    if pos > neg:
        label = "positive"
    elif neg > pos:
        label = "negative"
    else:
        label = "neutral"
    score = (pos - neg) / max(total, 1)
    return label, float(score)
