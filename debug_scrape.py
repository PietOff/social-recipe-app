import requests
import re

url = "https://www.youtube.com/watch?v=NJe0Uo-ZuOg"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
}

try:
    print(f"Fetching {url}...")
    resp = requests.get(url, headers=headers, timeout=10)
    print(f"Status Code: {resp.status_code}")
    
    if resp.status_code == 200:
        html = resp.text
        print(f"HTML Length: {len(html)}")
        
        # Test 1: og:title
        title_match = re.search(r'<meta property="og:title" content="(.*?)">', html)
        print(f"og:title match: {title_match.group(1) if title_match else 'NONE'}")
        
        # Test 2: <title> tag
        title_tag_match = re.search(r'<title>(.*?)</title>', html)
        print(f"<title> match: {title_tag_match.group(1) if title_tag_match else 'NONE'}")
        
        # Test 3: og:description
        desc_match = re.search(r'<meta property="og:description" content="(.*?)">', html)
        print(f"og:description match: {desc_match.group(1) if desc_match else 'NONE'}")
        
        # Test 4: name="description"
        name_desc_match = re.search(r'<meta name="description" content="(.*?)">', html)
        print(f"name='description' match: {name_desc_match.group(1) if name_desc_match else 'NONE'}")
        
        # Test 5: Description in JSON-LD (often present!)
        # simplistic check
        if "description" in html[:1000]:
             print("Word 'description' found in first 1000 chars")

    else:
        print("Failed to fetch")

except Exception as e:
    print(f"Error: {e}")
