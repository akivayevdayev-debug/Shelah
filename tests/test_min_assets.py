"""static/min/ (scripts/build_assets.mjs, scripts/build_critical_css.mjs): the
committed minified stylesheet bundle, classic scripts, module bundles and
critical CSS, and the shell that serves them.

backend/module_versions.py serves static/min/ only while its manifest describes
the files on disk, so a stale build is a slower page, never a wrong one. These
tests are what keep that from going unnoticed: they fail when a stylesheet or
script was edited without ``npm run build:assets`` (and ``build:critical``)."""

import hashlib
import json
import re
from pathlib import Path

import pytest

from backend import module_versions

REPO_ROOT = Path(__file__).resolve().parent.parent
STATIC = REPO_ROOT / "static"
MIN = STATIC / "min"
MANIFEST = json.loads((MIN / "manifest.json").read_text(encoding="utf-8"))


def _sha(path):
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def _css_order():
    """CSS_ORDER from scripts/build_assets.mjs, the cascade order of the bundle."""
    source = (REPO_ROOT / "scripts" / "build_assets.mjs").read_text(encoding="utf-8")
    block = re.search(r"export const CSS_ORDER = \[(.*?)\];", source, re.S).group(1)
    return re.findall(r'"([^"]+)"', block)


@pytest.fixture
def min_assets(monkeypatch):
    monkeypatch.delenv("SHELAH_SOURCE_ASSETS", raising=False)


