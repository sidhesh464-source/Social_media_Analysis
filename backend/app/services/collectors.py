import os, requests

def reddit_search(query, limit=100):
    cid, secret = os.getenv("REDDIT_CLIENT_ID"), os.getenv("REDDIT_CLIENT_SECRET")
    if not cid or not secret:
        raise RuntimeError("Reddit API credentials are not configured.")
    auth = requests.auth.HTTPBasicAuth(cid, secret)
    token = requests.post("https://www.reddit.com/api/v1/access_token",
        auth=auth, data={"grant_type":"client_credentials"},
        headers={"User-Agent":os.getenv("REDDIT_USER_AGENT","SentimentX/1.0")}, timeout=20)
    token.raise_for_status()
    access = token.json()["access_token"]
    response = requests.get("https://oauth.reddit.com/search",
        params={"q":query,"limit":min(max(int(limit),1),100),"sort":"new"},
        headers={"Authorization":f"Bearer {access}","User-Agent":os.getenv("REDDIT_USER_AGENT","SentimentX/1.0")},
        timeout=30)
    response.raise_for_status()
    posts = []
    for child in response.json().get("data",{}).get("children",[]):
        d = child.get("data",{})
        posts.append({"platform":"reddit","external_id":d.get("id"),"author":d.get("author"),
                      "text":d.get("title","") + " " + d.get("selftext",""),
                      "created_utc":d.get("created_utc"),"url":"https://reddit.com"+d.get("permalink","")})
    return posts

def youtube_search(query, limit=25):
    key = os.getenv("YOUTUBE_API_KEY")
    if not key:
        raise RuntimeError("YouTube API key is not configured.")
    r = requests.get("https://www.googleapis.com/youtube/v3/search",
        params={"part":"snippet","q":query,"type":"video","maxResults":min(max(int(limit),1),50),"key":key},
        timeout=30)
    r.raise_for_status()
    return [{"platform":"youtube","external_id":x["id"]["videoId"],
             "author":x["snippet"].get("channelTitle"),
             "text":x["snippet"].get("title","")+" "+x["snippet"].get("description",""),
             "created_at":x["snippet"].get("publishedAt")} for x in r.json().get("items",[])]
