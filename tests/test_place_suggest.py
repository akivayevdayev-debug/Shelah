"""backend/place_suggest.py and /api/geocode/suggest: places for the zmanim city
box as the reader types, each with its time zone, and a country with several
zones as one city per zone."""

import pytest
import requests

from backend import place_suggest


@pytest.fixture(autouse=True)
def _fresh_cache():
    place_suggest._cache.clear()
    yield
    place_suggest._cache.clear()


def _feature(name, lon, lat, **props):
    return {"geometry": {"coordinates": [lon, lat]}, "properties": {"name": name, **props}}


class _Reply:
    def __init__(self, features, ok=True):
        self.ok = ok
        self._features = features

    def json(self):
        return {"features": self._features}


def _photon(monkeypatch, features, ok=True, calls=None):
    def fake_get(url, params=None, **kwargs):
        if calls is not None:
            calls.append(params)
        return _Reply(features, ok)

    monkeypatch.setattr(place_suggest.requests, "get", fake_get)
    monkeypatch.setattr(place_suggest.health, "is_healthy", lambda service: True)
    monkeypatch.setattr(place_suggest.health, "record_success", lambda service: None)
    monkeypatch.setattr(place_suggest.health, "record_failure", lambda service: None)


US = _feature("United States", -100.4, 39.8, type="country", countrycode="US", country="United States")
LONDON = _feature("London", -0.1278, 51.5074, type="city", countrycode="GB", country="United Kingdom", state="England")


def test_a_short_query_asks_nothing(monkeypatch):
    calls = []
    _photon(monkeypatch, [LONDON], calls=calls)
    place_suggest.suggest("l")
    assert calls == []


def test_a_place_keeps_its_region_and_country(monkeypatch):
    _photon(monkeypatch, [LONDON])
    assert place_suggest.suggest("lond")[0]["detail"] == "England, United Kingdom"


def test_a_place_gets_its_time_zone(monkeypatch):
    _photon(monkeypatch, [LONDON])
    assert place_suggest.suggest("lond")[0]["timezone"] == "Europe/London"


def test_a_country_with_several_zones_lists_a_city_per_zone(monkeypatch):
    _photon(monkeypatch, [US])
    assert [p["name"] for p in place_suggest.suggest("united st")] == [
        "Honolulu", "Anchorage", "Los Angeles", "Phoenix", "Denver", "Chicago", "New York"]


def test_a_zone_choice_names_its_zone(monkeypatch):
    _photon(monkeypatch, [US])
    assert place_suggest.suggest("united st")[-1]["detail"] == "Eastern time, United States"


def test_a_zone_choice_is_marked_as_a_zone(monkeypatch):
    _photon(monkeypatch, [US])
    assert {p["kind"] for p in place_suggest.suggest("united st")} == {"zone"}


def test_a_one_zone_country_becomes_its_main_city(monkeypatch):
    _photon(monkeypatch, [_feature("Israel", 35.0, 31.4, type="country", countrycode="IL", country="Israel")])
    assert place_suggest.suggest("israel")[0]["name"] == "Jerusalem"


def test_a_failing_geocoder_gives_no_places(monkeypatch):
    _photon(monkeypatch, [], ok=False)
    assert place_suggest.suggest("lond") == []


def test_a_network_error_gives_no_places(monkeypatch):
    def broken(*args, **kwargs):
        raise requests.ConnectionError("down")

    _photon(monkeypatch, [])
    monkeypatch.setattr(place_suggest.requests, "get", broken)
    assert place_suggest.suggest("lond") == []


def test_no_call_while_the_geocoder_is_down(monkeypatch):
    calls = []
    _photon(monkeypatch, [LONDON], calls=calls)
    monkeypatch.setattr(place_suggest.health, "is_healthy", lambda service: False)
    place_suggest.suggest("lond")
    assert calls == []


def test_answers_are_remembered(monkeypatch):
    calls = []
    _photon(monkeypatch, [LONDON], calls=calls)
    place_suggest.suggest("Lond")
    place_suggest.suggest("lond")
    assert len(calls) == 1


def test_a_failure_is_not_remembered(monkeypatch):
    calls = []
    _photon(monkeypatch, [], ok=False, calls=calls)
    place_suggest.suggest("lond")
    place_suggest.suggest("lond")
    assert len(calls) == 2


def test_repeated_places_are_listed_once(monkeypatch):
    _photon(monkeypatch, [LONDON, LONDON])
    assert len(place_suggest.suggest("lond")) == 1


def test_english_asks_for_english_names(monkeypatch):
    calls = []
    _photon(monkeypatch, [LONDON], calls=calls)
    place_suggest.suggest("lond", "en")
    assert ("lang", "en") in calls[0]


def test_hebrew_asks_for_local_names(monkeypatch):
    calls = []
    _photon(monkeypatch, [LONDON], calls=calls)
    place_suggest.suggest("ירושל", "he")
    assert not [pair for pair in calls[0] if pair[0] == "lang"]


def test_the_route_answers_with_the_places(test_client, monkeypatch):
    monkeypatch.setattr(place_suggest, "suggest", lambda q, lang: [{"name": q, "lang": lang}])
    body = test_client.get("/api/geocode/suggest?q=lond&lang=he").get_json()
    assert body == {"results": [{"name": "lond", "lang": "he"}]}


def test_the_route_answers_an_empty_query_with_no_places(test_client):
    assert test_client.get("/api/geocode/suggest").get_json() == {"results": []}


def test_a_city_outranks_a_village_of_the_same_name(monkeypatch):
    _photon(monkeypatch, [
        _feature("Jeru", 112.0, -7.5, type="city", osm_value="village", countrycode="ID", country="Indonesia"),
        _feature("Jerusalem", 35.21, 31.77, type="city", osm_value="city", countrycode="IL", country="Israel"),
    ])
    assert place_suggest.suggest("jeru")[0]["name"] == "Jerusalem"
