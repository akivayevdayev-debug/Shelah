/**
 * clerk-appearance.js — one Clerk `appearance` for the whole site.
 *
 * Clerk's sign-in and account modals render in this document, but they are themed
 * through JS, not CSS: `variables` want concrete colours, not `var(--token)`.  So this
 * reads the live design tokens (tokens.css) for the active theme and hands Clerk a
 * matching set.  Two colours carry the brand — a MAIN (the blue) and an ACCENT (the
 * gold) — on top of the site's surface and ink tokens.
 *
 *   light   main #1f3f63 (label #ffffff, 10.77:1)      accent #7a5c0c (5.34:1 on the footer pill)
 *   dark    main #6888a8 (label #0c0c0b,  5.29:1)      accent #c9ac5e (7.66:1 on the card)
 *
 * The tokens are read at call time, so call `ShelahClerkAppearance()` when opening a
 * modal (not once at load) and a theme switch is picked up.  The literals below are only
 * fallbacks for a token that is missing or not a plain #rrggbb.
 *
 * Public API: window.ShelahClerkAppearance() -> appearance object for Clerk.
 */
(function () {
    'use strict';

    const HEX = /^#[0-9a-f]{6}$/i;

    function token(name, fallback) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return HEX.test(value) ? value : fallback;
    }

    function isDark() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function build() {
        const dark = isDark();

        const main = token('--accent-primary', dark ? '#6888a8' : '#1f3f63');
        // The dark main is a mid-tone: the site's light label (#f0ebe3) is only 3.12:1 on
        // it, so dark uses the near-black page colour for the label (5.29:1).
        const onMain = dark ? token('--surface-0', '#0c0c0b') : token('--ink-on-accent', '#ffffff');
        // --accent-gold is decorative-only on cream (1.97:1), so light mode uses a deeper
        // gold that is safe for text and focus rings (5.34:1 on the footer pill, 5.97:1 on
        // the card); dark mode uses the token as is.
        const accent = dark ? token('--accent-gold', '#c9ac5e') : '#7a5c0c';

        const card = token('--surface-2', dark ? '#1e1d1a' : '#fff9f1');
        const page = token('--surface-0', dark ? '#0c0c0b' : '#faf7f0');
        const pill = token('--surface-pill', dark ? '#23211f' : '#f1ede4');
        const edge = token('--surface-border', dark ? '#2e2c2a' : '#d7cebc');
        const ink = token('--ink-primary', dark ? '#c0bab0' : '#334155');
        const heading = token('--ink-heading', dark ? '#d4cec4' : '#002147');
        const muted = token('--ink-secondary', dark ? '#999188' : '#5a6b85');
        const danger = token('--accent-red', dark ? '#f26b6b' : '#be123c');       // 5.69 / 6.01 on the card
        const success = dark ? token('--accent-green', '#2aaa7a') : '#047857';    // 5.72 / 5.24 on the card

        const sans = "'Inter', system-ui, sans-serif";
        const serif = "'Cardo', 'Cardo Fallback', Georgia, serif";
        const radius = '12px';       // --radius-control
        const cardRadius = '20px';   // --radius-sheet
        const control = { minHeight: '44px', borderRadius: radius };

        return {
            variables: {
                colorPrimary: main,
                colorPrimaryForeground: onMain,
                colorTextOnPrimaryBackground: onMain,
                colorBackground: card,
                colorInput: page,
                colorInputForeground: ink,
                colorInputText: ink,
                colorText: ink,
                colorTextSecondary: muted,
                colorNeutral: ink,
                colorMuted: pill,
                colorMutedForeground: muted,
                colorRing: accent,
                colorDanger: danger,
                colorSuccess: success,
                colorShadow: dark ? '#000000' : main,
                // Clerk 6 paints this as given (5.x dropped it to 73% itself), so the
                // alpha is spelled out to keep the page dimmed, not blacked out.
                colorModalBackdrop: 'rgba(0, 0, 0, 0.73)',
                fontFamily: sans,
                fontFamilyButtons: sans,
                borderRadius: radius,
            },
            elements: {
                // The box draws the one outline and clips; the card fills it exactly.
                // (Clerk pulls the card 1px outward to overlap its own hairline, which
                // left our bordered card wider than the box, cut at the edges, and its
                // rounded bottom sitting on the square footer.)
                cardBox: { borderRadius: cardRadius, border: `1px solid ${edge}` },
                card: {
                    borderRadius: 0,
                    margin: 0,
                    width: '100%',
                    boxShadow: 'none',
                    borderBottom: `1px solid ${edge}`,
                    // Clerk's 32px/40px padding leaves ~210px of content on a phone.
                    '@media (max-width: 480px)': { padding: '24px 20px', gap: '24px' },
                },
                formFieldLabelRow: { gap: '8px' },
                formFieldLabel: { textAlign: 'start' },
                formFieldAction: { whiteSpace: 'nowrap' },
                headerTitle: {
                    fontFamily: serif,
                    fontWeight: 700,
                    letterSpacing: '-0.015em',
                    color: heading,
                },
                headerSubtitle: { color: muted },
                formButtonPrimary: { ...control, fontWeight: 600, textTransform: 'none', boxShadow: 'none' },
                socialButtonsBlockButton: control,
                // Clerk draws this label at ink with a 62% alpha (3.46:1 light, 4.17:1 dark);
                // a solid muted colour clears 4.5:1 on the card in both themes.
                socialButtonsBlockButtonText: { color: muted },
                // The "Last used" badge (Clerk key lastAuthenticationStrategyBadge): axe saw it
                // as muted text on an orange fill (1.8:1 light, 1.0:1 dark). Use the neutral
                // chip pair instead: ink on the pill (8.86:1 light, 8.32:1 dark).
                lastAuthenticationStrategyBadge: { backgroundColor: pill, color: ink, border: `1px solid ${edge}` },
                formFieldInput: control,
                footerActionLink: { color: accent, fontWeight: 600 },
            },
        };
    }

    window.ShelahClerkAppearance = build;
})();
