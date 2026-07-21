import { describe, expect, it } from 'vitest';

import { HELP, helpKeyForPath } from '../help-content';

describe('helpKeyForPath', () => {
  it('maps the home tab and its index alias to home', () => {
    expect(helpKeyForPath('/')).toBe('home');
    expect(helpKeyForPath('/index')).toBe('home');
  });

  it('maps base routes to their key', () => {
    expect(helpKeyForPath('/today')).toBe('today');
    expect(helpKeyForPath('/evo')).toBe('evo');
    expect(helpKeyForPath('/forge-level')).toBe('forge-level');
    expect(helpKeyForPath('/coins/')).toBe('coins'); // trailing slash tolerated
  });

  it('collapses dynamic id routes to their base topic', () => {
    expect(helpKeyForPath('/athlete/49fda21a-2651-430c-87d7-e28cb1cac0ea')).toBe('athlete');
    expect(helpKeyForPath('/gym/4c553598-c6ab-4b0a')).toBe('gym');
  });

  it('returns null for routes without a topic', () => {
    expect(helpKeyForPath('/muscle-lab')).toBeNull();
    expect(helpKeyForPath('/insights')).toBeNull();
    expect(helpKeyForPath('/nonexistent')).toBeNull();
  });
});

describe('HELP content', () => {
  it('every topic has a title, tagline and at least one section', () => {
    for (const [key, topic] of Object.entries(HELP)) {
      expect(topic.title, `${key} title`).toBeTruthy();
      expect(topic.tagline, `${key} tagline`).toBeTruthy();
      expect(topic.sections.length, `${key} sections`).toBeGreaterThan(0);
      for (const s of topic.sections) {
        expect(s.heading, `${key} section heading`).toBeTruthy();
        expect(s.body.length, `${key} section body`).toBeGreaterThan(20);
      }
    }
  });
});
