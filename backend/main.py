import os
import json
import logging
import typing_extensions
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import yt_dlp
import requests
import re
from groq import Groq
from google import genai
from google.genai import types
import html
from dotenv import load_dotenv
import tempfile
from pathlib import Path
import base64
import subprocess
import time
import asyncio
from fastapi import BackgroundTasks
import firebase_admin
from firebase_admin import credentials, firestore, storage, auth as fb_auth
import uuid
from urllib.parse import quote, unquote, urlparse
import hashlib
import ipaddress
import shutil
import threading
from collections import defaultdict, deque
from fastapi import Depends, Header, Request

# Load env vars
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Social Recipe Extractor")

# Initialize Firebase Admin
firebase_service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT")
db = None
storage_bucket = None
if firebase_service_account:
    try:
        cred_dict = json.loads(firebase_service_account)
        cred = credentials.Certificate(cred_dict)
        # Optionally attach a Storage bucket so we can re-host thumbnails.
        storage_bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")
        if storage_bucket_name:
            firebase_admin.initialize_app(cred, {"storageBucket": storage_bucket_name})
        else:
            firebase_admin.initialize_app(cred)
        db = firestore.client()
        if storage_bucket_name:
            storage_bucket = storage.bucket()
            logger.info(f"Firebase Storage bucket ready: {storage_bucket_name}")
        else:
            logger.warning("FIREBASE_STORAGE_BUCKET not set; thumbnails will be stored as original (expiring) URLs.")
        logger.info("Firebase Admin initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize Firebase Admin: {e}")
else:
    logger.warning("FIREBASE_SERVICE_ACCOUNT environment variable not found. Background imports will fail.")


# --- URL safety (SSRF guard) ---------------------------------------------

BASE_DOMAINS = ("tiktok.com", "instagram.com", "youtube.com", "youtu.be")
MAX_VIDEO_BYTES = int(os.getenv("MAX_VIDEO_BYTES", str(120 * 1024 * 1024)))
MEDIA_CDN_MARKERS = ("tiktokcdn", "tiktokcdn-us", "fbcdn", "cdninstagram", "ytimg", "googlevideo")


def _hostname(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def _is_private_host(host: str) -> bool:
    """Blocks localhost, link-local (cloud metadata) and RFC1918 targets."""
    if not host or host in ("localhost",) or host.endswith(".local") or host.endswith(".internal"):
        return True
    try:
        return ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback \
            or ipaddress.ip_address(host).is_link_local or ipaddress.ip_address(host).is_reserved
    except ValueError:
        return False  # not a literal IP


def _host_allowed(url: str) -> bool:
    if not url.lower().startswith("https://"):
        return False
    host = _hostname(url)
    if not host or _is_private_host(host):
        return False
    host = host[4:] if host.startswith("www.") else host
    return any(host == d or host.endswith("." + d) for d in BASE_DOMAINS)


def assert_supported_url(url: str) -> str:
    """Validates a caller-supplied URL before AND after redirect resolution.
    Returns the resolved canonical URL. Raises 400 for anything off-allowlist."""
    url = (url or "").strip()
    if not _host_allowed(url):
        raise HTTPException(
            status_code=400,
            detail="Unsupported URL. Only TikTok, Instagram and YouTube links are accepted.",
        )
    resolved = resolve_redirects(url)
    if not _host_allowed(resolved):
        raise HTTPException(status_code=400, detail="URL redirected to an unsupported destination.")
    return resolved


def is_safe_media_url(url: str) -> bool:
    """Only allow downloading media from recognised platform CDNs."""
    if not url or not url.lower().startswith("https://"):
        return False
    host = _hostname(url)
    if not host or _is_private_host(host):
        return False
    return any(marker in host for marker in MEDIA_CDN_MARKERS)


# --- Auth ------------------------------------------------------------------

def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip() or None


def require_user(authorization: Optional[str] = Header(None)) -> str:
    """Hard requirement: a valid Firebase ID token. Returns the verified uid."""
    token = _bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Sign-in required.")
    if not firebase_admin._apps:
        raise HTTPException(status_code=503, detail="Auth is not configured on the server.")
    try:
        return fb_auth.verify_id_token(token)["uid"]
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please sign in again.")


def optional_user(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """Soft auth: identifies the caller when possible, but allows anonymous use."""
    token = _bearer(authorization)
    if not token or not firebase_admin._apps:
        return None
    try:
        return fb_auth.verify_id_token(token)["uid"]
    except Exception:
        return None


# --- Rate limiting ---------------------------------------------------------
# In-memory sliding window. Adequate for a single instance; swap for Redis if
# the backend is ever scaled horizontally.

_RATE_LOCK = threading.Lock()
_RATE_HITS: dict = defaultdict(deque)
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "20"))


def rate_limit(request: Request, uid: Optional[str] = Depends(optional_user)) -> None:
    """Throttles per signed-in user, falling back to client IP for anonymous callers."""
    identity = uid or (request.client.host if request.client else "unknown")
    now = time.time()
    with _RATE_LOCK:
        hits = _RATE_HITS[identity]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= RATE_LIMIT_PER_MIN:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please wait a minute and try again.",
            )
        hits.append(now)


def stable_recipe_id(user_id: str, video_id: Optional[str], url: str) -> str:
    """Deterministic Firestore doc ID so re-importing can never create duplicates
    and no composite index is needed for de-duplication."""
    key = video_id or hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", f"{user_id}_{key}")
    return safe[:200]


TIKTOK_VIDEO_ID_RE = re.compile(r"/video/(\d+)")
# watch?v=, youtu.be/, /shorts/ and /embed/ all carry the same 11-char id.
YOUTUBE_VIDEO_ID_RE = re.compile(r"(?:[?&]v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})")


def video_id_from_url(url: str) -> Optional[str]:
    """Stable platform video id (TikTok numeric or YouTube 11-char), or None.

    Giving YouTube recipes a video id means the deterministic doc id keys on
    the video rather than the URL text, so youtu.be and youtube.com/watch
    forms of the same video de-duplicate."""
    m = TIKTOK_VIDEO_ID_RE.search(url or "")
    if m:
        return m.group(1)
    m = YOUTUBE_VIDEO_ID_RE.search(url or "")
    return m.group(1) if m else None


def rehost_thumbnail(thumbnail_url: Optional[str], key: Optional[str]) -> Optional[str]:
    """Download an (expiring) source thumbnail and re-host it in Firebase Storage,
    returning a permanent download URL. Falls back to the original URL on any
    failure or if Storage isn't configured, so extraction can never break."""
    if not thumbnail_url or storage_bucket is None:
        return thumbnail_url
    if not is_safe_media_url(thumbnail_url):
        logger.warning("Refusing to re-host thumbnail from unrecognised host.")
        return thumbnail_url
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
            "Referer": "https://www.tiktok.com/",
        }
        resp = requests.get(thumbnail_url, headers=headers, timeout=15)
        if resp.status_code != 200 or not resp.content:
            return thumbnail_url
        content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
        ext = "jpg"
        if "png" in content_type:
            ext = "png"
        elif "webp" in content_type:
            ext = "webp"
        safe_key = re.sub(r"[^A-Za-z0-9_-]", "_", key or uuid.uuid4().hex)[:120]
        blob = storage_bucket.blob(f"recipe_thumbnails/{safe_key}.{ext}")
        token = str(uuid.uuid4())
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.upload_from_string(resp.content, content_type=content_type or "image/jpeg")
        return (
            f"https://firebasestorage.googleapis.com/v0/b/{storage_bucket.name}"
            f"/o/{quote(blob.name, safe='')}?alt=media&token={token}"
        )
    except Exception as e:
        logger.warning(f"Thumbnail re-host failed, keeping original URL: {e}")
        return thumbnail_url

