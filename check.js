const fs = require('fs');
for (const f of ['index.html', 'client.html']) {
  const html = fs.readFileSync(__dirname + '/' + f, 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('no script in ' + f);
  new Function(m[1]);
  console.log(f + ' JS parses OK');
}
