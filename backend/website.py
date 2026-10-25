"""Recipe extraction from ordinary recipe websites.

Most recipe sites (Allerhande, Leuke Recepten, BBC Good Food, AllRecipes, food
blogs on WordPress recipe plugins...) embed the recipe as schema.org JSON-LD
for Google's rich results. That is read first: it is exact, cheap and does not
depend on the page layout. Pages without it fall back to their visible text.

Some sites serve servers in data centres (Render included) a stripped or
challenge page without the recipe, while the same request from elsewhere gets
the full page. When the direct fetch has no structured recipe, or is refused,
the page is fetched once more through a public reader service, and its copy is
used when it does carry the recipe.

Fetching an arbitrary user-supplied URL from the server is an SSRF risk, so
every hop is checked: http(s) only, standard ports, and the host must resolve
to public addresses only. Redirects are followed by hand so each target is
checked too.
"""
import html as html_lib
import ipaddress
import json
import logging
import re
import socket
from typing import Iterable, List, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import requests

MAX_PAGE_BYTES = 4 * 1024 * 1024
MAX_REDIRECTS = 5
MAX_TEXT_CHARS = 15000
FETCH_TIMEOUT = 12
READER_URL = "https://r.jina.ai/"
READER_TIMEOUT = 25

logger = logging.getLogger(__name__)

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "nl,en;q=0.8",
}


