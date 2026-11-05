"""A question about a rabbi's kabbalah (an undertaking said aloud, such as the
Arizal's acceptance of "love your fellow" each morning) reaches the siddur and
the Kabbalah books, and the prompts tell the model what such a kabbalah is."""

from backend import claude, question_plan, source_search

ARIZAL_QUESTION = "what is the kabbalah of the arizal that you say every morning"
ARIZAL_PLAN = {"refs": [], "hebrew": ["מצות עשה של ואהבת לרעך כמוך"], "english": []}
SIDDUR_HIT = {
    "ref": "Siddur Sefard, Upon Arising, Upon Entering Synagogue 2",
    "exact": "הריני מקבל עלי מצות עשה של ואהבת לרעך כמוך",
}


def _siddur_searches(monkeypatch):
    monkeypatch.setattr(source_search.question_plan, "plan", lambda question: ARIZAL_PLAN)

    def run(queries):
        return [{**SIDDUR_HIT, "_paths": query[1]} for query in queries
                if isinstance(query, tuple) and query[1] == ("Liturgy", "Kabbalah")]

    monkeypatch.setattr(source_search, "_run_searches", run)


def test_the_siddur_is_searched_for_the_plan_phrases(monkeypatch):
    _siddur_searches(monkeypatch)
    assert SIDDUR_HIT["ref"] in source_search.find_sources(ARIZAL_QUESTION)["wider"]


def test_the_siddur_match_gets_a_place_of_its_own():
    assert source_search.WIDER_SLOTS == 3


def test_the_full_prompt_explains_a_kabbalah_someone_says():
    assert claude.KABBALOT_DIRECTIVE in claude.CORE_SYSTEM_PROMPT


def test_the_short_prompt_explains_a_kabbalah_someone_says():
    assert claude.KABBALOT_DIRECTIVE in claude.SIMPLE_SYSTEM_PROMPT


def test_the_prompts_name_the_arizals_acceptance():
    assert "ואהבת לרעך כמוך" in claude.KABBALOT_DIRECTIVE


def test_the_prompts_forbid_brushing_the_question_aside():
    assert "never answer that the sources do not say it" in claude.KABBALOT_DIRECTIVE


def test_the_planner_asks_for_the_words_of_a_declaration():
    assert "give the opening words of what is said" in question_plan._SYSTEM