# Configure CORS. Pinned to this project's own deployments - the previous
# `https://.*\.vercel\.app` regex let ANY Vercel app on the internet make
# credentialed calls to this API.
DEFAULT_ORIGIN_REGEX = (
    r"^https://social-recipe-app(-[a-z0-9-]+)?\.vercel\.app$"
    r"|^https://social-recipe-app\.web\.app$"
    r"|^http://localhost(:\d+)?$"
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX", DEFAULT_ORIGIN_REGEX),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# --- Models ---

class ExtractRequest(BaseModel):
    url: str
    # NOTE: caller-supplied API keys are deliberately no longer honoured.
    # Keys come from the server environment only.

class Ingredient(typing_extensions.TypedDict):
    item: str
    amount: Optional[str]
    unit: Optional[str]
    group: Optional[str] # New field: e.g. "Sauce", "Marinade"

class Recipe(typing_extensions.TypedDict):
    title: str
    description: str
    ingredients: List[Ingredient]
    instructions: List[str]
    prep_time: Optional[str]
    cook_time: Optional[str]
    servings: Optional[str]
    image_url: Optional[str]
    tags: List[str]  # Replaces 'category', stores ["Lunch", "Sandwich", etc.]

# --- Functions ---






# Optional yt-dlp cookies (Netscape cookies.txt content via env var) to get
# past YouTube's datacenter-IP bot checks. Written once to a private temp file
# because yt-dlp only accepts a file path.
_YTDLP_COOKIE_FILE: Optional[str] = None
_ytdlp_cookies = os.getenv("YTDLP_COOKIES", "")
if _ytdlp_cookies.strip():
    try:
        _fd, _cookie_path = tempfile.mkstemp(prefix="ytdlp_cookies_", suffix=".txt")
        with os.fdopen(_fd, "w") as _f:
            _f.write(_ytdlp_cookies)
        _YTDLP_COOKIE_FILE = _cookie_path
        logger.info("yt-dlp cookie file configured from YTDLP_COOKIES.")
    except Exception as _e:
        logger.warning(f"Could not write yt-dlp cookie file: {_e}")


def _is_youtube(url: str) -> bool:
    host = _hostname(url)
    host = host[4:] if host.startswith("www.") else host
    return host in ("youtu.be", "youtube.com") or host.endswith(".youtube.com")


def _is_instagram(url: str) -> bool:
    host = _hostname(url)
    host = host[4:] if host.startswith("www.") else host
    return host == "instagram.com" or host.endswith(".instagram.com")


INSTAGRAM_POST_RE = re.compile(r"/(reel|reels|p|tv)/([A-Za-z0-9_-]+)")


def canonicalize_source_url(url: str) -> str:
    """Normalizes an Instagram post URL to a stable canonical form.

    Share links carry per-share tracking params (?igsh=...), so the same reel
    hashed by full URL produced a different recipe id for every person who
    shared it - re-imports duplicated instead of overwriting."""
    if _is_instagram(url):
        # unquote: a login redirect carries the post path percent-encoded
        # in its ?next= parameter.
        m = INSTAGRAM_POST_RE.search(unquote(url))
        if m:
            kind = "reel" if m.group(1) in ("reel", "reels") else m.group(1)
            return f"https://www.instagram.com/{kind}/{m.group(2)}/"
    return url


TIKTOK_SCOPES = ("webapp.reflow.video.detail", "webapp.video-detail")


def tiktok_page_extract(url: str) -> dict:
    """Pulls caption, thumbnail and ASR subtitles out of the TikTok page JSON.

    yt-dlp is currently blocked by TikTok ("Video not available, status code 0"),
    which meant subtitles were unreachable and only the caption was ever parsed.
    The page HTML is still served normally and embeds `subtitleInfos` - an
    auto-transcribed WebVTT of the spoken audio - so the narration can be read
    directly, with no video download and no Whisper call.
    """
    out = {"desc": "", "thumbnail": "", "subtitles": ""}
    try:
        headers = {
            "User-Agent": ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                           "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
                           "Mobile/15E148 Safari/604.1"),
            "Accept-Language": "en-US,en;q=0.9",
        }
        html_text = requests.get(url, headers=headers, timeout=15).text
        m = re.search(
            r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>',
            html_text, re.DOTALL)
        if not m:
            return out
        scope = json.loads(m.group(1)).get("__DEFAULT_SCOPE__", {})

        item = {}
        for key in TIKTOK_SCOPES:
            item = scope.get(key, {}).get("itemInfo", {}).get("itemStruct", {}) or {}
            if item:
                break
        if not item:
            return out

        out["desc"] = item.get("desc", "") or ""
        video = item.get("video", {}) or {}
        out["thumbnail"] = video.get("cover") or video.get("originCover") or ""

        tracks = video.get("subtitleInfos") or []
        english = [t for t in tracks
                   if str(t.get("LanguageCodeName", "")).lower().startswith("en")]
        for track in (english or tracks):
            sub_url = track.get("Url")
            if not sub_url or not is_safe_media_url(sub_url):
                continue
            try:
                vtt = requests.get(sub_url, headers=headers, timeout=15)
                if vtt.status_code == 200 and vtt.text.strip():
                    out["subtitles"] = clean_vtt(vtt.text)
                    logger.info(
                        f"TikTok subtitles: {track.get('LanguageCodeName')} "
                        f"{track.get('Source')} -> {len(out['subtitles'])} chars")
                    break
            except Exception as e_sub:
                logger.warning(f"Subtitle fetch failed: {e_sub}")
    except Exception as e:
        logger.warning(f"TikTok page extraction failed: {e}")
    return out


def _clean_caption(text: str) -> str:
    """Normalizes Instagram caption whitespace.

    Instagram composes captions with U+2028 LINE SEPARATOR (and occasionally
    U+2029) rather than newlines, so an ingredient list arrives as one run-on
    line - "Ingredients: - Chorizo - Baguette - Provolone" - which is much
    harder for the parser to split into items than a real list.
    """
    text = text.replace("\u2028", "\n").replace("\u2029", "\n")
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def instagram_page_extract(url: str) -> dict:
    """Pulls the full caption and thumbnail from Instagram's embed page.

    Instagram serves the normal post page behind a login wall to datacenter
    IPs, so the generic og:description fallback only ever saw a truncated
    "N likes, M comments - ..." snippet - captions containing a complete
    recipe were reported as "no recipe". The /embed/captioned/ variant exists
    for third-party embeds, is served without auth, and carries the whole
    caption both as rendered HTML and inside its context JSON.
    """
    out = {"desc": "", "thumbnail": ""}
    m = INSTAGRAM_POST_RE.search(unquote(url))
    if not m:
        return out
    shortcode = m.group(2)
    try:
        headers = {
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
            "Accept-Language": "en-US,en;q=0.9",
        }
        r = requests.get(
            f"https://www.instagram.com/p/{shortcode}/embed/captioned/",
            headers=headers, timeout=15)
        if r.status_code != 200 or not r.text:
            return out
        html_text = r.text

        # Route 1: the rendered caption block.
        cap = re.search(r'<div class="Caption"[^>]*>(.*?)<div class="CaptionComments"',
                        html_text, re.DOTALL)
        if not cap:
            cap = re.search(r'<div class="Caption"[^>]*>(.*?)</div>', html_text, re.DOTALL)
        if cap:
            block = cap.group(1)
            # The block opens with the poster's handle as a link; keeping it made
            # the username the first line of the "caption".
            block = re.sub(r'<a class="CaptionUsername".*?</a>', "", block, flags=re.DOTALL)
            text = re.sub(r"<br\s*/?>", "\n", block)
            text = re.sub(r"<[^>]+>", " ", text)
            out["desc"] = _clean_caption(html.unescape(text))

        # Route 2: caption text inside the page JSON (plain or string-escaped).
        if not out["desc"]:
            mm = re.search(
                r'"edge_media_to_caption"\s*:\s*\{"edges":\s*\[\{"node":\s*\{"text":\s*"((?:[^"\\]|\\.)*)"',
                html_text)
            if mm:
                try:
                    out["desc"] = _clean_caption(json.loads(f'"{mm.group(1)}"'))
                except Exception:
                    pass
        if not out["desc"]:
            ctx = re.search(r'"contextJSON"\s*:\s*"((?:[^"\\]|\\.)*)"', html_text)
            if ctx:
                try:
                    ctx_data = json.loads(json.loads(f'"{ctx.group(1)}"'))
                    media = (ctx_data.get("gql_data") or {}).get("shortcode_media") or {}
                    edges = (media.get("edge_media_to_caption") or {}).get("edges") or []
                    if edges:
                        out["desc"] = _clean_caption((edges[0].get("node") or {}).get("text", ""))
                    if not out["thumbnail"]:
                        out["thumbnail"] = media.get("display_url", "") or ""
                except Exception as e_ctx:
                    logger.warning(f"Instagram contextJSON parse failed: {e_ctx}")

        if not out["thumbnail"]:
            img = re.search(r'class="EmbeddedMediaImage"[^>]*\bsrc="([^"]+)"', html_text)
            if img:
                out["thumbnail"] = html.unescape(img.group(1))

        if out["desc"]:
            logger.info(f"Instagram embed path: caption={len(out['desc'])} chars")
    except Exception as e:
        logger.warning(f"Instagram embed extraction failed: {e}")
    return out


