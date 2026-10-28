"""
Place suggestions for the zmanim "search by city" box, as the reader types.

``suggest(query)`` returns up to ``MAX_SUGGESTIONS`` places, each with its
coordinates and time zone. Two kinds:

* a country that spans several time zones ("United States", "Canada") comes back
  as one choice per zone, each a main city of that zone (Eastern: New York,
  Central: Chicago...). The page puts the zone the reader's own clock is in first.
* anything else is a place from Photon (photon.komoot.io), an OpenStreetMap
  geocoder built for search-as-you-type. Nominatim, which /api/geocode uses for
  one lookup on Enter, forbids autocomplete in its usage policy.

Blocking (requests): call it from a Flask route or a worker thread. Any failure
returns the zone choices alone, or [].
"""

from __future__ import annotations

import logging
import threading
import time
import unicodedata
from typing import Any

import requests

from backend.health_check import health

logger = logging.getLogger(__name__)

PHOTON_URL = "https://photon.komoot.io/api/"
MAX_SUGGESTIONS = 6
MIN_QUERY_CHARS = 2
_MAX_QUERY_CHARS = 80
_TIMEOUT_SECONDS = 3
_CACHE_TTL_SECONDS = 24 * 3600
_CACHE_MAX = 500
_LAYERS = ("city", "locality", "district", "county", "state", "country")
_FETCH = 15  # Photon puts an exact-name hamlet before a city; fetch more and re-rank
# How big a place is, by its OpenStreetMap kind: a city outranks a village of
# the same name ("jeru": Jerusalem before the villages called Jeru).
_SIZE = {
    "country": 6, "city": 5, "state": 4, "town": 3, "municipality": 3,
    "administrative": 2, "county": 2, "borough": 2, "suburb": 2, "region": 2, "province": 2,
    "village": 1, "quarter": 1,
}
_USER_AGENT = "ShelahApp/1.0 (halachic study app; contact via app support)"

# (zone, city, lat, lon, IANA zone), west to east within a country.
_ZONES: dict[str, list[tuple[str, str, float, float, str]]] = {
    "US": [
        ("Hawaii", "Honolulu", 21.3069, -157.8583, "Pacific/Honolulu"),
        ("Alaska", "Anchorage", 61.2181, -149.9003, "America/Anchorage"),
        ("Pacific", "Los Angeles", 34.0522, -118.2437, "America/Los_Angeles"),
        ("Mountain (Arizona)", "Phoenix", 33.4484, -112.0740, "America/Phoenix"),
        ("Mountain", "Denver", 39.7392, -104.9903, "America/Denver"),
        ("Central", "Chicago", 41.8781, -87.6298, "America/Chicago"),
        ("Eastern", "New York", 40.7128, -74.0060, "America/New_York"),
    ],
    "CA": [
        ("Pacific", "Vancouver", 49.2827, -123.1207, "America/Vancouver"),
        ("Mountain", "Calgary", 51.0447, -114.0719, "America/Edmonton"),
        ("Central", "Winnipeg", 49.8951, -97.1384, "America/Winnipeg"),
        ("Eastern", "Toronto", 43.6532, -79.3832, "America/Toronto"),
        ("Atlantic", "Halifax", 44.6488, -63.5752, "America/Halifax"),
        ("Newfoundland", "St. John's", 47.5615, -52.7126, "America/St_Johns"),
    ],
    "AU": [
        ("Western", "Perth", -31.9505, 115.8605, "Australia/Perth"),
        ("Northern Territory", "Darwin", -12.4634, 130.8456, "Australia/Darwin"),
        ("Central", "Adelaide", -34.9285, 138.6007, "Australia/Adelaide"),
        ("Queensland", "Brisbane", -27.4698, 153.0251, "Australia/Brisbane"),
        ("Eastern", "Sydney", -33.8688, 151.2093, "Australia/Sydney"),
    ],
    "MX": [
        ("Pacific", "Tijuana", 32.5149, -117.0382, "America/Tijuana"),
        ("Mountain", "Hermosillo", 29.0729, -110.9559, "America/Hermosillo"),
        ("Central", "Mexico City", 19.4326, -99.1332, "America/Mexico_City"),
        ("Southeast", "Cancún", 21.1619, -86.8515, "America/Cancun"),
    ],
    "BR": [
        ("Amazon", "Manaus", -3.1190, -60.0217, "America/Manaus"),
        ("Brasília", "São Paulo", -23.5505, -46.6333, "America/Sao_Paulo"),
    ],
    "RU": [
        ("Moscow", "Moscow", 55.7558, 37.6173, "Europe/Moscow"),
        ("Yekaterinburg", "Yekaterinburg", 56.8389, 60.6057, "Asia/Yekaterinburg"),
        ("Novosibirsk", "Novosibirsk", 55.0084, 82.9357, "Asia/Novosibirsk"),
        ("Vladivostok", "Vladivostok", 43.1155, 131.8855, "Asia/Vladivostok"),
    ],
}

