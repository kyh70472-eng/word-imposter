const fs = require('fs');
for (const f of ['index.html', 'client.html']) {
  const html = fs.readFileSync(__dirname + '/' + f, 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('no script in ' + f);
  new Function(m[1]);
  console.log(f + ' JS parses OK');
  // check every $('id') has a matching element id="..."
  const ids = [...m[1].matchAll(/\$\('([\w-]+)'\)/g)].map(x => x[1]);
  const missing = [...new Set(ids)].filter(id => !html.includes(`id="${id}"`));
  if (missing.length) { console.log(f + ' MISSING IDS: ' + missing.join(', ')); process.exitCode = 1; }
  else console.log(f + ' element IDs OK');
}
// no leftover clue UI/refs in index.html
const idx = fs.readFileSync(__dirname + '/index.html', 'utf8');
const leftovers = ['clue-input','clue-add','clue-skip','skip-all','clue-list','clue-turn','clue-err','s-clues','clueIdx','state.clues'].filter(s => idx.includes(s));
if (leftovers.length) { console.log('index.html leftover clue refs: ' + leftovers.join(', ')); process.exitCode = 1; }
else console.log('index.html has no clue remnants');
if (!idx.includes("'🎲 Random'")) { console.log('index.html missing Random topic'); process.exitCode = 1; }
else console.log('index.html Random topic present');