def youtube_page_extract(url: str) -> dict:
    """Pulls title, full description, thumbnail and captions from the watch page.

    yt-dlp needs YouTube's player API, which frequently rejects datacenter IPs
    ("confirm you're not a robot") - the reason YouTube extraction has been the
    flakiest of the three platforms. The plain watch page is served far more
    reliably and embeds `ytInitialPlayerResponse`, which carries the full
    (untruncated) description plus URLs for the manual/auto captions, so both
    the caption text and the narration can be read without the player API.
    """
    out = {"title": "", "desc": "", "thumbnail": "", "subtitles": ""}
    try:
        headers = {
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
            "Accept-Language": "en-US,en;q=0.9",
            # Skips the EU consent interstitial, which hides the player JSON.
            "Cookie": "CONSENT=YES+1; SOCS=CAI",
        }
        html_text = requests.get(url, headers=headers, timeout=15).text
        idx = html_text.find("ytInitialPlayerResponse")
        if idx == -1:
            return out
        brace = html_text.find("{", idx)
        if brace == -1:
            return out
        # raw_decode parses exactly one JSON object and ignores the JS after it.
        player, _ = json.JSONDecoder().raw_decode(html_text[brace:])

        details = player.get("videoDetails", {}) or {}
        out["title"] = details.get("title", "") or ""
        out["desc"] = details.get("shortDescription", "") or ""
        thumbs = (details.get("thumbnail", {}) or {}).get("thumbnails", []) or []
        if thumbs:
            out["thumbnail"] = thumbs[-1].get("url", "") or ""

        tracks = (player.get("captions", {})
                  .get("playerCaptionsTracklistRenderer", {})
                  .get("captionTracks", [])) or []

        def rank(track: dict):
            lang = str(track.get("languageCode", "")).lower()
            lang_rank = 0 if lang.startswith("en") else (1 if lang.startswith("nl") else 2)
            manual_rank = 1 if str(track.get("kind", "")) == "asr" else 0
            return (lang_rank, manual_rank)

        for track in sorted(tracks, key=rank):
            sub_url = track.get("baseUrl") or ""
            if sub_url.startswith("/"):
                sub_url = "https://www.youtube.com" + sub_url
            if not _host_allowed(sub_url):
                continue
            try:
                sep = "&" if "?" in sub_url else "?"
                vtt = requests.get(f"{sub_url}{sep}fmt=vtt", headers=headers, timeout=15)
                if vtt.status_code == 200 and vtt.text.strip():
                    out["subtitles"] = clean_vtt(vtt.text)
                    logger.info(
                        f"YouTube captions: {track.get('languageCode')} "
                        f"kind={track.get('kind') or 'manual'} -> {len(out['subtitles'])} chars")
                    break
            except Exception as e_sub:
                logger.warning(f"YouTube caption fetch failed: {e_sub}")
    except Exception as e:
        logger.warning(f"YouTube page extraction failed: {e}")
    return out


def resolve_redirects(url: str) -> str:
    """
    Expands short URLs (like vm.tiktok.com) to their full canonical form.
    This helps yt-dlp which sometimes struggles with short link redirects.
    """
    try:
        # TikTok specific: they often block HEAD requests, so use GET with stream=True
        headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"}
        resp = requests.get(url, headers=headers, allow_redirects=True, stream=True, timeout=5)
        return resp.url
    except Exception as e:
        logger.warning(f"URL resolution failed: {e}")
        return url

