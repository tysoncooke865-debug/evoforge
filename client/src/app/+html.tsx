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
        {/* BOOT-FAILURE SAFETY NET (Tyson, 2026-07-16). Runs independently of
            the app bundle. Expo pre-renders each route into #root, so "root is
            empty" can NEVER detect a failed boot — instead we watch the
            window.__EVO_BOOTED flag the app sets on successful mount. If the JS
            bundle 404s (a stale cached shell pointing at deleted chunks) or
            throws before mount, the flag never arrives and this surfaces the
            actual error with Reload / Reset-&-reload buttons — a silent blank
            screen becomes recoverable and self-reporting. If the app boots late
            it auto-dismisses, so a slow network never traps a working app. */}
        <script>{'(function(){var errs=[],shown=false,node=null;function booted(){return !!window.__EVO_BOOTED;}function reveal(reason){if(shown||booted())return;if(!document.body){document.addEventListener("DOMContentLoaded",function(){reveal(reason);});return;}shown=true;if(reason)errs.unshift(reason);node=document.createElement("div");node.setAttribute("style","position:fixed;inset:0;z-index:2147483647;background:#04070e;color:#e5edf7;font:600 15px -apple-system,system-ui,sans-serif;padding:24px;overflow:auto;-webkit-overflow-scrolling:touch");node.innerHTML=\'<div style="max-width:520px;margin:9vh auto 0"><div style="font-size:20px;font-weight:800;letter-spacing:1px;color:#22d3ee">EVOFORGE</div><div style="margin-top:16px;font-size:16px">Could not start</div><div style="margin-top:8px;font-size:13px;font-weight:400;color:#8aa0b8;line-height:1.5">The app did not load. Tap Reload. If it keeps happening, tap Reset &amp; reload.</div><pre id="__bfl" style="margin-top:14px;font:400 11px ui-monospace,monospace;color:#fb7185;white-space:pre-wrap;word-break:break-word;max-height:34vh;overflow:auto"></pre><div style="margin-top:16px;display:flex;gap:10px"><button id="__bfr" style="flex:1;min-height:50px;border-radius:12px;border:0;background:#22d3ee;color:#04070e;font-weight:800;font-size:15px">Reload</button><button id="__bfx" style="flex:1;min-height:50px;border-radius:12px;border:1px solid #2b3a4f;background:transparent;color:#e5edf7;font-weight:700;font-size:15px">Reset &amp; reload</button></div></div>\';document.body.appendChild(node);document.getElementById("__bfl").textContent=errs.slice(0,8).join("\\n\\n")||"(no error captured; the app simply never mounted — usually a stale cached build)";document.getElementById("__bfr").onclick=function(){location.reload();};document.getElementById("__bfx").onclick=function(){try{localStorage.clear();}catch(e){}try{sessionStorage.clear();}catch(e){}try{if(window.caches&&caches.keys)caches.keys().then(function(k){k.forEach(function(n){caches.delete(n);});});}catch(e){}try{if(window.indexedDB&&indexedDB.databases)indexedDB.databases().then(function(d){d.forEach(function(x){try{indexedDB.deleteDatabase(x.name);}catch(e){}});});}catch(e){}setTimeout(function(){location.reload();},350);};var iv=setInterval(function(){if(booted()&&node){clearInterval(iv);node.parentNode&&node.parentNode.removeChild(node);}},500);}window.addEventListener("error",function(e){var m=(e&&(e.message||(e.error&&e.error.message)))||"script error";var f=e&&e.filename?(" @ "+String(e.filename).split("/").pop()+":"+e.lineno):"";errs.push("Error: "+m+f);if(!booted())reveal();},true);window.addEventListener("unhandledrejection",function(e){var r=e&&e.reason;errs.push("Rejection: "+((r&&(r.message||(""+r)))||"promise rejection"));if(!booted())reveal();});setTimeout(function(){if(!booted())reveal("Timed out: the app did not start within 15 seconds.");},15000);})();'}</script>
      </head>
      <body>{children}</body>
    </html>
  );
}
