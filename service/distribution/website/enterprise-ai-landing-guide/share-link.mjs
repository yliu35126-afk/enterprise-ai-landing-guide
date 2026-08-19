const [baseInput, campaignInput] = process.argv.slice(2);
if (!baseInput || !campaignInput) {
  process.stderr.write('Usage: node share-link.mjs <https-base-url> <campaign-code>\n');
  process.exitCode = 1;
} else {
  const base = new URL(baseInput);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Production share URL must use HTTPS');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(campaignInput)) throw new Error('campaignCode must use 1-100 letters, numbers, underscores or hyphens');
  const url = new URL('/enterprise-ai-landing-guide', base);
  url.searchParams.set('campaignCode', campaignInput);
  process.stdout.write(`${url.toString()}\n`);
}