# A one-zone country's centre can be far from where people live; its main
# Jewish community's city is a better default.
_MAIN_CITY: dict[str, tuple[str, float, float]] = {
    "IL": ("Jerusalem", 31.7683, 35.2137),
    "GB": ("London", 51.5074, -0.1278),
    "FR": ("Paris", 48.8566, 2.3522),
    "AR": ("Buenos Aires", -34.6037, -58.3816),
    "ZA": ("Johannesburg", -26.2041, 28.0473),
    "DE": ("Berlin", 52.5200, 13.4050),
    "BE": ("Antwerp", 51.2194, 4.4025),
    "NL": ("Amsterdam", 52.3676, 4.9041),
    "UA": ("Kyiv", 50.4501, 30.5234),
    "IT": ("Rome", 41.9028, 12.4964),
}

_cache: dict[tuple[str, str], tuple[float, list[dict[str, Any]]]] = {}
_cache_lock = threading.Lock()


def _folded(text: str) -> str:
    """Lower case without accents, for comparing what was typed with a name."""
    decomposed = unicodedata.normalize("NFD", str(text or "").casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).strip()


def _timezone(lat: float, lon: float) -> str:
    from backend.zmanim_engine import _get_timezone_finder

    try:
        return _get_timezone_finder().timezone_at(lng=lon, lat=lat) or ""
    except Exception:  # noqa: BLE001 - a place without a zone still sets zmanim (the engine resolves it)
        return ""


def zone_choices(country_code: str, country_name: str) -> list[dict[str, Any]]:
    """One choice per time zone of a country that has several; [] otherwise."""
    return [
        {
            "name": city, "detail": f"{zone} time, {country_name}", "lat": lat, "lon": lon,
            "timezone": tz, "kind": "zone", "country_code": country_code,
        }
        for zone, city, lat, lon, tz in _ZONES.get(country_code.upper(), [])
    ]


def _place(feature: dict[str, Any]) -> list[dict[str, Any]]:
    """A Photon feature as suggestions: a country with several zones becomes its
    zone choices, a one-zone country its main city, anything else itself."""
    props = feature.get("properties") or {}
    coords = (feature.get("geometry") or {}).get("coordinates") or []
    try:
        lon, lat = float(coords[0]), float(coords[1])
    except (IndexError, TypeError, ValueError):
        return []
    name = str(props.get("name") or "").strip()
    if not name:
        return []
    code = str(props.get("countrycode") or "").upper()
    country = str(props.get("country") or "").strip()
    if props.get("type") == "country":
        zones = zone_choices(code, name)
        if zones:
            return zones
        if code in _MAIN_CITY:
            city, lat, lon = _MAIN_CITY[code]
            return [{"name": city, "detail": name, "lat": lat, "lon": lon,
                     "timezone": _timezone(lat, lon), "kind": "place", "country_code": code}]
    detail = ", ".join(part for part in (str(props.get("state") or "").strip(), country) if part and part != name)
    return [{"name": name, "detail": detail, "lat": lat, "lon": lon,
             "timezone": _timezone(lat, lon), "kind": "place", "country_code": code}]


def _photon(query: str, lang: str) -> list[dict[str, Any]] | None:
    """Photon's features for `query`; None on failure."""
    if not health.is_healthy("photon"):
        return None
    params: list[tuple[str, str]] = [("q", query), ("limit", str(_FETCH))]
    params += [("layer", layer) for layer in _LAYERS]
    if lang == "en":
        params.append(("lang", "en"))  # Photon has no Hebrew names; "he" gets each place's local name
    try:
        resp = requests.get(PHOTON_URL, params=params, headers={"User-Agent": _USER_AGENT}, timeout=_TIMEOUT_SECONDS)
        if not resp.ok:
            health.record_failure("photon")
            return None
        features = resp.json().get("features")
    except (requests.RequestException, ValueError, AttributeError) as exc:
        health.record_failure("photon")
        logger.info("place_suggest: Photon failed: %s", type(exc).__name__)
        return None
    health.record_success("photon")
    return features if isinstance(features, list) else []


def _dedupe(places: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    out = []
    for place in places:
        key = (_folded(place["name"]), _folded(place["detail"]))
        if key not in seen:
            seen.add(key)
            out.append(place)
    return out


def suggest(query: str, lang: str = "en") -> list[dict[str, Any]]:
    """Up to MAX_SUGGESTIONS places for what was typed so far (see the module
    docstring); [] for a query shorter than MIN_QUERY_CHARS. Never raises."""
    query = " ".join(str(query or "").split())[:_MAX_QUERY_CHARS]
    if len(query) < MIN_QUERY_CHARS:
        return []
    lang = "he" if lang == "he" else "en"
    key = (_folded(query), lang)
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            return [dict(place) for place in cached[1]]

    features = _photon(query, lang)
    places: list[dict[str, Any]] = []
    ranked = sorted(
        (feature for feature in features or [] if isinstance(feature, dict)),
        key=lambda feature: -_SIZE.get(str((feature.get("properties") or {}).get("osm_value") or ""), 0))
    for feature in ranked:
        places += _place(feature)
    # A country with several zones lists them all, even past the usual cap.
    zones = sum(1 for place in places if place["kind"] == "zone")
    places = _dedupe(places)[:max(MAX_SUGGESTIONS, zones)]
    if features is not None:
        with _cache_lock:
            if len(_cache) >= _CACHE_MAX:
                _cache.pop(next(iter(_cache)))
            _cache[key] = (now, places)
    return [dict(place) for place in places]
