import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * The static-export HTML shell. Exists for ONE reason: mobile tap latency.
 * Expo's default viewport omits maximum-scale, which leaves iOS Safari's
 * double-tap-to-zoom armed — the browser holds every first tap to see if a
 * second follows, so buttons feel like they need a double tap.
 * touch-action: manipulation disarms the gesture and makes the first tap a
 * click (iOS 12.2+). The old maximum-scale=1/user-scalable=no belt-and-braces
 * was REMOVED 2026-07-18: it blocked pinch-zoom (a real accessibility harm,
 * flagged by the Lighthouse gate) and touch-action alone covers the latency.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        {/* background on html/body/root: an INSTALLED PWA paints the
            safe-area insets (the iPhone home-indicator strip) with the BODY
            background — default white showed as a white gap under the app.
            min-height keeps the paint through rubber-band overscroll. */}
        {/* FULL HEIGHT (Tyson, 2026-07-16: installed iOS PWA rendered only the
            top half, rest the blue bg). A percentage min-height resolves ONLY
            against a parent with a DEFINITE height; with min-height alone the
            whole chain collapsed to content height and the app filled just the
            top of the taller standalone viewport. Every level needs an explicit
            height:100%, and
            #root is a flex column so the app view stretches to fill it. */}
        <style>{'html,body,#root{height:100%;min-height:100%;background:#04070e}html,body{touch-action:manipulation;-webkit-tap-highlight-color:transparent}#root{display:flex;flex-direction:column}'}</style>
        {/* KEYBOARD FOCUS, MADE VISIBLE (2026-08-06). react-native-web renders
            every Pressable as a div with role/tabindex, and the browser's
            default ring on a div is faint-to-absent against this palette — so
            a keyboard user could tab the whole app with no idea where they
            were. :focus-visible only, so a mouse tap never draws a ring. The
            accent cyan at 2px clears 3:1 against every surface in tokens.js. */}
        <style>{':focus-visible{outline:2px solid #22d3ee;outline-offset:2px;border-radius:4px}[role="button"]:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}'}</style>
        {/* Boot cross-fade (OPTIMISE_PLAN M3), PURE CSS so it can NEVER strand
            the app invisible. A Reanimated opacity gate once left an installed
            iOS PWA stuck on the blank boot colour when its animation frame did
            not tick (Tyson, 2026-07-16). `both` rests at opacity 1, and the
            reduced-motion guard means a device with Reduce Motion simply paints
            visible with no animation at all. */}
        <style>{'@media (prefers-reduced-motion: no-preference){@keyframes evoBoot{from{opacity:0}to{opacity:1}}#root{animation:evoBoot .42s ease-out both}}'}</style>
        {/* PWA (2026-07-12): installable to the home screen as a standalone
            dark app — manifest + icons live in client/public/. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#04070e" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* "black", NOT "black-translucent" (Tyson 2026-07-18): translucent makes
            standalone draw UNDER the notch/status bar — overlapping fixed
            compositor layers there are a notorious iOS blend/jitter source,
            and his beacons show a GPU artifact (clean boot, no JS stalls).
            The dvh viewport override was removed for the same reason. */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
        <meta name="apple-mobile-web-app-title" content="EvoForge" />
        <title>EvoForge — The Fitness RPG</title>
        <meta name="description" content="Your character is forged from real training. Lift, level, evolve — and battle in the Arena." />
        {/* BOOT-FAILURE SAFETY NET (Tyson, 2026-07-16; grace window added
            2026-08-04). Runs independently of the app bundle. Expo pre-renders
            each route into #root, so "root is empty" can NEVER detect a failed
            boot — instead we watch the window.__EVO_BOOTED flag the app sets on
            successful mount. If the JS bundle 404s (a stale cached shell
            pointing at deleted chunks) or throws before mount, the flag never
            arrives and this surfaces the actual error with Reload /
            Reset-&-reload buttons — a silent blank screen becomes recoverable
            and self-reporting. If the app boots late it auto-dismisses, so a
            slow network never traps a working app.

            SELF-HEALING A POISONED CDN COPY (2026-08-06). evoforge.app went
            down with "Error: script error": the entry bundle was served as
            text/html, so the browser refused to execute it and the app never
            mounted. The deployment was FINE — 517720ae.evoforge.pages.dev and
            evoforge.pages.dev both served the same URL as application/javascript.
            Only the custom domain's zone was broken, and this is how:

            `public/_headers` sets `/_expo/static/*` to `immutable, max-age=1
            year`, and Cloudflare applies that BY PATH, not by whether a file
            exists. One request slipped through the deploy window before that
            asset had propagated, Pages answered it with the SPA fallback
            (index.html, 200 OK), and the edge cached that HTML under the
            asset's URL — immutable, for a year. Reload could not fix it and
            neither could Reset & reload: both re-request the same poisoned
            URL, so the site was permanently dead for anyone who hit it.

            So a script that fails to LOAD is retried once with a
            cache-busting query, which is a different edge cache key and
            therefore a miss. `async=false` keeps execution order. It is
            capped per-URL by `retried`, so a genuinely broken bundle still
            reaches the error screen instead of looping.

            THE GRACE WINDOW (Tyson: "a 'Could not start' error shows for half a
            second before the loading screen, every time"). The first version
            called reveal() on the VERY FIRST global `error` event, with no
            check for whether boot was merely a few milliseconds away — and
            React 19's hydration-mismatch recovery on this static export
            legitimately fires ONE global error event on ordinary page loads
            (a known, harmless, self-correcting path: React discards the
            mismatched pre-rendered node and re-renders it client-side; the app
            still boots normally within the same commit). That single recovered
            error was enough to flash the whole "Could not start" overlay before
            the 500ms poll below caught up and tore it down — a scary message
            for something that was never actually a failure.
            An error/rejection no longer reveals anything by itself: it only
            arms a short timer, and reveal() only runs if THAT check, later,
            still finds no boot flag. A genuine failure (chunk 404, a throw
            before mount) never sets the flag either way, so it is caught just
            as reliably, ~600ms later instead of instantly — imperceptible next
            to the boot animation that plays regardless, and a fair trade for
            never flashing scary UI at a phone that was about to work fine. */}
        <script>{'(function(){var errs=[],shown=false,node=null,graceTimer=null,retried={};function booted(){return !!window.__EVO_BOOTED;}function reveal(reason){if(shown||booted())return;if(!document.body){document.addEventListener("DOMContentLoaded",function(){reveal(reason);});return;}shown=true;if(reason)errs.unshift(reason);node=document.createElement("div");node.setAttribute("style","position:fixed;inset:0;z-index:2147483647;background:#04070e;color:#e5edf7;font:600 15px -apple-system,system-ui,sans-serif;padding:24px;overflow:auto;-webkit-overflow-scrolling:touch");node.innerHTML=\'<div style="max-width:520px;margin:9vh auto 0"><div style="font-size:20px;font-weight:800;letter-spacing:1px;color:#22d3ee">EVOFORGE</div><div style="margin-top:16px;font-size:16px">Could not start</div><div style="margin-top:8px;font-size:13px;font-weight:400;color:#8aa0b8;line-height:1.5">The app did not load. Tap Reload. If it keeps happening, tap Reset &amp; reload.</div><pre id="__bfl" style="margin-top:14px;font:400 11px ui-monospace,monospace;color:#fb7185;white-space:pre-wrap;word-break:break-word;max-height:34vh;overflow:auto"></pre><div style="margin-top:16px;display:flex;gap:10px"><button id="__bfr" style="flex:1;min-height:50px;border-radius:12px;border:0;background:#22d3ee;color:#04070e;font-weight:800;font-size:15px">Reload</button><button id="__bfx" style="flex:1;min-height:50px;border-radius:12px;border:1px solid #2b3a4f;background:transparent;color:#e5edf7;font-weight:700;font-size:15px">Reset &amp; reload</button></div></div>\';document.body.appendChild(node);document.getElementById("__bfl").textContent=errs.slice(0,8).join("\\n\\n")||"(no error captured; the app simply never mounted — usually a stale cached build)";document.getElementById("__bfr").onclick=function(){location.reload();};document.getElementById("__bfx").onclick=function(){try{localStorage.clear();}catch(e){}try{sessionStorage.clear();}catch(e){}try{if(window.caches&&caches.keys)caches.keys().then(function(k){k.forEach(function(n){caches.delete(n);});});}catch(e){}try{if(window.indexedDB&&indexedDB.databases)indexedDB.databases().then(function(d){d.forEach(function(x){try{indexedDB.deleteDatabase(x.name);}catch(e){}});});}catch(e){}setTimeout(function(){location.reload();},350);};var iv=setInterval(function(){if(booted()&&node){clearInterval(iv);node.parentNode&&node.parentNode.removeChild(node);}},500);}function scheduleCheck(){if(graceTimer||shown||booted())return;graceTimer=setTimeout(function(){graceTimer=null;if(!booted())reveal();},600);}window.addEventListener("error",function(e){var t=e&&e.target;if(t&&t.tagName==="SCRIPT"&&t.src&&t.src.indexOf("/_expo/static/")>-1&&!retried[t.src]){retried[t.src]=1;var rs=document.createElement("script");rs.src=t.src+(t.src.indexOf("?")>-1?"&":"?")+"cb="+Date.now();rs.async=false;document.head.appendChild(rs);errs.push("Retrying "+String(t.src).split("/").pop()+" past a stale CDN copy.");return;}var m=(e&&(e.message||(e.error&&e.error.message)))||"script error";var f=e&&e.filename?(" @ "+String(e.filename).split("/").pop()+":"+e.lineno):"";errs.push("Error: "+m+f);if(!booted())scheduleCheck();},true);window.addEventListener("unhandledrejection",function(e){var r=e&&e.reason;errs.push("Rejection: "+((r&&(r.message||(""+r)))||"promise rejection"));if(!booted())scheduleCheck();});setTimeout(function(){if(!booted())reveal("Timed out: the app did not start within 15 seconds.");},15000);})();'}</script>
      </head>
      <body>{children}</body>
    </html>
  );
}