def get_video_data(url: str, extract_audio: bool = False):
    """
    Uses yt-dlp to extract metadata like title, description, and thumbnail.
    Optionally downloads audio for transcription.
    """
    # 0. Validate + resolve short URLs (crucial for TikTok).
    # assert_supported_url enforces the host allowlist BEFORE and AFTER the
    # redirect hop, so a caller cannot point this at internal infrastructure.
    url = assert_supported_url(url)
    logger.info(f"Processing URL: {url}")
    
    # TikTok pre-fetch via oEmbed - TikTok 'title' field = full caption (often has full recipe)
    tiktok_oembed_caption = ""
    tiktok_oembed_title = ""
    tiktok_oembed_thumbnail = ""
    if "tiktok.com" in url:
        try:
            oembed_r = requests.get(f"https://www.tiktok.com/oembed?url={url}", headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
            if oembed_r.status_code == 200:
                od = oembed_r.json()
                tiktok_oembed_caption = od.get('title', '')
                tiktok_oembed_title = tiktok_oembed_caption.split('\n')[0][:80]
                tiktok_oembed_thumbnail = od.get('thumbnail_url', '')
                if tiktok_oembed_caption:
                    logger.info(f"TikTok oEmbed: {len(tiktok_oembed_caption)} chars: {tiktok_oembed_caption[:80]}")
        except Exception as e_oe:
            logger.warning(f"TikTok oEmbed failed: {e_oe}")
    
    # TikTok primary path: caption + ASR subtitles from the page HTML.
    # yt-dlp is blocked by TikTok, so this is the only route to the narration.
    if "tiktok.com" in url and not extract_audio:
        page = tiktok_page_extract(url)
        caption = page["desc"] if len(page["desc"]) > len(tiktok_oembed_caption) else tiktok_oembed_caption
        thumb = page["thumbnail"] or tiktok_oembed_thumbnail
        if caption or page["subtitles"]:
            title = (tiktok_oembed_title or (caption.split("\n")[0][:80] if caption else "")) or "TikTok video"
            combined = f"Title: {title}\nDescription: {caption}"
            if page["subtitles"]:
                combined += f"\n\n[SUBTITLES/CAPTIONS - spoken narration]:\n{page['subtitles']}"
            logger.info(f"TikTok page path: caption={len(caption)} chars, "
                        f"subtitles={len(page['subtitles'])} chars")
            return combined, thumb, None

    # YouTube primary path: full description + captions from the watch page.
    # The player API yt-dlp depends on is frequently bot-blocked on server IPs,
    # while the watch page itself is served normally.
    if _is_youtube(url) and not extract_audio:
        page = youtube_page_extract(url)
        if page["desc"] or page["subtitles"]:
            title = page["title"] or "YouTube video"
            combined = f"Title: {title}\nDescription: {page['desc']}"
            if page["subtitles"]:
                combined += f"\n\n[SUBTITLES/CAPTIONS - spoken narration]:\n{page['subtitles']}"
            logger.info(f"YouTube page path: desc={len(page['desc'])} chars, "
                        f"subtitles={len(page['subtitles'])} chars")
            return combined, page["thumbnail"], None

    # Instagram primary path: full caption from the login-free embed page.
    # The normal post page is behind a login wall for server IPs, which
    # reduced captions to a truncated "N likes, M comments" snippet.
    if _is_instagram(url) and not extract_audio:
        page = instagram_page_extract(url)
        if page["desc"]:
            title = page["desc"].split("\n")[0][:80] or "Instagram video"
            combined = f"Title: {title}\nDescription: {page['desc']}"
            return combined, page["thumbnail"], None

    # 1. Base options for metadata
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en', 'nl', 'en-US', 'en-GB', 'auto'],
        'ignoreerrors': False,
        # Anti-bot: rotate user-agents, prefer mobile clients for TikTok/Instagram
        'extractor_args': {
            'youtube': {'player_client': ['android', 'ios', 'web']},
            'tiktok': {'api_hostname': 'api22-normal-c-useast2a.tiktokv.com', 'app_version': '20.9.0', 'manifest_app_version': '20.9.0', 'webpage_download': True},
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        'socket_timeout': 30,
    }
    if _YTDLP_COOKIE_FILE:
        ydl_opts['cookiefile'] = _YTDLP_COOKIE_FILE

    # 2. Add audio extraction options if requested
    temp_dir = tempfile.gettempdir()
    # Ensure subtitles have a predictable filename pattern
    ydl_opts['outtmpl'] = f'{temp_dir}/%(id)s.%(ext)s'
    
    audio_path = None
    
    if extract_audio:
        ydl_opts.update({
            'skip_download': False,
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    
    # 3. Execute yt-dlp
    info = {}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=extract_audio)
        except Exception as e:
            # FALLBACK: Catch ALL errors (bot detection, generic failures, etc.) and try generic scraping
            logger.warning(f"yt-dlp failed (Error: {str(e)}). Attempting direct HTML scraping...")
            
            # Request purely for HTML metadata
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                }
                # Check for cookies (optional logic kept simple)
                
                resp = requests.get(url, headers=headers, timeout=10)
                if resp.status_code != 200:
                        raise Exception(f"HTML request failed: {resp.status_code}")
                        
                html_text = resp.text
                title = "Unknown Recipe"
                description = "No description available"
                thumbnail = ""
                
                # --- Generic Scraping ---
                # 1. Title
                og_title = re.search(r'<meta property="og:title" content="([^"]*)"', html_text)
                title_tag = re.search(r'<title>([\s\S]*?)</title>', html_text)
                if og_title:
                    title = html.unescape(og_title.group(1))
                elif title_tag:
                    title = html.unescape(title_tag.group(1))
                
                # 2. Description
                og_desc = re.search(r'<meta property="og:description" content="([^"]*)"', html_text)
                name_desc = re.search(r'<meta name="description" content="([^"]*)"', html_text)
                if og_desc:
                    description = html.unescape(og_desc.group(1))
                elif name_desc:
                    description = html.unescape(name_desc.group(1))
                
                # 2b. TikTok SPECIFIC
                if "tiktok.com" in url:
                    try:
                        next_data = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html_text)
                        if next_data:
                            tiktok_data = json.loads(next_data.group(1))
                            item_info = tiktok_data.get('props', {}).get('pageProps', {}).get('itemInfo', {}).get('itemStruct', {})
                            if item_info:
                                tiktok_desc = item_info.get('desc', '')
                                if tiktok_desc:
                                    description = tiktok_desc
                                # Also get thumbnail
                                if 'video' in item_info:
                                    thumbnail = item_info['video'].get('cover', thumbnail)
                    except Exception as e_tt:
                        logger.warning(f"TikTok JSON parsing failed: {e_tt}")
                    # Try __UNIVERSAL_DATA__ and SIGI_STATE (newer TikTok page formats)
                    try:
                        universal = re.search(r'window\.__UNIVERSAL_DATA_FOR_REHYDRATION__\s*=\s*(\{.*?\});', html_text, re.DOTALL)
                        if universal:
                            udata = json.loads(universal.group(1))
                            detail = udata.get('__DEFAULT_SCOPE__', {}).get('webapp.video-detail', {}).get('itemInfo', {}).get('itemStruct', {})
                            if detail:
                                desc = detail.get('desc', '')
                                if desc and len(desc) > len(description):
                                    description = desc
                                if not thumbnail and detail.get('video', {}).get('cover'):
                                    thumbnail = detail['video']['cover']
                        if not universal:
                            sigi = re.search(r'<script id="SIGI_STATE"[^>]*>(.*?)</script>', html_text, re.DOTALL)
                            if sigi:
                                sigi_data = json.loads(sigi.group(1))
                                item_module = sigi_data.get('ItemModule', {})
                                if item_module:
                                    first_item = next(iter(item_module.values()), {})
                                    desc = first_item.get('desc', '')
                                    if desc and len(desc) > len(description):
                                        description = desc
                    except Exception as e_sigi:
                        logger.warning(f"TikTok SIGI/UNIVERSAL parsing failed: {e_sigi}")
                
                # 3. Thumbnail
                if not thumbnail:
                    img_match = re.search(r'<meta property="og:image" content="([^"]*)"', html_text)
                    if img_match:
                        thumbnail = html.unescape(img_match.group(1))
                
                # oEmbed caption fallback for TikTok
                if "tiktok.com" in url:
                    if tiktok_oembed_caption and (not description or description == "No description available" or len(description) < 100):
                        description = tiktok_oembed_caption
                    if tiktok_oembed_title and (not title or title == "Unknown Recipe"):
                        title = tiktok_oembed_title
                    if tiktok_oembed_thumbnail and not thumbnail:
                        thumbnail = tiktok_oembed_thumbnail

                info = {
                    'title': title,
                    'description': description,
                    'thumbnail': thumbnail,
                    'id': 'unknown'
                }
                
            except Exception as e4:
                # If generic scrape failed, we really are stuck.
                logger.error(f"HTML scraping failed: {e4}")
                raise HTTPException(status_code=400, detail=f"Could not fetch video data. Platform may be blocking requests. Error: {str(e4)}")

        try:
            if not info:
                 raise Exception("No video information could be extracted (info dict empty).")
            
            description = info.get('description', '')
            title = info.get('title', '')
            thumbnail = info.get('thumbnail', '')
            video_id = info.get('id')
            
            # Check for audio file if we asked for it AND download succeeded (and not flat extraction)
            if extract_audio and not ydl_opts.get('skip_download') and not ydl_opts.get('extract_flat'):
                # yt-dlp with postprocessor usually appends .mp3
                potential_path = Path(f'{temp_dir}/{video_id}.mp3')
                if potential_path.exists():
                    audio_path = str(potential_path)

            # 4. Look for and read Subtitles (.vtt files)
            combined_text = f"Title: {title}\nDescription: {description}"
            
            # Pattern match for any subtitle file for this video ID
            subtitle_content = ""
            for file_path in Path(temp_dir).glob(f"{video_id}*.vtt"):
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        subtitle_content += clean_vtt(f.read()) + "\n"
                    # Cleanup subtitle file
                    os.remove(file_path)
                except Exception as e:
                    logger.warning(f"Could not read subtitle file {file_path}: {e}")

            if subtitle_content.strip():
                logger.info(f"Subtitles found: {len(subtitle_content)} chars")
                combined_text += f"\n\n[SUBTITLES/CAPTIONS]:\n{subtitle_content.strip()}"

            # yt-dlp's description is sometimes truncated where oEmbed's is not,
            # so keep whichever caption is longer rather than discarding one.
            if tiktok_oembed_caption and len(tiktok_oembed_caption) > len(description or ""):
                combined_text = combined_text.replace(
                    f"Description: {description}", f"Description: {tiktok_oembed_caption}", 1)
            if not thumbnail and tiktok_oembed_thumbnail:
                thumbnail = tiktok_oembed_thumbnail

            return combined_text, thumbnail, audio_path
        except Exception as e:
            logger.error(f"yt-dlp processing error: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Could not process video data: {str(e)}")

