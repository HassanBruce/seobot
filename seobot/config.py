"""Settings come from environment variables (.env) and sites.json."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
SITES_FILE = Path(os.environ.get("SITES_FILE", ROOT / "sites.json"))
GSC_KEY_FILE = Path(os.environ.get("GSC_KEY_FILE", ROOT / "secrets" / "gsc.json"))
TUBEBOT_DB = os.environ.get("TUBEBOT_DB", "")          # optional: add YouTube bot activity to the report

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODELS = [m.strip() for m in os.environ.get("GEMINI_MODELS", "gemini-3.5-flash,gemini-3.5-flash-lite").split(",") if m.strip()]

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
REPORT_TO = [x.strip() for x in os.environ.get("REPORT_TO", "").split(",") if x.strip()]
REPORT_LANG = os.environ.get("REPORT_LANG", "simple Roman Urdu (Urdu in English letters), technical words in English")

MAX_PAGES = int(os.environ.get("MAX_PAGES", "300"))        # per site
MAX_LINK_CHECKS = int(os.environ.get("MAX_LINK_CHECKS", "300"))
INSPECT_PER_DAY = int(os.environ.get("INSPECT_PER_DAY", "20"))  # URL Inspection API calls per site per day
USER_AGENT = os.environ.get("USER_AGENT", "Mozilla/5.0 (compatible; seobot/2.0; site owner audit)")


def sites():
    """[{name, url, gsc, blog_pattern, notes}] from sites.json."""
    return json.loads(SITES_FILE.read_text())
