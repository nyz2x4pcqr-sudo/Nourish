// Themes: the app's colours worked out from a background colour and an accent, so every theme,
// curated or custom, gets matching surfaces, borders and text, and text always stays readable
// (contrast is checked with the WCAG formula and fixed when a custom colour would make it hard to
// read). Presets come first; custom colours are under Advanced.
(function (root) {
    'use strict';

    // === COLOUR MATHS ===
    function hexToRgb(hex) {
        let h = String(hex || '').trim().replace(/^#/, '');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        if (!/^[0-9a-f]{6}$/i.test(h)) return null;
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function rgbToHex(rgb) { return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
    function luminance(hex) {
        const rgb = hexToRgb(hex);
        if (!rgb) return 0;
        const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrast(a, b) {
        const la = luminance(a), lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    function mix(a, b, t) {
        const x = hexToRgb(a), y = hexToRgb(b);
        return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
    }
    function rgba(hex, alpha) { const c = hexToRgb(hex); return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`; }
    function toHsl(hex) {
        const [r, g, b] = hexToRgb(hex).map(v => v / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h /= 6;
        }
        return [h, s, l];
    }
    function fromHsl(h, s, l) {
        const f = n => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
        return rgbToHex([f(0), f(8), f(4)].map(v => v * 255));
    }
    function withLightness(hex, l) { const [h, s] = toHsl(hex); return fromHsl(h, s, Math.max(0, Math.min(1, l))); }
    // The text colour family for a background: same hue, little colour, very light or very dark.
    function inkFor(bg, mode) {
        const [h, s] = toHsl(bg);
        return mode === 'dark' ? fromHsl(h, Math.min(0.45, s * 0.6), 0.94) : fromHsl(h, Math.min(0.35, s * 0.5), 0.12);
    }
    // Moves `fg` towards the text end until it reads on `bg` at `ratio` (WCAG: 4.5 body, 3 large/secondary).
    function readable(fg, bg, ink, ratio) {
        let c = fg;
        for (let i = 0; i < 20 && contrast(c, bg) < ratio; i++) c = mix(c, ink, 0.15);
        return c;
    }

    // === PRESETS ===
    // Each: dark or light, its curated backgrounds (the first is the default), and hand-tuned colours
    // for that default where it has them (ember and paper are the original Nourish themes).
    const THEMES = {
        ember: { name: 'Ember', mode: 'dark', note: 'Warm dark (the original)', bgs: ['#0C0B0A', '#14110F', '#1A1512', '#0F0E0D'] },
        midnight: { name: 'Midnight', mode: 'dark', note: 'Deep blue', bgs: ['#0A0D14', '#0E1320', '#121A2B', '#070A10'] },
        forest: { name: 'Forest', mode: 'dark', note: 'Dark green', bgs: ['#0A110D', '#0E1712', '#132019', '#08100B'] },
        plum: { name: 'Plum', mode: 'dark', note: 'Dark violet', bgs: ['#120C16', '#180F1E', '#1F1426', '#0E0911'] },
        oled: { name: 'True black', mode: 'dark', note: 'Pure black, for OLED screens', bgs: ['#000000'] },
        paper: { name: 'Paper', mode: 'light', note: 'Warm light', bgs: ['#F5EFE6', '#FAF6F0', '#EFE6D8', '#F3EEE8'] },
        cloud: { name: 'Cloud', mode: 'light', note: 'Cool light', bgs: ['#F1F4F8', '#F7F8FA', '#E9EEF4', '#EEF3F1'] },
    };
    const BG_NAMES = ['Standard', 'Softer', 'Deeper', 'Muted'];
    const ACCENTS = {
        orange: { name: 'Saffron', accent: '#F4A13D', accent2: '#FFCB7A', deep: '#C9711B' },
        green: { name: 'Sage', accent: '#8CC084', accent2: '#BEE3A8', deep: '#4E8A4B' },
        blue: { name: 'Lagoon', accent: '#6FB7E6', accent2: '#A9D8F7', deep: '#2F7DB5' },
        purple: { name: 'Plum', accent: '#B69CF6', accent2: '#D7C8FF', deep: '#7A58C9' },
        pink: { name: 'Rose', accent: '#F08BA8', accent2: '#FFC0D1', deep: '#C24E72' },
        teal: { name: 'Mint', accent: '#5FD0B8', accent2: '#A6EEDD', deep: '#1F9682' },
    };
    const DEFAULTS = { theme: 'ember', bg: '', custom_bg: '', accent: 'orange', custom_accent: '', font_pair: 'editorial', text_size: 'default', bold_text: 'off', icon_style: 'outline', app_icon: 'default' };

    // Older settings: theme dark/light/system.
    function themeId(theme) { return { dark: 'ember', light: 'paper', system: 'auto' }[theme] || (THEMES[theme] || theme === 'auto' ? theme : 'ember'); }

    // The accent's three shades, from a preset or any colour.
    function accentOf(settings) {
        const s = settings || {};
        if (s.accent === 'custom' && hexToRgb(s.custom_accent)) {
            const a = rgbToHex(hexToRgb(s.custom_accent));
            const [, , l] = toHsl(a);
            return { accent: a, accent2: withLightness(a, Math.min(0.88, l + 0.18)), deep: withLightness(a, Math.max(0.2, l - 0.2)) };
        }
        return ACCENTS[s.accent] || ACCENTS.orange;
    }

    // Everything the stylesheet needs, from a background colour, dark or light, and the accent.
    // Returns { vars, mode, bg, notes } (notes: what was adjusted to keep text readable).
    function build(bgIn, modeIn, accent, { neutral = false } = {}) {
        const notes = [];
        let bg = hexToRgb(bgIn) ? rgbToHex(hexToRgb(bgIn)) : '#0C0B0A';
        const mode = modeIn || (luminance(bg) < 0.18 ? 'dark' : 'light');
        let ink = neutral ? (mode === 'dark' ? '#F2F2F2' : '#141414') : inkFor(bg, mode);
        // Text must read on the background: at least 7:1 for the main text.
        let tries = 0;
        // (on the cards too, which sit a little lighter than a dark background)
        const card = () => (mode === 'dark' ? mix(bg, ink, 0.13) : bg);
        while ((contrast(ink, bg) < 7 || contrast(ink, card()) < 7) && tries++ < 30) bg = withLightness(bg, toHsl(bg)[2] + (mode === 'dark' ? -0.03 : 0.03));
        if (tries) notes.push(`The background was made a little ${mode === 'dark' ? 'darker' : 'lighter'} so text stays easy to read.`);
        const v = {};
        if (mode === 'dark') {
            v['--surface'] = mix(bg, ink, 0.05);
            v['--surface-2'] = mix(bg, ink, 0.085);
            v['--surface-3'] = mix(bg, ink, 0.13);
            v['--surface-raised'] = mix(bg, ink, 0.065);
            v['--border'] = rgba(ink, 0.075); v['--border-strong'] = rgba(ink, 0.14); v['--hairline'] = rgba(ink, 0.06);
            v['--text'] = ink;
            v['--text-2'] = readable(mix(ink, bg, 0.3), v['--surface'], ink, 6);
            v['--text-3'] = readable(mix(ink, bg, 0.5), v['--surface-2'], ink, 3.6);
            v['--accent-text'] = readable(readable(accent.accent, v['--surface'], accent.accent2, 4.5), v['--surface'], ink, 4.5);
            v['--accent-soft'] = `color-mix(in srgb, ${accent.accent} 15%, transparent)`;
            v['--accent-softer'] = `color-mix(in srgb, ${accent.accent} 8%, transparent)`;
            v['--e-1'] = `0 1px 0 ${rgba(ink, 0.04)} inset, 0 1px 2px rgba(0, 0, 0, 0.4)`;
            v['--e-2'] = `0 1px 0 ${rgba(ink, 0.05)} inset, 0 12px 32px -10px rgba(0, 0, 0, 0.65)`;
            v['--e-3'] = `0 1px 0 ${rgba(ink, 0.06)} inset, 0 28px 60px -18px rgba(0, 0, 0, 0.8)`;
            v['--glass'] = rgba(mix(bg, ink, 0.06), 0.72); v['--glass-strong'] = rgba(mix(bg, ink, 0.06), 0.88);
            v['--scrim'] = rgba(mix(bg, '#000000', 0.6), 0.62);
            v['--protein'] = '#86CFA6'; v['--carbs'] = '#F2C46D'; v['--fat'] = '#EC8F7E';
            v['--grain-opacity'] = luminance(bg) < 0.002 ? '0' : '0.045';
        } else {
            v['--surface'] = mix(bg, '#FFFFFF', 0.7);
            v['--surface-2'] = mix(bg, ink, 0.012);
            v['--surface-3'] = mix(bg, ink, 0.065);
            v['--surface-raised'] = '#FFFFFF';
            v['--border'] = rgba(ink, 0.09); v['--border-strong'] = rgba(ink, 0.16); v['--hairline'] = rgba(ink, 0.07);
            v['--text'] = ink;
            v['--text-2'] = readable(mix(ink, bg, 0.32), v['--surface-2'], ink, 6);
            v['--text-3'] = readable(mix(ink, bg, 0.48), v['--surface-2'], ink, 3.4);
            v['--accent-text'] = readable(accent.deep, v['--surface'], ink, 4.5);
            v['--accent-soft'] = `color-mix(in srgb, ${accent.accent} 22%, transparent)`;
            v['--accent-softer'] = `color-mix(in srgb, ${accent.accent} 11%, transparent)`;
            const shade = mix(ink, '#3C2814', 0.5);
            v['--e-1'] = `0 1px 2px ${rgba(shade, 0.06)}`;
            v['--e-2'] = `0 1px 2px ${rgba(shade, 0.05)}, 0 14px 30px -12px ${rgba(shade, 0.18)}`;
            v['--e-3'] = `0 2px 4px ${rgba(shade, 0.05)}, 0 30px 60px -20px ${rgba(shade, 0.3)}`;
            v['--glass'] = rgba(mix(bg, '#FFFFFF', 0.7), 0.74); v['--glass-strong'] = rgba(mix(bg, '#FFFFFF', 0.7), 0.9);
            v['--scrim'] = rgba(mix(ink, bg, 0.2), 0.38);
            v['--protein'] = '#4E9E73'; v['--carbs'] = '#D49A2A'; v['--fat'] = '#D0644F';
            v['--grain-opacity'] = '0.035';
        }
        v['--bg'] = bg;
        v['--accent'] = accent.accent; v['--accent-2'] = accent.accent2; v['--accent-deep'] = accent.deep;
        v['--on-accent'] = contrast('#1B1107', accent.accent) >= contrast('#FFFFFF', accent.accent) ? '#1B1107' : '#FFFFFF';
        if (contrast(v['--on-accent'], accent.accent) < 3) notes.push('That accent colour is hard to read text on; buttons may look faint.');
        return { vars: v, mode, bg, notes };
    }

    // The look for the person's settings. prefersLight: the phone is in light mode (for Auto).
    function resolve(settings, prefersLight) {
        const s = Object.assign({}, DEFAULTS, settings || {});
        let id = themeId(s.theme);
        if (id === 'auto') id = prefersLight ? 'paper' : 'ember';
        const t = THEMES[id];
        const custom = hexToRgb(s.custom_bg) ? s.custom_bg : '';
        const bg = custom || (t.bgs.indexOf(s.bg) >= 0 ? s.bg : t.bgs[0]);
        const out = build(bg, custom ? null : t.mode, accentOf(s), { neutral: id === 'oled' });
        out.theme = id;
        // The original themes keep their hand-tuned values at their own background.
        if (!custom && bg === t.bgs[0] && (id === 'ember' || id === 'paper')) Object.assign(out.vars, ORIGINAL[id]);
        return out;
    }
    const ORIGINAL = {
        ember: { '--surface': '#161412', '--surface-2': '#1F1C19', '--surface-3': '#2A2622', '--surface-raised': '#1B1916', '--text': '#F6EFE6', '--text-2': '#BEB2A5', '--text-3': '#847A6F' },
        paper: { '--surface': '#FFFCF7', '--surface-2': '#F3ECE1', '--surface-3': '#E7DECF', '--surface-raised': '#FFFFFF', '--text': '#1F1913', '--text-2': '#5E5348', '--text-3': '#92867A' },
    };

    // === FONTS, SIZES, ICONS ===
    const FONTS = {
        editorial: { name: 'Editorial', note: 'Serif headings, friendly text', heading: 'Fraunces', body: 'Figtree' },
        modern: { name: 'Modern', note: 'Clean and sharp', heading: 'Inter', body: 'Inter' },
        classic: { name: 'Classic', note: 'Book-style serif', heading: 'Source Serif 4', body: 'Source Sans 3' },
        rounded: { name: 'Rounded', note: 'Soft and friendly', heading: 'Nunito', body: 'Nunito' },
        minimal: { name: 'Minimal', note: 'Light and airy', heading: 'Manrope', body: 'Manrope' },
    };
    const TEXT_SIZES = { small: 'Small', default: 'Default', large: 'Large', xl: 'Extra large' };
    const ICON_STYLES = { outline: 'Outline', bold: 'Bold', light: 'Light', duotone: 'Filled', sharp: 'Sharp' };
    // Home screen icons (the phone apps can switch between these).
    const APP_ICONS = {
        default: { name: 'Saffron', bg: '#0C0B0A', accent: '#F4A13D' },
        midnight: { name: 'Midnight', bg: '#0A0D14', accent: '#6FB7E6' },
        forest: { name: 'Forest', bg: '#0A110D', accent: '#8CC084' },
        plum: { name: 'Plum', bg: '#120C16', accent: '#B69CF6' },
        paper: { name: 'Paper', bg: '#F5EFE6', accent: '#C9711B' },
        oled: { name: 'Black', bg: '#000000', accent: '#F4A13D' },
    };

    // Paint the saved look straight away (before the app starts), so a light or custom theme doesn't
    // flash dark first. app.js applies it properly once settings are loaded.
    if (typeof document !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            const saved = {};
            ['theme', 'bg', 'custom_bg', 'accent', 'custom_accent', 'font_pair', 'text_size', 'bold_text', 'icon_style'].forEach(k => { const v = localStorage.getItem(k); if (v != null) saved[k] = v; });
            const look = resolve(saved, !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches));
            const el = document.documentElement;
            Object.keys(look.vars).forEach(k => el.style.setProperty(k, look.vars[k]));
            el.setAttribute('data-theme', look.mode);
            if (FONTS[saved.font_pair]) el.setAttribute('data-font', saved.font_pair);
            if (TEXT_SIZES[saved.text_size]) el.setAttribute('data-text', saved.text_size);
            if (ICON_STYLES[saved.icon_style]) el.setAttribute('data-icons', saved.icon_style);
            if (saved.bold_text === 'on') el.setAttribute('data-bold', 'on');
        } catch (e) { /* storage unavailable: app.js applies the look */ }
    }

    const api = { THEMES, BG_NAMES, ACCENTS, FONTS, TEXT_SIZES, ICON_STYLES, APP_ICONS, DEFAULTS, resolve, build, accentOf, themeId, contrast, luminance, mix, hexToRgb, rgbToHex };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.NourishTheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