def transcribe_audio(audio_path: str, api_key: str):
    """
    Uses Groq Whisper to transcribe audio file.
    """
    if not audio_path:
        return ""
        
    try:
        client = Groq(api_key=api_key)
        # Open the file in binary mode
        with open(audio_path, "rb") as file:
            transcription = client.audio.transcriptions.create(
                file=(os.path.basename(audio_path), file),
                model="whisper-large-v3",
                response_format="text"
            )
        return transcription
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        # Fail silently for transcription so we at least try with just text
        return ""
    finally:
        # Cleanup temp file
        try:
            if os.path.exists(audio_path):
                os.remove(audio_path)
        except:
            pass

QUOTA_DAILY_MARKER = "PerDay"


def quota_scope(err: Exception) -> Optional[str]:
    """Returns 'daily' / 'minute' if this is a Gemini quota error, else None.

    Quota exhaustion is fundamentally different from a parsing failure: the
    request was never served, so the caller should retry later rather than
    treat the video as unusable. Surfacing it as a generic 500 made the
    importer discard recipes it should have kept queued.
    """
    msg = str(err)
    if "RESOURCE_EXHAUSTED" not in msg and "429" not in msg:
        return None
    return "daily" if QUOTA_DAILY_MARKER in msg else "minute"


def raise_if_quota(err: Exception) -> None:
    scope = quota_scope(err)
    if not scope:
        return
    if scope == "daily":
        raise HTTPException(
            status_code=429,
            detail=("Daily AI quota reached on every configured provider. Free-tier daily "
                    "limits reset at midnight US Pacific, so the import can continue then."),
        )
    raise HTTPException(
        status_code=429,
        detail="AI rate limit reached (per-minute cap). Slowing down and retrying.",
    )


# --- LLM provider chain ----------------------------------------------------
# Gemini's free tier allows only 20 requests/day, which makes bulk imports
# impossible. Groq's free tier is far larger, so exhausting one provider falls
# through to the next. The prompt and system instruction are IDENTICAL for every
# provider, so output shape and quality expectations do not change - only the
# model that serves the request once the previous one is out of quota.

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GROQ_MODELS = [m.strip() for m in os.getenv(
    "GROQ_MODELS", "openai/gpt-oss-120b,llama-3.1-8b-instant").split(",") if m.strip()]


def _gemini_json(prompt: str, system: str, api_key: str) -> str:
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            system_instruction=system,
        ),
    )
    return response.text


def _groq_json(prompt: str, system: str, api_key: str, model: str) -> str:
    client = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content


def generate_json(prompt: str, system: str) -> dict:
    """Runs one prompt through the provider chain, returning parsed JSON.

    Falls through to the next provider on any failure (quota, transient error,
    malformed JSON). Raises 429 only when every provider is out of quota, so the
    client can distinguish 'try later' from 'this video is unusable'.
    """
    gemini_key = os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    providers = []
    if gemini_key:
        providers.append((f"gemini:{GEMINI_MODEL}",
                          lambda: _gemini_json(prompt, system, gemini_key)))
    if groq_key:
        for model in GROQ_MODELS:
            providers.append((f"groq:{model}",
                              lambda m=model: _groq_json(prompt, system, groq_key, m)))

    if not providers:
        raise HTTPException(
            status_code=503,
            detail="No LLM provider configured. Set GEMINI_API_KEY and/or GROQ_API_KEY.",
        )

    attempts = []
    quota_scopes = []
    for name, call in providers:
        try:
            data = json.loads(call())
            if attempts:
                logger.info(f"LLM fell through to {name} after: {' | '.join(attempts)}")
            return data
        except Exception as e:
            scope = quota_scope(e)
            if scope:
                quota_scopes.append(scope)
            attempts.append(f"{name}: {'quota:' + scope if scope else str(e)[:150]}")
            continue

    logger.error(f"All LLM providers failed: {' | '.join(attempts)}")
    if quota_scopes and len(quota_scopes) == len(providers):
        # Every provider is rate limited. Prefer the least severe scope so the
        # client retries shortly rather than pausing for the day when it needn't.
        raise_if_quota(Exception(
            "RESOURCE_EXHAUSTED" if "minute" in quota_scopes else "RESOURCE_EXHAUSTED PerDay"))
    raise HTTPException(status_code=500, detail=f"AI parsing failed. {' | '.join(attempts)}")


