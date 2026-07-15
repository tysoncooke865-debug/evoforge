/**
 * OPTIMISE_PLAN P2 — the URL polyfill is NATIVE-ONLY. Hermes lacks a full
 * WHATWG URL; every browser has one. The platform twin (url-polyfill.ts)
 * is empty, so Metro's platform resolution keeps whatwg-url + punycode
 * (~100KB pre-min) out of the web bundle entirely.
 */
import 'react-native-url-polyfill/auto';
