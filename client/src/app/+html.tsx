import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * The static-export HTML shell. Exists for ONE reason: mobile tap latency.
 * Expo's default viewport omits maximum-scale, which leaves iOS Safari's
 * double-tap-to-zoom armed — the browser holds every first tap to see if a
 * second follows, so buttons feel like they need a double tap.
 * maximum-scale=1 + touch-action: manipulation disarm the gesture and make
 * the first tap a click, everywhere, always.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        <style>{'html,body{touch-action:manipulation;-webkit-tap-highlight-color:transparent}'}</style>
        {/* PWA (2026-07-12): installable to the home screen as a standalone
            dark app — manifest + icons live in client/public/. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#04070e" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="EvoForge" />
        <title>EvoForge — The Fitness RPG</title>
        <meta name="description" content="Your character is forged from real training. Lift, level, evolve — and battle in the Arena." />
      </head>
      <body>{children}</body>
    </html>
  );
}