def parse_with_llm(text_data: str, api_key: str):
    """
    Uses Google Gemini (1.5 Flash) to parse the raw text into a structured Recipe.
    """
    try:
        prompt = f"""
        You are an expert chef and data parser. Extract a structured recipe from the text below, which comes from a social media cooking video (TikTok/Instagram/YouTube). The text may include video titles, descriptions, captions, subtitles, and/or an audio transcript.

        RULES:
        1. METRIC units only for weight/volume (ml, l, g, kg). Keep natural counts for discrete items ("3 cloves garlic", "2 eggs"). Never convert countable items to grams.
        2. If amounts are missing, use your culinary knowledge to estimate sensible metric amounts. Never leave amount blank if you can infer it.
        3. Group ingredients by component when relevant (e.g. "Sauce", "Marinade", "Batter"). Default group is "Main".
        4. Instructions: be detailed and sequential. Expand on implied steps. Aim for a complete cooking guide a beginner could follow.
        5. Tags: assign ALL that apply from:
           - Meal: "Breakfast" "Brunch" "Lunch" "Dinner" "Snack" "Dessert" "Appetizer" "Drink"
           - Dish: "Airfryer" "BBQ" "Slow Cooker" "Pasta" "Pizza" "Burger" "Sandwich" "Wrap" "Tacos" "Salad" "Bowl" "Soup" "Stew" "Curry" "Rice" "Meat" "Fish" "Chicken" "Vegetarian" "Vegan" "Low-Carb" "High-Protein" "Smoothie" "Cocktail" "Sauce" "Side"
           - Extra: "Healthy" "Quick" "Spicy" "Traditional" "One-Pan" etc. if clearly applicable
        6. ALWAYS output everything in English, regardless of input language.
        7. If the text contains no recipe at all, still return the JSON schema with empty arrays and explain in description.

        Return ONLY a valid JSON object — no markdown, no explanation:
        {{
            "title": "string",
            "description": "string (2-3 sentences, appetising summary)",
            "ingredients": [{{"item": "string", "amount": "string", "unit": "string", "group": "string"}}],
            "instructions": ["string", "string"],
            "prep_time": "string (e.g. 10 mins)",
            "cook_time": "string (e.g. 25 mins)",
            "servings": "string (e.g. 2 people)",
            "tags": ["string"],
            "image_url": null
        }}

        Raw Text:
        {text_data}
        """
        
        return generate_json(
            prompt,
            "You are a JSON-only API. You must return a valid JSON object and nothing else.",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise_if_quota(e)
        logger.error(f"Gemini error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI parsing failed: {str(e)}")

# --- Endpoints ---

def extract_direct_video_url(url: str, html: str) -> Optional[str]:
    """
    Attempts to find a direct .mp4 URL from the HTML/JSON of TikTok/Instagram.
    """
    # SKIP YouTube: We use Invidious/yt-dlp for that. Direct parsing is harder and often blocked.
    if "youtube.com" in url or "youtu.be" in url:
        return None

    try:
        # 1. Instagram / Generic OG
        og_video = re.search(r'<meta property="og:video" content="(.*?)"', html)
        if og_video:
            return og_video.group(1)
            
        # 3. TikTok / Generic JSON Regex Scan
        # Strategy: Look for specific keys like "playAddr", "videoUrl", "contentUrl"
        # and extract the value, then decode unicode escapes.
        
        patterns = [
            r'"playAddr":"(https?://[^"]+)"',       # Common TikTok
            r'"video":\{[^}]*"url":"(https?://[^"]+)"', # Some variations
            r'"contentUrl":"(https?://[^"]+)"',     # Schema.org
            r'"downloadAddr":"(https?://[^"]+)"',   # TikTok download
            r'"Url":"(https?://[^"]+)"',            # Generic
            r'(https?://[^"\\\\]*tiktokcdn[^"\\\\]*?\.mp4[^"\\\\]*)', # Broad scan for TikTok CDN
            r'(https?://[^"\\\\]*?\.mp4[^"\\\\]*)'  # ANY .mp4 URL (Last resort)
        ]
        
        for pattern in patterns:
            match = re.search(pattern, html)
            if match:
                raw_url = match.group(1)
                # Decode unicode escapes (e.g. \u002F -> /)
                # And HTML entities if any
                clean_url = raw_url.encode('utf-8').decode('unicode_escape')
                clean_url = clean_url.replace(r'\/', '/')
                
                # Only accept media from recognised platform CDNs. The old check
                # accepted any URL containing the substring "cdn", which allowed
                # arbitrary hosts through.
                if ".mp4" in clean_url and is_safe_media_url(clean_url):
                    return clean_url

        return None
    except Exception as e:
        logger.warning(f"Direct URL extraction failed: {e}")
        return None

def extract_frames(video_path: str, num_frames: int = 4) -> List[str]:
    """
    Extracts key frames from video using FFmpeg and converts to base64.
    """
    import subprocess
    frames = []
    try:
        # Get duration
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", video_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        duration = float(result.stdout)
        
        timestamps = [duration * (i + 1) / (num_frames + 1) for i in range(num_frames)]
        
        for ts in timestamps:
            # Extract frame to memory (pipe)
            cmd = [
                "ffmpeg", "-ss", str(ts), "-i", video_path,
                "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-"
            ]
            process = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if process.returncode == 0:
                frames.append(base64.b64encode(process.stdout).decode('utf-8'))
                
    except Exception as e:
        logger.warning(f"Frame extraction failed: {e}")
        
    return frames

def analyze_visuals_with_gemini(frames: List[str], api_key: str) -> str:
    """
    Sends video frames to Gemini to read on-screen text and actions.
    """
    if not frames:
        return ""
        
    try:
        client = genai.Client(api_key=api_key)
        
        # Prepare content: Text prompt + Images
        contents = [
            "These are frames from a cooking video. Describe strictly what you see: ingredients shown, amounts visible in text overlays, and cooking actions. Do not hallucinate."
        ]
        
        for b64 in frames:
            contents.append(
                types.Part.from_bytes(
                    data=base64.b64decode(b64),
                    mime_type="image/jpeg"
                )
            )

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=1024,
            )
        )
        return "\n\n[VISUAL ANALYSIS]:\n" + response.text
        
    except Exception as e:
        logger.warning(f"Gemini Vision analysis failed: {e}")
        return ""

# --- Endpoints ---

QTY_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:g|gr|grams?|kg|ml|l|lit(?:er|re)s?|tsps?|teaspoons?|tbsps?|"
    r"tablespoons?|cups?|oz|ounces?|lbs?|pounds?|cloves?|slices?|pieces?|cans?|eggs?)\b",
    re.I,
)


def looks_like_recipe(text: str) -> bool:
    """Cheap check for whether text plausibly already contains a recipe.

    Used only to decide whether the expensive enrichment steps are worth
    running - never to decide that extraction succeeded.
    """
    if not text:
        return False
    if len(QTY_RE.findall(text)) >= 3:
        return True
    lowered = text.lower()
    return ("ingredient" in lowered and ("\n-" in text or "\n•" in text or "\n*" in text))


def recipe_has_content(recipe: dict) -> bool:
    """A parse only counts as successful if it actually yielded a recipe."""
    return bool(recipe) and bool(recipe.get("ingredients")) and bool(recipe.get("instructions"))


def clean_vtt(vtt: str) -> str:
    """Strips WEBVTT headers, cue numbers, timestamps and repeated lines.

    Raw VTT is mostly timestamps and duplicated rolling captions; cleaning it
    improves parsing and cuts the token cost roughly in half.
    """
    lines = []
    for line in vtt.splitlines():
        line = line.strip()
        if (not line or line.startswith("WEBVTT") or line.startswith("Kind:")
                or line.startswith("Language:") or "-->" in line or line.isdigit()):
            continue
        line = re.sub(r"<[^>]+>", "", line).strip()
        if line and (not lines or lines[-1] != line):
            lines.append(line)
    return "\n".join(lines)


def is_thin_content(raw_text: str) -> bool:
    """Returns True if the extracted text is too sparse to reliably parse a recipe from."""
    return (
        len(raw_text) < 200 or
        "No description" in raw_text or
        raw_text.strip().startswith("Title: TikTok") or
        raw_text.strip().startswith("Title: Instagram") or
        "Make Your Day" in raw_text
    )


def is_collection_url(url: str) -> bool:
    """Detects if a URL points to a TikTok collection or YouTube playlist."""
    return bool(re.search(r'tiktok\.com/@[^/]+/collection/', url)
                or re.search(r'youtube\.com/playlist\?', url))


class ClassifyRequest(BaseModel):
    videos: List[dict]  # [{video_id, title}]


MAX_CLASSIFY_BATCH = 60


@app.post("/classify-recipes")
def classify_recipes(request: ClassifyRequest, _rl: None = Depends(rate_limit)):
    """
    Takes a list of video titles and classifies each as a recipe/cooking video or not.
    Uses a single fast LLM call so it's cheap even for large collections.
    """
    if not request.videos:
        return {"results": []}

    if not (os.getenv("GEMINI_API_KEY") or os.getenv("GROQ_API_KEY")):
        raise HTTPException(status_code=503, detail="No LLM provider configured on the server.")

    # Large collections must be chunked: asking for hundreds of JSON objects in
    # one response risks truncation, which used to fail silently and mark every
    # video as a recipe.
    if len(request.videos) > MAX_CLASSIFY_BATCH:
        raise HTTPException(
            status_code=413,
            detail=f"Too many videos in one request. Send at most {MAX_CLASSIFY_BATCH} per call.",
        )

    titles_list = "\n".join(
        f'{i + 1}. [id:{v.get("video_id", i)}] {v.get("title") or "(no title)"}'
        for i, v in enumerate(request.videos)
    )

    prompt = f"""Classify each social media video title below as a cooking/recipe video or not.
Recipe = anything involving food preparation, ingredients, cooking techniques, or meals.
Not a recipe = vlogs, challenges, reactions, day-in-my-life, hauls, travel, dance, etc.
If the title is missing or ambiguous, default to true.

Titles:
{titles_list}

Return ONLY this JSON object (one entry per video, same order):
{{"results": [{{"video_id": "string", "is_recipe": true}}]}}"""

    try:
        return generate_json(prompt, "You are a JSON-only API. Return only valid JSON.")
    except Exception as e:
        # Quota errors must surface: silently defaulting everything to
        # "is a recipe" would hide the real problem from the user.
        raise_if_quota(e)
        logger.warning(f"Classification failed: {e} — defaulting all to is_recipe=true")
        # Fail gracefully: mark everything as a recipe so nothing gets silently dropped
        return {"results": [{"video_id": v.get("video_id", str(i)), "is_recipe": True} for i, v in enumerate(request.videos)]}


