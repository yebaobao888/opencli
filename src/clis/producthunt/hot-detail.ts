/**
 * Product Hunt today's top launches with detail descriptions.
 *
 * Scrapes the homepage for today's ranked products, then fetches each
 * product page to extract the full og:description.
 */
import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';

cli({
  site: 'producthunt',
  name: 'hot-detail',
  description: "Today's top Product Hunt launches with detailed descriptions",
  domain: 'www.producthunt.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of results (max 30)' },
  ],
  columns: ['rank', 'name', 'tagline', 'upvotes', 'description', 'tags', 'url'],
  func: async (page: IPage, args) => {
    const count = Math.min(Number(args.limit) || 10, 30);

    await page.goto('https://www.producthunt.com');
    await page.wait(3);

    // Step 1: Extract today's product list from DOM
    const listItems: any = await page.evaluate(`
      (() => {
        const today = document.querySelector('[data-test="homepage-section-today"]');
        if (!today) return [];

        const cards = today.querySelectorAll('section[data-test^="post-item-"]');
        return [...cards].map((card, idx) => {
          const nameLink = card.querySelector('a');
          const name = nameLink?.textContent?.trim()?.replace(/^\\d+\\.\\s*/, '');
          const href = nameLink?.href;

          const buttons = [...card.querySelectorAll('button')];
          const numButtons = buttons.filter(b => /^[\\d,]+$/.test(b.textContent?.trim()));
          const comments = numButtons[0]?.textContent?.trim();
          const upvotes = numButtons[1]?.textContent?.trim();

          const tags = [...card.querySelectorAll('a')].filter(a =>
            a.href?.includes('/topics/') || a.href?.includes('/categories/')
          ).map(a => a.textContent?.trim());

          const fullText = card.textContent;
          const nameEnd = fullText.indexOf(name) + name.length;
          const tagStart = tags[0] ? fullText.indexOf(tags[0]) : -1;
          const tagline = tagStart > nameEnd ? fullText.slice(nameEnd, tagStart).trim() : '';

          return { rank: idx + 1, name, tagline, upvotes, comments, tags: tags.slice(0, 3), url: href };
        });
      })()
    `);

    const items = Array.isArray(listItems) ? (listItems as any[]).slice(0, count) : [];
    if (items.length === 0) {
      throw new CliError(
        'NO_DATA',
        'Could not retrieve today\'s Product Hunt launches',
        'Product Hunt may have changed its homepage layout',
      );
    }

    // Step 2: Fetch detail description for each product via og:description
    const details: any = await page.evaluate(`
      (async () => {
        const urls = ${JSON.stringify(items.map((i: any) => i.url))};
        const results = await Promise.allSettled(urls.map(async (url) => {
          const res = await fetch(url);
          const html = await res.text();
          const match = html.match(/property="og:description"\\s+content="([^"]*)"/);
          return match ? match[1] : '';
        }));
        return results.map(r => r.status === 'fulfilled' ? r.value : '');
      })()
    `);

    const descriptions = Array.isArray(details) ? details : [];

    return items.map((item: any, i: number) => ({
      rank: item.rank,
      name: item.name,
      tagline: item.tagline,
      upvotes: item.upvotes || '0',
      description: (descriptions[i] || '').slice(0, 300),
      tags: (item.tags || []).join(', '),
      url: item.url,
    }));
  },
});