class WebsiteError(Exception):
    """A user-facing failure. `status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400, blocked: bool = False):
        super().__init__(message)
        self.status = status
        # The site answered but refused us; another route may still work.
        self.blocked = blocked


# --- URL safety ------------------------------------------------------------

def _ip_is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def _resolves_public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    addresses = {info[4][0] for info in infos}
    return bool(addresses) and all(_ip_is_public(a) for a in addresses)


def is_web_url(url: str) -> bool:
    """Shape check only (no DNS): an http(s) URL with a dotted public-looking host."""
    try:
        parsed = urlparse((url or "").strip())
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or "." not in host:
        return False
    if parsed.username or parsed.password:
        return False
    if host in ("localhost",) or host.endswith((".local", ".internal", ".localhost")):
        return False
    try:
        port = parsed.port
    except ValueError:
        return False
    if port not in (None, 80, 443):
        return False
    try:
        ipaddress.ip_address(host)
        return _ip_is_public(host)
    except ValueError:
        return True


def assert_public_url(url: str) -> None:
    if not is_web_url(url):
        raise WebsiteError("Unsupported URL. Paste a link to a recipe page (https://...).")
    host = urlparse(url).hostname or ""
    if not _resolves_public(host):
        raise WebsiteError("Could not open this website. Check the link and try again.")


TRACKING_PARAMS = re.compile(r"^(utm_.*|fbclid|gclid|mc_[a-z]+|igshid|ref|ref_src|_ga)$", re.I)


def canonicalize_web_url(url: str) -> str:
    """Drops the fragment and tracking parameters, so the same recipe shared
    from a newsletter and from a browser gets the same id."""
    parsed = urlparse(url.strip())
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if not TRACKING_PARAMS.match(k)]
    return urlunparse((
        parsed.scheme, (parsed.hostname or "").lower() + (f":{parsed.port}" if parsed.port else ""),
        parsed.path or "/", "", urlencode(query), "",
    ))


# --- Fetching ----------------------------------------------------------------

def fetch_page(url: str, session: Optional[requests.Session] = None) -> Tuple[str, str]:
    """Returns (final_url, html). Every redirect target is checked again."""
    http = session or requests
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        assert_public_url(current)
        try:
            resp = http.get(current, headers=BROWSER_HEADERS, timeout=FETCH_TIMEOUT,
                            allow_redirects=False, stream=True)
        except requests.RequestException:
            raise WebsiteError("Could not open this website. Check the link and try again.")
        try:
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                current = urljoin(current, resp.headers["Location"])
                continue
            if resp.status_code in (401, 403, 429, 503):
                raise WebsiteError("This website blocks automatic access. Try another recipe site.",
                                   blocked=True)
            if resp.status_code != 200:
                raise WebsiteError(f"Could not open this website (status {resp.status_code}).")
            content_type = (resp.headers.get("Content-Type") or "").lower()
            if content_type and "html" not in content_type:
                raise WebsiteError("This link is not a web page with a recipe.")
            body = b""
            for chunk in resp.iter_content(chunk_size=65536):
                body += chunk
                if len(body) > MAX_PAGE_BYTES:
                    break
            encoding = resp.encoding if resp.encoding and resp.encoding.lower() != "iso-8859-1" else None
            text = body.decode(encoding or _sniff_charset(body) or "utf-8", errors="replace")
            return current, text
        finally:
            resp.close()
    raise WebsiteError("This link redirects too many times.")


def _sniff_charset(body: bytes) -> Optional[str]:
    m = re.search(rb'<meta[^>]+charset=["\']?([A-Za-z0-9_-]+)', body[:4096], re.I)
    if not m:
        return None
    name = m.group(1).decode("ascii", "ignore")
    try:
        "".encode(name)
        return name
    except LookupError:
        return None


# --- schema.org Recipe -------------------------------------------------------

LD_JSON_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)


def _json_blocks(page: str) -> Iterable[object]:
    for raw in LD_JSON_RE.findall(page):
        raw = raw.strip()
        raw = re.sub(r"^\s*(<!\[CDATA\[|<!--)", "", raw)
        raw = re.sub(r"(\]\]>|-->)\s*$", "", raw)
        for candidate in (raw, html_lib.unescape(raw), re.sub(r"[\x00-\x1f]", " ", raw)):
            try:
                yield json.loads(candidate)
                break
            except ValueError:
                continue


def _is_recipe(node: dict) -> bool:
    kind = node.get("@type")
    kinds = kind if isinstance(kind, list) else [kind]
    return any(isinstance(k, str) and k.split("/")[-1].lower() == "recipe" for k in kinds)


def _walk(node: object, depth: int = 0) -> Iterable[dict]:
    if depth > 8:
        return
    if isinstance(node, list):
        for item in node:
            yield from _walk(item, depth + 1)
    elif isinstance(node, dict):
        if _is_recipe(node):
            yield node
        for key in ("@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item", "hasPart"):
            if key in node:
                yield from _walk(node[key], depth + 1)


def find_recipe_jsonld(page: str) -> Optional[dict]:
    """The schema.org Recipe on the page with the most ingredients, if any."""
    best = None
    for block in _json_blocks(page):
        for recipe in _walk(block):
            if best is None or len(_as_list(recipe.get("recipeIngredient"))) > len(_as_list(best.get("recipeIngredient"))):
                best = recipe
    return best


def _as_list(value: object) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _clean(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        value = value.get("text") or value.get("name") or ""
    text = html_lib.unescape(str(value))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


ISO_DURATION_RE = re.compile(
    r"^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$", re.I)


def iso_duration_to_text(value: object) -> str:
    """"PT1H30M" -> "1 h 30 min". Anything else is returned cleaned up."""
    text = _clean(value)
    m = ISO_DURATION_RE.match(text)
    if not m or not any(m.groups()):
        return text
    days, hours, minutes, seconds = (float(g) if g else 0 for g in m.groups())
    total = round(days * 1440 + hours * 60 + minutes + seconds / 60)
    if total <= 0:
        return ""
    h, mins = divmod(total, 60)
    if h and mins:
        return f"{h} h {mins} min"
    return f"{h} h" if h else f"{mins} min"


def _instructions(value: object, depth: int = 0) -> List[str]:
    if depth > 5 or value is None:
        return []
    if isinstance(value, str):
        text = html_lib.unescape(value)
        parts = re.split(r"(?:<br\s*/?>|</p>|</li>|\n)+", text, flags=re.I)
        return [p for p in (_clean(part) for part in parts) if p]
    if isinstance(value, list):
        return [step for item in value for step in _instructions(item, depth + 1)]
    if isinstance(value, dict):
        if "itemListElement" in value:
            steps = _instructions(value["itemListElement"], depth + 1)
            name = _clean(value.get("name"))
            return ([f"[{name}]"] if name and steps else []) + steps
        text = _clean(value.get("text") or value.get("name"))
        return [text] if text else []
    return []


def _absolute_http(url: object, base_url: str) -> str:
    if not isinstance(url, str) or not url.strip():
        return ""
    joined = urljoin(base_url, url.strip())
    return joined if urlparse(joined).scheme in ("http", "https") else ""


def _image(value: object, base_url: str) -> str:
    for item in _as_list(value):
        url = (item.get("url") or item.get("contentUrl")) if isinstance(item, dict) else item
        absolute = _absolute_http(url, base_url)
        if absolute:
            return absolute
    return ""


def recipe_jsonld_to_text(recipe: dict) -> str:
    """The structured recipe as plain labelled text for the LLM to normalise."""
    lines = [f"Title: {_clean(recipe.get('name'))}"]
    description = _clean(recipe.get("description"))
    if description:
        lines.append(f"Description: {description}")
    yields = [_clean(y) for y in _as_list(recipe.get("recipeYield"))]
    if any(yields):
        lines.append(f"Servings: {max(yields, key=len)}")
    for label, key in (("Prep time", "prepTime"), ("Cook time", "cookTime"), ("Total time", "totalTime")):
        value = iso_duration_to_text(recipe.get(key))
        if value:
            lines.append(f"{label}: {value}")
    for label, key in (("Category", "recipeCategory"), ("Cuisine", "recipeCuisine"), ("Keywords", "keywords")):
        values = [_clean(v) for v in _as_list(recipe.get(key))]
        if any(values):
            lines.append(f"{label}: {', '.join(v for v in values if v)}")
    ingredients = [_clean(i) for i in _as_list(recipe.get("recipeIngredient") or recipe.get("ingredients"))]
    lines.append("Ingredients:")
    lines.extend(f"- {i}" for i in ingredients if i)
    lines.append("Instructions:")
    lines.extend(f"{n}. {step}" for n, step in enumerate(_instructions(recipe.get("recipeInstructions")), 1))
    return "\n".join(lines)


# --- Fallback: page text -----------------------------------------------------

def _meta(page: str, *names: str) -> str:
    for name in names:
        for pattern in (
            rf'<meta[^>]+(?:property|name)=["\']{re.escape(name)}["\'][^>]*content=["\']([^"\']*)["\']',
            rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']{re.escape(name)}["\']',
        ):
            m = re.search(pattern, page, re.I)
            if m and m.group(1).strip():
                return html_lib.unescape(m.group(1)).strip()
    return ""


DROP_BLOCKS_RE = re.compile(
    r"<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template)\b[^>]*>.*?</\1\s*>", re.I | re.S)
BLOCK_TAGS_RE = re.compile(r"</?(p|div|li|ul|ol|h[1-6]|br|tr|section|article|table)\b[^>]*>", re.I)


def visible_text(page: str, limit: int = MAX_TEXT_CHARS) -> str:
    """Readable text of the page, preferring its <article> or <main>."""
    body = re.sub(r"<!--.*?-->", " ", page, flags=re.S)
    body = DROP_BLOCKS_RE.sub(" ", body)
    for tag in ("article", "main"):
        m = re.search(rf"<{tag}\b[^>]*>(.*)</{tag}\s*>", body, re.I | re.S)
        if m and len(re.sub(r"<[^>]+>", "", m.group(1)).strip()) > 500:
            body = m.group(1)
            break
    body = BLOCK_TAGS_RE.sub("\n", body)
    body = html_lib.unescape(re.sub(r"<[^>]+>", " ", body))
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in body.splitlines()]
    text = "\n".join(line for line in lines if line)
    return text[:limit]


def page_title(page: str) -> str:
    title = _meta(page, "og:title", "twitter:title")
    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", page, re.I | re.S)
        title = _clean(m.group(1)) if m else ""
    return title


def fetch_via_reader(url: str) -> Optional[str]:
    """The page's HTML as fetched by the reader service, or None.

    The reader loads the page from its own network, so it gets the full page
    when a site serves data-centre addresses a stripped one. Only public URLs
    that already passed assert_public_url are sent.
    """
    try:
        resp = requests.get(
            READER_URL + url,
            headers={"X-Return-Format": "html", "Accept": "text/html"},
            timeout=READER_TIMEOUT, stream=True)
    except requests.RequestException as e:
        logger.info(f"Reader fetch failed for {url}: {e}")
        return None
    try:
        if resp.status_code != 200:
            logger.info(f"Reader fetch for {url} answered {resp.status_code}")
            return None
        body = b""
        for chunk in resp.iter_content(chunk_size=65536):
            body += chunk
            if len(body) > MAX_PAGE_BYTES:
                break
        return body.decode("utf-8", errors="replace")
    except requests.RequestException:
        return None
    finally:
        resp.close()


def _structured(page: str) -> Optional[dict]:
    recipe = find_recipe_jsonld(page) if page else None
    if recipe and _as_list(recipe.get("recipeIngredient") or recipe.get("ingredients")):
        return recipe
    return None


def extract_website(url: str, session: Optional[requests.Session] = None) -> dict:
    """Fetches a recipe page. Returns {raw_text, image, final_url, structured}."""
    blocked: Optional[WebsiteError] = None
    try:
        final_url, page = fetch_page(url, session)
    except WebsiteError as e:
        if not e.blocked:
            raise
        blocked, final_url, page = e, url, ""
    recipe = _structured(page)
    if not recipe:
        logger.info(f"No structured recipe in direct fetch of {final_url} "
                    f"({'blocked' if blocked else f'{len(page)} chars, title {page_title(page)!r}'}); trying reader")
        alt = fetch_via_reader(final_url)
        alt_recipe = _structured(alt or "")
        if alt_recipe:
            page, recipe = alt, alt_recipe
        elif blocked:
            if not alt:
                raise blocked
            page = alt
    image = _meta(page, "og:image", "og:image:url", "twitter:image")
    if recipe:
        return {
            "raw_text": recipe_jsonld_to_text(recipe),
            "image": _image(recipe.get("image"), final_url) or _absolute_http(image, final_url),
            "final_url": final_url,
            "structured": True,
        }
    text = visible_text(page)
    title = page_title(page)
    description = _meta(page, "og:description", "description")
    raw = "\n".join(filter(None, [
        f"Title: {title}" if title else "",
        f"Description: {description}" if description else "",
        "Page text:",
        text,
    ]))
    return {
        "raw_text": raw,
        "image": _absolute_http(image, final_url),
        "final_url": final_url,
        "structured": False,
    }