@app.post("/extract-collection")
def extract_collection(request: ExtractRequest, _rl: None = Depends(rate_limit)):
    """
    Extracts all video URLs from a TikTok collection or YouTube playlist URL.
    Returns list of individual video URLs to be processed one by one.
    """
    resolved_url = assert_supported_url(request.url)
    logger.info(f"Extracting collection from: {resolved_url}")

    ydl_opts = {
        'extract_flat': True,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        # A watch URL that merely carries a ?list= param must stay a single
        # video; only true /playlist URLs should expand into their entries.
        'noplaylist': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        'extractor_args': {
            'tiktok': {'webpage_download': True},
        },
    }
    if _YTDLP_COOKIE_FILE:
        ydl_opts['cookiefile'] = _YTDLP_COOKIE_FILE

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(resolved_url, download=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read collection: {str(e)}")

    if not info:
        raise HTTPException(status_code=400, detail="No data returned for this URL")

    entries = info.get('entries', [])
    if not entries:
        raise HTTPException(status_code=400, detail="No videos found in this collection. Make sure the collection is public.")

    videos = []
    for entry in entries:
        if not entry:
            continue
        video_id = entry.get('id', '')
        # Build a canonical platform URL from the entry when yt-dlp gives none
        webpage_url = entry.get('webpage_url') or entry.get('url', '')
        if not webpage_url.startswith('http') and video_id:
            if _is_youtube(resolved_url):
                webpage_url = f"https://www.youtube.com/watch?v={video_id}"
            else:
                uploader = entry.get('uploader_id') or entry.get('uploader', 'unknown')
                webpage_url = f"https://www.tiktok.com/@{uploader}/video/{video_id}"
        videos.append({
            'url': webpage_url,
            'title': entry.get('title'),
            'thumbnail': entry.get('thumbnail'),
            'video_id': video_id,
        })

    return {
        'is_collection': True,
        'count': len(videos),
        'collection_title': info.get('title'),
        'videos': videos,
    }


@app.post("/extract-recipe")
def extract_recipe(request: ExtractRequest, _rl: None = Depends(rate_limit)):
    # Validate the URL before anything else, so a bad link reports a bad link.
    safe_url = canonicalize_source_url(assert_supported_url(request.url))

    if not (os.getenv("GEMINI_API_KEY") or os.getenv("GROQ_API_KEY")):
        raise HTTPException(status_code=503, detail="No LLM provider configured on the server.")
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        logger.warning("Groq API key not found. Audio transcription will not work.")

    vid = video_id_from_url(safe_url)

    def finalize(recipe_data: dict, thumbnail_url, source: str):
        recipe_data["video_id"] = vid
        recipe_data["source_url"] = safe_url
        recipe_data["image_url"] = rehost_thumbnail(thumbnail_url, vid or safe_url)
        logger.info(f"Extraction succeeded via {source} for {safe_url}")
        return recipe_data

    # --- STAGE 1: caption + subtitles (no audio download) ---
    raw_text, thumbnail_url, _ = get_video_data(safe_url, extract_audio=False)
    recipe_data = parse_with_llm(raw_text, "")
    if recipe_has_content(recipe_data):
        return finalize(recipe_data, thumbnail_url, "caption/subtitles")

    # The caption alone had no recipe in it. Previously the pipeline stopped
    # here whenever the text merely *looked* long enough, so audio and video
    # were never consulted. Escalation is now driven by the parse result.
    logger.info(f"No recipe from caption/subtitles for {safe_url}; escalating to audio")

    # --- STAGE 2: audio transcript via Whisper ---
    transcript = ""
    try:
        _, _, audio_path = get_video_data(safe_url, extract_audio=True)
        if audio_path and groq_api_key:
            transcript = transcribe_audio(audio_path, groq_api_key) or ""
    except Exception as e:
        logger.warning(f"Audio extraction failed: {e}")

    if transcript.strip():
        raw_text += f"\n\n[AUDIO TRANSCRIPT]:\n{transcript.strip()}"
        recipe_data = parse_with_llm(raw_text, "")
        if recipe_has_content(recipe_data):
            return finalize(recipe_data, thumbnail_url, "audio transcript")
        logger.info("Audio transcript still yielded no recipe; escalating to vision")

    # --- STAGE 3: direct video download -> frames + audio -> vision ---
    added_visual = False
    work_dir = tempfile.mkdtemp(prefix="vision_")
    try:
        headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"}
        html_resp = requests.get(safe_url, headers=headers, timeout=10)
        if html_resp.status_code == 200:
            direct_url = extract_direct_video_url(safe_url, html_resp.text)
            if direct_url and is_safe_media_url(direct_url):
                temp_vid_path = os.path.join(work_dir, "video.mp4")
                vid_resp = requests.get(direct_url, stream=True, timeout=30)
                downloaded = 0
                with open(temp_vid_path, "wb") as f:
                    for chunk in vid_resp.iter_content(chunk_size=8192):
                        downloaded += len(chunk)
                        if downloaded > MAX_VIDEO_BYTES:
                            raise Exception("Video exceeds size limit; aborting vision fallback.")
                        f.write(chunk)

                # Audio straight from the downloaded file, in case stage 2's
                # yt-dlp audio download was the part that failed.
                if groq_api_key and not transcript.strip():
                    temp_audio_path = os.path.join(work_dir, "audio.mp3")
                    subprocess.run(
                        ["ffmpeg", "-i", temp_vid_path, "-vn", "-acodec", "libmp3lame", "-y", temp_audio_path],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120,
                    )
                    if os.path.exists(temp_audio_path):
                        t2 = transcribe_audio(temp_audio_path, groq_api_key)
                        if t2 and t2.strip():
                            raw_text += f"\n\n[AUDIO TRANSCRIPT]:\n{t2.strip()}"
                            added_visual = True

                frames = extract_frames(temp_vid_path)
                visual_desc = analyze_visuals_with_gemini(frames, os.getenv("GEMINI_API_KEY") or "")
                if visual_desc and visual_desc.strip():
                    raw_text += visual_desc
                    added_visual = True
    except Exception as e_vision:
        logger.warning(f"Vision fallback failed: {e_vision}")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    if added_visual:
        recipe_data = parse_with_llm(raw_text, "")

    if not recipe_has_content(recipe_data):
        logger.info(f"No recipe could be extracted from {safe_url} after all stages")
    return finalize(recipe_data, thumbnail_url, "vision/final")


class BackgroundImportRequest(BaseModel):
    urls: List[str]
    # user_id is intentionally NOT accepted from the body. It is derived from the
    # verified Firebase ID token, otherwise anyone could write into any cookbook.


MAX_BACKGROUND_URLS = int(os.getenv("MAX_BACKGROUND_URLS", "50"))


def _job_ref(user_id: str, job_id: str):
    return db.collection("import_jobs").document(f"{user_id}_{job_id}")


def process_collection_background_worker(urls: List[str], user_id: str, job_id: str):
    """Runs in FastAPI's threadpool (this is a sync function on purpose).

    The previous version was `async def` but performed blocking yt-dlp, requests
    and Firestore calls directly on the event loop, which froze the entire
    server - health checks included - for the duration of every import.
    """
    if not db:
        logger.error("Database not initialized, cannot process background import.")
        return

    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        logger.error("Gemini API key missing for background import.")
        return

    job = _job_ref(user_id, job_id)
    total = len(urls)
    done = failed = skipped = 0
    try:
        job.set({
            "user_id": user_id, "status": "running", "total": total,
            "done": 0, "failed": 0, "skipped": 0,
            "started_at": time.time() * 1000, "updated_at": time.time() * 1000,
        })
    except Exception as e:
        logger.warning(f"Could not create job doc: {e}")

    for idx, url in enumerate(urls):
        try:
            logger.info(f"Background Import: Processing {idx+1}/{total} - {url}")
            safe_url = canonicalize_source_url(assert_supported_url(url))
            vid = video_id_from_url(safe_url)

            # Deterministic doc ID: re-importing overwrites rather than
            # duplicating, and no composite index is required.
            doc_id = stable_recipe_id(user_id, vid, safe_url)
            if db.collection("recipes").document(doc_id).get().exists:
                skipped += 1
                logger.info(f"Background Import: Skipped {url} (already exists)")
                continue

            raw_text, thumbnail_url, _ = get_video_data(safe_url, extract_audio=False)
            recipe_data = parse_with_llm(raw_text, gemini_api_key)

            if not recipe_data.get("ingredients"):
                failed += 1
                logger.warning(f"Background Import: Skipped {url} (no ingredients found)")
                continue
            title = recipe_data.get("title") or ""
            if title == "No Recipe Found" or "TikTok - Make Your Day" in title:
                failed += 1
                logger.warning(f"Background Import: Skipped {url} (dummy title)")
                continue

            recipe_doc = {
                "user_id": user_id,
                "title": title,
                "description": recipe_data.get("description", ""),
                "ingredients": recipe_data.get("ingredients", []),
                "instructions": recipe_data.get("instructions", []),
                "tags": recipe_data.get("tags", []),
                "image_url": rehost_thumbnail(thumbnail_url, vid or safe_url),
                "prep_time": recipe_data.get("prep_time"),
                "cook_time": recipe_data.get("cook_time"),
                "servings": recipe_data.get("servings"),
                "source_url": safe_url,
                "video_id": vid,
                "created_at": time.time() * 1000,
            }
            db.collection("recipes").document(doc_id).set(recipe_doc)
            done += 1
            logger.info(f"Background Import: Saved {recipe_doc['title']}")
        except Exception as e:
            failed += 1
            logger.error(f"Background Import: Error processing {url}: {e}")

        try:
            job.update({"done": done, "failed": failed, "skipped": skipped,
                        "updated_at": time.time() * 1000})
        except Exception:
            pass
        time.sleep(float(os.getenv("IMPORT_DELAY_SECONDS", "4.5")))

    try:
        job.update({"status": "finished", "done": done, "failed": failed,
                    "skipped": skipped, "finished_at": time.time() * 1000})
    except Exception:
        pass


@app.post("/import-collection-background")
def import_collection_background(
    request: BackgroundImportRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(require_user),
):
    """Server-side import. NOTE: on Render's free plan the instance sleeps after
    ~15 minutes without inbound traffic, so long imports will not finish here.
    The web client drives imports itself and only uses this as a fallback."""
    if not db:
        raise HTTPException(status_code=503, detail="Database is not configured on the server.")
    urls = [u for u in request.urls if u][:MAX_BACKGROUND_URLS]
    if not urls:
        raise HTTPException(status_code=400, detail="No URLs supplied.")

    job_id = uuid.uuid4().hex[:12]
    background_tasks.add_task(process_collection_background_worker, urls, user_id, job_id)
    return {
        "status": "started",
        "job_id": job_id,
        "accepted": len(urls),
        "job_path": f"import_jobs/{user_id}_{job_id}",
    }


# --- Thumbnail resolver ----------------------------------------------------
# TikTok CDN thumbnail URLs are signed and expire, so any image_url captured at
# import time rots within days (verified: old URLs return 403). Rather than
# re-hosting them - which needs Cloud Storage, and therefore a Blaze plan - we
# re-resolve the current thumbnail on demand via oEmbed and redirect to it.
# Thumbnails become self-healing at no cost.

THUMB_RATE_LIMIT_PER_MIN = int(os.getenv("THUMB_RATE_LIMIT_PER_MIN", "300"))
THUMB_TTL_SECONDS = int(os.getenv("THUMB_TTL_SECONDS", "3600"))
_THUMB_CACHE: dict = {}
_THUMB_HITS: dict = defaultdict(deque)
VIDEO_ID_RE = re.compile(r"^\d{5,32}$")
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def thumb_rate_limit(request: Request) -> None:
    """Separate, higher budget from the main API limiter: one cookbook page
    legitimately requests dozens of thumbnails at once."""
    identity = request.client.host if request.client else "unknown"
    now = time.time()
    with _RATE_LOCK:
        hits = _THUMB_HITS[identity]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= THUMB_RATE_LIMIT_PER_MIN:
            raise HTTPException(status_code=429, detail="Too many thumbnail requests.")
        hits.append(now)


def resolve_tiktok_thumbnail(video_id: str) -> Optional[str]:
    """oEmbed resolves from the video id alone, so the uploader handle can be a
    placeholder - which matters because legacy recipes never stored one."""
    try:
        r = requests.get(
            "https://www.tiktok.com/oembed",
            params={"url": f"https://www.tiktok.com/@_/video/{video_id}"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=8,
        )
        if r.status_code == 200:
            return r.json().get("thumbnail_url") or None
    except Exception as e:
        logger.warning(f"Thumbnail resolve failed for {video_id}: {e}")
    return None


@app.get("/thumbnail")
def thumbnail(video_id: str, _rl: None = Depends(thumb_rate_limit)):
    # YouTube ids (11 chars, contain letters) map to a stable, predictable
    # thumbnail URL - no resolving or caching needed. TikTok ids are numeric.
    if not VIDEO_ID_RE.match(video_id or ""):
        if YOUTUBE_ID_RE.match(video_id or ""):
            return RedirectResponse(
                f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                status_code=302,
                headers={"Cache-Control": "public, max-age=86400"},
            )
        raise HTTPException(status_code=400, detail="Invalid video id.")

    now = time.time()
    with _RATE_LOCK:
        cached = _THUMB_CACHE.get(video_id)
        if cached and cached[1] > now:
            resolved = cached[0]
        else:
            resolved = None

    if resolved is None:
        resolved = resolve_tiktok_thumbnail(video_id)
        if not resolved or not is_safe_media_url(resolved):
            raise HTTPException(status_code=404, detail="No thumbnail available.")
        with _RATE_LOCK:
            _THUMB_CACHE[video_id] = (resolved, now + THUMB_TTL_SECONDS)
            if len(_THUMB_CACHE) > 5000:
                for k in [k for k, v in _THUMB_CACHE.items() if v[1] <= now][:1000]:
                    _THUMB_CACHE.pop(k, None)

    # Redirect rather than proxy: the bytes never touch this instance, which
    # matters on a free plan with limited bandwidth.
    return RedirectResponse(
        resolved,
        status_code=302,
        headers={"Cache-Control": "public, max-age=1800"},
    )


@app.get("/")
def health_check():
    return {
        "status": "ok",
        "service": "Social Recipe Extractor",
        # Booleans only - never the key values themselves.
        "providers": {
            "gemini": bool(os.getenv("GEMINI_API_KEY")),
            "groq": bool(os.getenv("GROQ_API_KEY")),
            "firebase_admin": bool(firebase_admin._apps),
            "ytdlp_cookies": bool(_YTDLP_COOKIE_FILE),
        },
        "llm_chain": ([f"gemini:{GEMINI_MODEL}"] if os.getenv("GEMINI_API_KEY") else [])
                     + ([f"groq:{m}" for m in GROQ_MODELS] if os.getenv("GROQ_API_KEY") else []),
    }
