/*!
 * Pivot Health – cookie consent manager (DPDP Act 2023 aligned)
 *
 * - Nothing non-essential runs until the visitor actively opts in.
 * - "Accept all" and "Reject non-essential" are equally prominent.
 * - Consent is granular (analytics / marketing), can be changed or withdrawn
 *   at any time via any element with [data-cookie-settings] (footer link).
 *
 * HOW TO ADD A TRACKER (e.g. Google Analytics, Meta Pixel) SAFELY:
 *   Mark the script as inert and tag its category; it will only be executed
 *   after the visitor consents to that category:
 *
 *     <script type="text/plain" data-cookie-category="analytics"
 *             data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
 *     <script type="text/plain" data-cookie-category="analytics">
 *         window.dataLayer = window.dataLayer || [];
 *         function gtag(){dataLayer.push(arguments);}
 *         gtag('js', new Date()); gtag('config', 'G-XXXX');
 *     </script>
 *
 *   Categories: "analytics" | "marketing".
 *   Other code can listen for:  document.addEventListener('pivot:consent', e => e.detail)
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'pivot_cookie_consent';
    // Bump this when the cookie/privacy policy changes materially to re-ask everyone.
    var CONSENT_VERSION = '2026-11';
    var MAX_AGE_DAYS = 180; // re-confirm consent every ~6 months

    var root = (function () {
        var s = document.currentScript;
        if (s && s.getAttribute('src')) {
            return s.getAttribute('src').replace(/assets\/compliance\.js.*$/, '');
        }
        return '/';
    })();
    var policyUrl = root + 'privacy-policy#cookies';

    function readConsent() {
        try {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var c = JSON.parse(raw);
            if (!c || c.version !== CONSENT_VERSION) return null;
            if (Date.now() - c.timestamp > MAX_AGE_DAYS * 864e5) return null;
            return c;
        } catch (e) {
            return null;
        }
    }

    function saveConsent(analytics, marketing) {
        var c = {
            version: CONSENT_VERSION,
            necessary: true,
            analytics: !!analytics,
            marketing: !!marketing,
            timestamp: Date.now()
        };
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch (e) { /* storage blocked */ }
        return c;
    }

    // Execute any deferred scripts whose category is now allowed.
    function activateScripts(consent) {
        var nodes = document.querySelectorAll('script[type="text/plain"][data-cookie-category]');
        Array.prototype.forEach.call(nodes, function (old) {
            var cat = old.getAttribute('data-cookie-category');
            if (!consent[cat] || old.getAttribute('data-activated')) return;
            var s = document.createElement('script');
            Array.prototype.forEach.call(old.attributes, function (a) {
                if (a.name !== 'type' && a.name !== 'data-src') s.setAttribute(a.name, a.value);
            });
            if (old.getAttribute('data-src')) s.src = old.getAttribute('data-src');
            else s.text = old.text;
            old.setAttribute('data-activated', '1');
            old.parentNode.insertBefore(s, old.nextSibling);
        });
    }

    function applyConsent(consent) {
        // Google Consent Mode v2 – harmless no-op if gtag is not present.
        if (typeof window.gtag === 'function') {
            window.gtag('consent', 'update', {
                analytics_storage: consent.analytics ? 'granted' : 'denied',
                ad_storage: consent.marketing ? 'granted' : 'denied',
                ad_user_data: consent.marketing ? 'granted' : 'denied',
                ad_personalization: consent.marketing ? 'granted' : 'denied'
            });
        }
        activateScripts(consent);
        try {
            document.dispatchEvent(new CustomEvent('pivot:consent', { detail: consent }));
        } catch (e) { /* old browsers */ }
    }

    var banner, prefs, analyticsBox, marketingBox, lastFocus;

    function buildBanner() {
        banner = document.createElement('div');
        banner.className = 'pv-cookie';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-live', 'polite');
        banner.setAttribute('aria-labelledby', 'pv-cookie-title');
        banner.hidden = true;
        banner.innerHTML =
            '<h2 id="pv-cookie-title">Your privacy choices</h2>' +
            '<p>We use strictly necessary cookies to make this website work. With your consent, we would also like to ' +
            'use analytics cookies to understand how the site is used and marketing cookies to measure our ' +
            'advertising. Non-essential cookies stay off unless you turn them on. You can change your choice at any ' +
            'time from &ldquo;Cookie Settings&rdquo; in the footer. See our <a href="' + policyUrl + '">Privacy &amp; Cookie Policy</a>.</p>' +
            '<div class="pv-cookie-prefs" hidden>' +
            '  <div class="pv-cookie-row"><div><strong>Strictly necessary</strong><span>Required for security and basic site functions, including remembering this choice. Always on.</span></div>' +
            '    <input type="checkbox" checked disabled aria-label="Strictly necessary cookies (always on)"></div>' +
            '  <div class="pv-cookie-row"><label for="pv-ck-analytics"><strong>Analytics</strong><span>Helps us understand visits and improve content (e.g. Google Analytics).</span></label>' +
            '    <input type="checkbox" id="pv-ck-analytics"></div>' +
            '  <div class="pv-cookie-row"><label for="pv-ck-marketing"><strong>Marketing</strong><span>Measures ads and shows relevant ads on other platforms (e.g. Meta Pixel, Google Ads).</span></label>' +
            '    <input type="checkbox" id="pv-ck-marketing"></div>' +
            '</div>' +
            '<div class="pv-cookie-actions">' +
            '  <button type="button" class="pv-btn-primary" data-act="accept">Accept all</button>' +
            '  <button type="button" class="pv-btn-primary" data-act="reject">Reject non-essential</button>' +
            '  <button type="button" class="pv-btn-secondary" data-act="save" hidden>Save my choices</button>' +
            '  <button type="button" class="pv-btn-link" data-act="manage">Manage preferences</button>' +
            '</div>';
        document.body.appendChild(banner);

        prefs = banner.querySelector('.pv-cookie-prefs');
        analyticsBox = banner.querySelector('#pv-ck-analytics');
        marketingBox = banner.querySelector('#pv-ck-marketing');

        banner.addEventListener('click', function (e) {
            var act = e.target && e.target.getAttribute('data-act');
            if (!act) return;
            if (act === 'accept') finish(true, true);
            else if (act === 'reject') finish(false, false);
            else if (act === 'save') finish(analyticsBox.checked, marketingBox.checked);
            else if (act === 'manage') showPrefs(true);
        });
        banner.addEventListener('keydown', function (e) {
            // Escape just hides an already-answered banner; first-time visitors must choose.
            if (e.key === 'Escape' && readConsent()) hide();
        });
    }

    function showPrefs(on) {
        prefs.hidden = !on;
        banner.querySelector('[data-act="save"]').hidden = !on;
        banner.querySelector('[data-act="manage"]').hidden = on;
        if (on) analyticsBox.focus();
    }

    function show(withPrefs) {
        if (!banner) buildBanner();
        var c = readConsent();
        analyticsBox.checked = !!(c && c.analytics);
        marketingBox.checked = !!(c && c.marketing);
        lastFocus = document.activeElement;
        banner.hidden = false;
        showPrefs(!!withPrefs);
        if (!withPrefs) banner.querySelector('[data-act="accept"]').focus({ preventScroll: true });
    }

    function hide() {
        banner.hidden = true;
        if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }

    function finish(analytics, marketing) {
        var c = saveConsent(analytics, marketing);
        hide();
        applyConsent(c);
        // If consent was withdrawn, already-loaded trackers can only be stopped by a reload.
        if (finish.prev && ((finish.prev.analytics && !analytics) || (finish.prev.marketing && !marketing))) {
            window.location.reload();
        }
        finish.prev = c;
    }

    function init() {
        var existing = readConsent();
        finish.prev = existing;
        if (existing) applyConsent(existing);
        else show(false);

        document.addEventListener('click', function (e) {
            var t = e.target && e.target.closest && e.target.closest('[data-cookie-settings]');
            if (t) { e.preventDefault(); show(true); }
        });
    }

    window.PivotConsent = {
        open: function () { show(true); },
        get: readConsent
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