class TestBuildIsCurrent:
    """Run ``npm run build:assets`` (then ``npm run build:critical`` when a
    stylesheet or the markup changed) if one of these fails."""

    def test_every_stylesheet_matches_the_bundle(self):
        stale = [rel for rel, sha in MANIFEST["css"]["sources"].items() if _sha(STATIC / rel) != sha]
        assert stale == [], f"edited since the last build: {stale}; run npm run build:assets"

    def test_every_script_matches_its_minified_copy(self):
        js = MANIFEST["js"]
        stale = [name for name, entry in js["classic"].items() if _sha(STATIC / "js" / name) != entry["source"]]
        stale += [name for name, sha in js["modules"]["sources"].items() if _sha(STATIC / "js" / name) != sha]
        assert stale == [], f"edited since the last build: {stale}; run npm run build:assets"

    def test_no_script_is_missing_from_the_build(self):
        js = MANIFEST["js"]
        built = set(js["classic"]) | set(js["modules"]["sources"])
        on_disk = {p.name for p in (STATIC / "js").glob("*.js") if re.fullmatch(r"[\w.-]+\.js", p.name)}
        assert on_disk == built, "a script was added or removed; run npm run build:assets"

    def test_every_output_file_is_committed(self):
        js = MANIFEST["js"]
        expected = [MANIFEST["css"]["bundle"], *js["modules"]["outputs"], *(f"js/{n}" for n in js["classic"])]
        expected += [entry["file"] for entry in MANIFEST["css"]["critical"].values()]
        assert [rel for rel in expected if not (MIN / rel).is_file()] == []

    def test_the_critical_css_was_extracted_from_these_stylesheets(self):
        sources = {rel: sha.removeprefix("sha256:") for rel, sha in MANIFEST["css"]["sources"].items()}
        digest = hashlib.sha256(json.dumps(sources, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        assert digest == MANIFEST["css"]["sourcesHash"]
        for kind, entry in MANIFEST["css"]["critical"].items():
            assert entry["sourcesHash"] == digest, f"critical CSS '{kind}' is stale; run npm run build:critical"

    def test_the_manifest_reads_as_fresh(self, min_assets):
        manifest = module_versions._manifest()
        assert manifest
        assert module_versions._css_fresh(manifest)
        assert module_versions._modules_fresh(manifest)
        for name in manifest["js"]["classic"]:
            assert module_versions._classic_fresh(manifest, name), name


class TestFallbackLinks:
    def test_the_template_links_the_originals_in_the_bundles_order(self):
        template = (REPO_ROOT / "templates" / "index.html").read_text(encoding="utf-8")
        fallback = template.split("{% else %}", 2)[-1]  # the branch used when no bundle is current
        linked = re.findall(r"""<link rel="stylesheet" href="\{\{ asset_url\('([^']+)'\) \}\}">""", fallback)
        assert linked == _css_order()

    def test_every_listed_stylesheet_exists(self):
        assert [rel for rel in _css_order() if not (STATIC / rel).is_file()] == []


class TestShellInMinMode:
    def test_the_home_page_inlines_its_critical_css_and_loads_the_bundle_async(self, test_client, min_assets):
        html = test_client.get("/").get_data(as_text=True)
        assert "<style>" in html
        bundle = re.search(r'<link rel="stylesheet" href="(/static/min/css/app\.css\?v=[0-9a-f]{12})" media="print" data-async-css data-css-gate>', html)
        assert bundle, "the async bundle link is missing"
        assert f'<noscript><link rel="stylesheet" href="{bundle.group(1)}"></noscript>' in html
        # None of the originals is linked as well.
        assert not re.search(r'href="/static/(?:css/|style\.css)', html)

    def test_scripts_are_the_minified_copies(self, test_client, min_assets):
        html = test_client.get("/").get_data(as_text=True)
        for name in ("shell.js", "actions.js", "load-region.js"):
            assert re.search(rf'src="/static/min/js/{re.escape(name)}\?v=[0-9a-f]{{12}}"', html), name
        assert re.search(r'<script type="module" src="/static/min/js/main\.js\?v=[0-9a-f]{12}"', html)
        # The bundled entries import their chunks by hashed file name: nothing to map.
        assert re.search(r'<script type="importmap">\{"imports": ?\{\}\}</script>', html)

    @pytest.mark.parametrize(
        ("path", "kind"),
        [
            ("/", "home"),
            ("/?lang=he", "home"),
            ("/?utm_source=x&fbclid=y", "home"),
            ("/settings", "home"),
            ("/profile", "home"),
            ("/text/Genesis.1", "text"),
            ("/prayer/shacharit", "app"),
            ("/community/Ashkenaz", "app"),
            ("/history", "app"),
            ("/chat/new", "app"),
            ("/?history=1", "app"),
        ],
    )
    def test_each_page_gets_the_critical_css_of_its_own_first_paint(self, test_client, min_assets, path, kind):
        html = test_client.get(path).get_data(as_text=True)

        def critical(name):
            return f"<style>{(MIN / MANIFEST['css']['critical'][name]['file']).read_text(encoding='utf-8')}</style>"

        assert critical(kind) in html
        assert [other for other in MANIFEST["css"]["critical"] if other != kind and critical(other) in html] == []

    def test_an_edited_stylesheet_puts_the_originals_back(self, test_client, min_assets, monkeypatch):
        real_sha = module_versions._source_sha
        monkeypatch.setattr(
            module_versions, "_source_sha", lambda path: "edited" if path.name == "reader.css" else real_sha(path)
        )
        html = test_client.get("/").get_data(as_text=True)
        assert not re.search(r"<link [^>]*data-css-gate", html)
        assert "/static/css/reader.css?v=" in html
        assert "/static/min/css/app.css" not in html

    def test_an_edited_script_serves_that_script_unminified(self, min_assets, monkeypatch):
        real_sha = module_versions._source_sha
        monkeypatch.setattr(
            module_versions, "_source_sha", lambda path: "edited" if path.name == "actions.js" else real_sha(path)
        )
        assert module_versions.asset_url("js/actions.js").startswith("/static/js/actions.js?v=")
        assert module_versions.asset_url("js/shell.js").startswith("/static/min/js/shell.js?v=")

    def test_an_edited_module_puts_the_whole_module_graph_back(self, min_assets, monkeypatch):
        real_sha = module_versions._source_sha
        monkeypatch.setattr(
            module_versions, "_source_sha", lambda path: "edited" if path.name == "router.js" else real_sha(path)
        )
        assert module_versions.module_url("main.js").startswith("/static/js/main.js?v=")
        assert "/static/js/router.js" in module_versions.import_map()["imports"]


class TestLazyThirdPartyLibraries:
    """FullCalendar, Motion and Clerk are fetched by window.ShelahLibs when
    something asks for them, not by <script> tags in the page. The loader keeps
    every SRI hash the tags had, and (like any inline script) is hashed into the
    page's CSP by tests/test_csp.py."""

    LIBRARIES = {
        "temporal": "temporal-polyfill@1.0.6/global.js",
        "fullcalendarcore": "fullcalendar@7.1.3/all/global.js",
        "fullcalendar": "fullcalendar@7.1.3/themes/classic/global.js",
        "motion": "motion@14.6.0/dist/motion.js",
    }
    # An entry may name the entries it waits for, and stylesheets of its own.
    ENTRY_HEAD = r"(?:deps:\[[^\]]*\],)?(?:css:\[\[.*?\]\],)?"

    @staticmethod
    def _loader(html):
        loader = re.search(r"<script>\(function\(w,d\)\{var L=\{.*?\}\)\(window,document\)</script>", html, re.S)
        assert loader, "the window.ShelahLibs loader is missing"
        return loader.group(0)

    @pytest.mark.parametrize("path", ["/", "/text/Genesis.1", "/prayer/shacharit"])
    def test_no_page_loads_them_with_a_script_tag(self, test_client, path):
        html = test_client.get(path).get_data(as_text=True)
        assert not re.search(r"<script[^>]+src=[^>]*(?:fullcalendar|motion@|clerk-js)", html)

    @pytest.mark.parametrize("name", sorted(LIBRARIES))
    def test_the_loader_pins_each_library_with_an_sri_hash(self, test_client, name):
        loader = self._loader(test_client.get("/").get_data(as_text=True))
        entry = re.search(rf"\b{name}:\{{{self.ENTRY_HEAD}src:\"([^\"]+)\",integrity:\"(sha384-[A-Za-z0-9+/=]+)\"", loader)
        assert entry, f"{name} is not described by the loader"
        assert entry.group(1) == f"https://cdn.jsdelivr.net/npm/{self.LIBRARIES[name]}"

    def test_the_calendar_theme_stylesheets_are_pinned_with_an_sri_hash(self, test_client):
        loader = self._loader(test_client.get("/").get_data(as_text=True))
        css = re.search(r"\bfullcalendar:\{deps:\[\"fullcalendarcore\"\],css:\[(\[.*?\])\],src:", loader)
        assert css, "the calendar theme stylesheets are not described by the loader"
        sheets = re.findall(r"\[\"(https://[^\"]+)\",\"sha384-[A-Za-z0-9+/=]+\"\]", css.group(1))
        assert [s.rsplit("@7.1.3/", 1)[-1] for s in sheets] == [
            "skeleton.css",
            "themes/classic/theme.css",
            "themes/classic/palette.css",
        ]

    def test_clerk_is_described_only_when_the_site_has_a_publishable_key(self, test_client, monkeypatch):
        import app as app_module

        monkeypatch.setattr(app_module, "CLERK_PUBLISHABLE_KEY", "")
        loader = self._loader(test_client.get("/").get_data(as_text=True))
        assert "clerk:" not in loader
        assert "clerkui:" not in loader

        monkeypatch.setattr(app_module, "CLERK_PUBLISHABLE_KEY", "pk_test_example")
        loader = self._loader(test_client.get("/").get_data(as_text=True))
        entry = re.search(r"\bclerk:\{deps:\[\"clerkui\"\],src:\"([^\"]+)\",integrity:\"sha384-[A-Za-z0-9+/=]+\",attrs:\{\"data-clerk-publishable-key\":\"(pk_test_[^\"]+)\"\}", loader)
        assert entry, "clerk is not described by the loader"
        assert entry.group(1).startswith("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@")
        assert entry.group(2) == "pk_test_example"
        ui = re.search(r"\bclerkui:\{src:\"([^\"]+)\",integrity:\"sha384-[A-Za-z0-9+/=]+\"", loader)
        assert ui, "@clerk/ui is not described by the loader"
        assert ui.group(1).startswith("https://cdn.jsdelivr.net/npm/@clerk/ui@")


class TestServedFiles:
    def test_a_chunk_is_cached_for_a_year(self, test_client):
        chunk = next((MIN / "js" / "chunks").glob("chunk-*.js"))
        response = test_client.get(f"/static/min/js/chunks/{chunk.name}")
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"
        response.close()

    def test_the_hashed_bundle_url_is_cached_for_a_year(self, test_client, min_assets):
        url = module_versions.page_css("home")["bundle"]
        assert module_versions.is_content_hash(url.split("v=")[1])
        response = test_client.get(url)
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"
        response.close()

    def test_every_chunk_an_entry_imports_is_there(self):
        for out in MANIFEST["js"]["modules"]["outputs"]:
            text = (MIN / out).read_text(encoding="utf-8")
            for ref in re.findall(r'from"\./(chunks/[\w.-]+\.js)"|import\("\./(chunks/[\w.-]+\.js)"\)', text):
                name = next(r for r in ref if r)
                assert (MIN / "js" / name).is_file(), f"{out} imports a missing {name}"


class TestPageCssAgainstSyntheticStatic:
    """page_css and the freshness checks, on a throwaway static/ directory."""

    @pytest.fixture
    def fake_static(self, tmp_path, monkeypatch):
        monkeypatch.delenv("SHELAH_SOURCE_ASSETS", raising=False)
        static = tmp_path / "static"
        (static / "css").mkdir(parents=True)
        (static / "js").mkdir()
        (static / "min" / "css").mkdir(parents=True)
        (static / "min" / "js").mkdir()
        (static / "css" / "a.css").write_text("a{color:red}")
        (static / "js" / "tool.js").write_text("window.tool = 1;\n")
        (static / "js" / "main.js").write_text("export const x = 1;\n")
        (static / "min" / "css" / "app.css").write_text("a{color:red}")
        (static / "min" / "css" / "critical-home.css").write_text("a{color:red}")
        (static / "min" / "js" / "tool.js").write_text("window.tool=1;")
        (static / "min" / "js" / "main.js").write_text("export const x=1;")
        sources = {"css/a.css": "sha256:" + hashlib.sha256(b"a{color:red}").hexdigest()}
        sources_hash = "f" * 64
        manifest = {
            "version": 1,
            "css": {
                "sources": sources,
                "sourcesHash": sources_hash,
                "bundle": "css/app.css",
                "critical": {"home": {"file": "css/critical-home.css", "sourcesHash": sources_hash}},
            },
            "js": {
                "classic": {"tool.js": {"source": "sha256:" + hashlib.sha256(b"window.tool = 1;\n").hexdigest()}},
                "modules": {
                    "entries": {"main.js": "js/main.js"},
                    "sources": {"main.js": "sha256:" + hashlib.sha256(b"export const x = 1;\n").hexdigest()},
                    "outputs": {"js/main.js": "x"},
                },
            },
        }
        (static / "min" / "manifest.json").write_text(json.dumps(manifest))
        monkeypatch.setattr(module_versions, "STATIC_DIR", static)
        monkeypatch.setattr(module_versions, "JS_DIR", static / "js")
        for cached in (module_versions._digest, module_versions._file_digest, module_versions._full_sha):
            cached.cache_clear()
        module_versions._read_manifest.cache_clear()
        yield static
        for cached in (module_versions._digest, module_versions._file_digest, module_versions._full_sha):
            cached.cache_clear()
        module_versions._read_manifest.cache_clear()

    def test_a_current_build_is_served(self, fake_static):
        css = module_versions.page_css("home")
        assert css["critical"] == "min/css/critical-home.css"
        assert css["bundle"].startswith("/static/min/css/app.css?v=")
        assert module_versions.asset_url("js/tool.js").startswith("/static/min/js/tool.js?v=")
        assert module_versions.module_url("main.js").startswith("/static/min/js/main.js?v=")
        assert module_versions.import_map() == {"imports": {}}

    def test_a_kind_without_critical_css_links_the_bundle_alone(self, fake_static):
        css = module_versions.page_css("text")
        assert css["critical"] is None
        assert css["bundle"].startswith("/static/min/css/app.css?v=")

    def test_critical_css_extracted_from_other_stylesheets_is_not_used(self, fake_static):
        manifest = json.loads((fake_static / "min" / "manifest.json").read_text())
        manifest["css"]["critical"]["home"]["sourcesHash"] = "0" * 64
        (fake_static / "min" / "manifest.json").write_text(json.dumps(manifest))
        module_versions._read_manifest.cache_clear()
        assert module_versions.page_css("home")["critical"] is None

    def test_an_edited_stylesheet_means_no_bundle(self, fake_static):
        (fake_static / "css" / "a.css").write_text("a{color:blue}")
        assert module_versions.page_css("home") is None

    def test_a_missing_output_file_means_no_bundle(self, fake_static):
        (fake_static / "min" / "css" / "app.css").unlink()
        assert module_versions.page_css("home") is None

    def test_an_edited_classic_script_is_served_as_the_original(self, fake_static):
        (fake_static / "js" / "tool.js").write_text("window.tool = 2;\n")
        assert module_versions.asset_url("js/tool.js").startswith("/static/js/tool.js?v=")

    def test_an_edited_module_serves_the_originals(self, fake_static):
        (fake_static / "js" / "main.js").write_text("export const x = 2;\n")
        assert module_versions.module_url("main.js").startswith("/static/js/main.js?v=")
        assert list(module_versions.import_map()["imports"]) == ["/static/js/main.js"]

    def test_the_originals_can_be_forced(self, fake_static, monkeypatch):
        monkeypatch.setenv("SHELAH_SOURCE_ASSETS", "1")
        assert module_versions.page_css("home") is None
        assert module_versions.asset_url("js/tool.js").startswith("/static/js/tool.js?v=")

    def test_a_missing_or_foreign_manifest_is_ignored(self, fake_static):
        (fake_static / "min" / "manifest.json").write_text('{"version": 2}')
        module_versions._read_manifest.cache_clear()
        assert module_versions.page_css("home") is None
        (fake_static / "min" / "manifest.json").unlink()
        assert module_versions.page_css("home") is None
        assert module_versions.asset_url("js/tool.js").startswith("/static/js/tool.js?v=")


class TestInlineAsset:
    def test_a_style_is_inlined_as_text(self, tmp_path, monkeypatch):
        (tmp_path / "css").mkdir()
        (tmp_path / "css" / "c.css").write_text("a{color:red}")
        monkeypatch.setattr(module_versions, "STATIC_DIR", tmp_path)
        assert str(module_versions.inline_asset("css/c.css", "style")) == "a{color:red}"

    def test_a_style_that_would_end_its_own_element_is_refused(self, tmp_path, monkeypatch):
        (tmp_path / "css").mkdir()
        (tmp_path / "css" / "c.css").write_text("/* </style> */ a{}")
        monkeypatch.setattr(module_versions, "STATIC_DIR", tmp_path)
        with pytest.raises(ValueError, match="cannot be inlined"):
            module_versions.inline_asset("css/c.css", "style")

    def test_a_script_is_not_checked_against_the_style_terminator(self, tmp_path, monkeypatch):
        (tmp_path / "js").mkdir()
        (tmp_path / "js" / "s.js").write_text("var s = '</style>';")
        monkeypatch.setattr(module_versions, "STATIC_DIR", tmp_path)
        assert "</style>" in str(module_versions.inline_asset("js/s.js"))
