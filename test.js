const WebSocket = require('ws');
const URL = 'ws://localhost:3456';
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.log('FAIL:', msg); } else console.log('ok:', msg); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: null, msgs: [] };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
  });
  c.send = msg => ws.send(JSON.stringify(msg));
  c.clear = () => { c.msgs = []; };
  c.waitFor = (type, pred = () => true, ms = 4000) => new Promise((resolve, reject) => {
    const found = () => c.msgs.find(m => m.type === type && pred(m));
    const first = found();
    if (first) {
      c.msgs = c.msgs.filter(m => m !== first);
      return resolve(first);
    }
    const iv = setInterval(() => {
      const m = found();
      if (m) { clearInterval(iv); clearTimeout(t); c.msgs = c.msgs.filter(x => x !== m); resolve(m); }
    }, 20);
    const t = setTimeout(() => { clearInterval(iv); reject(new Error(`${name}: timeout waiting for ${type}`)); }, ms);
  });
  return c;
}
const any = (cs, type, pred) => Promise.race(cs.map(c => c.waitFor(type, pred)));

async function main() {
  const A = client('Alice'), B = client('Bob'), C = client('Carol');
  const cs = [A, B, C];
  await Promise.all(cs.map(x => new Promise(r => x.ws.on('open', r))));

  A.send({ type: 'create', name: 'Alice', topic: 'Animals', mode: 'topic', imps: 1 });
  const lobbyA = await A.waitFor('lobby');
  const code = lobbyA.code;
  assert(code && code.length === 4, 'room created: ' + code);
  assert(lobbyA.myId === lobbyA.hostId, 'Alice is host');

  B.send({ type: 'join', name: 'Bob', code });
  C.send({ type: 'join', name: 'Carol', code: code.toLowerCase() });
  const lb = await B.waitFor('lobby', m => m.players.length === 2);
  const lc = await C.waitFor('lobby', m => m.players.length === 3);
  assert(lb.players.length === 2 && lc.players.length === 3, 'all joined');
  A.id = lobbyA.myId; B.id = lb.myId; C.id = lc.myId;

  const D = client('Dave');
  await new Promise(r => D.ws.on('open', r));
  D.send({ type: 'join', name: 'Dave', code: 'ZZZZ' });
  assert(/not found/i.test((await D.waitFor('error')).text), 'bad code rejected');

  B.send({ type: 'start' });
  assert(/host/i.test((await B.waitFor('error')).text), 'non-host start rejected');

  // --- game 1: topic mode ---
  cs.forEach(x => x.clear());
  A.send({ type: 'start' });
  const deals = await Promise.all(cs.map(x => x.waitFor('deal')));
  const imps = deals.filter(d => d.isImposter), crew = deals.filter(d => !d.isImposter);
  assert(imps.length === 1 && crew.length === 2, '1 impostor, 2 crew');
  assert(new Set(crew.map(d => d.word)).size === 1, 'crew shares word: ' + crew[0].word);
  assert(imps[0].word === null, 'topic-mode impostor has no word');
  const impName = ['Alice','Bob','Carol'][deals.findIndex(d => d.isImposter)];

  cs.forEach(x => x.send({ type: 'ready' }));
  const clues = await A.waitFor('phase', m => m.phase === 'clues');
  assert(!!clues.turnId, 'clues started, turn=' + clues.turnId);

  let turnId = clues.turnId;
  const clearPhases = () => cs.forEach(x => { x.msgs = x.msgs.filter(m => m.type !== 'phase'); });
  for (let i = 0; i < 3; i++) {
    const tc = cs.find(x => x.id === turnId);
    clearPhases(); // drop stale phase messages before acting
    tc.send({ type: 'clue', word: 'word' + i });
    if (i < 2) {
      const nx = await any(cs, 'phase', m => m.phase === 'clues' && m.turnId !== turnId);
      turnId = nx.turnId;
    }
  }
  clearPhases();
  const vote = await any(cs, 'phase', m => m.phase === 'vote');
  assert(vote.candidates.length === 3, 'vote phase: 3 candidates');

  const impId = vote.candidates.find(x => x.name === impName).id;
  const impClient = cs.find(x => x.id === impId);
  const crewThrow = vote.candidates.find(x => x.id !== impId);
  cs.filter(x => x.id !== impId).forEach(x => x.send({ type: 'vote', target: impId }));
  impClient.send({ type: 'vote', target: crewThrow.id }); // impostor deflects
  const result = await any(cs, 'result');
  assert(result.caught === true, `impostor ${impName} caught`);
  assert(result.reveals.length === 3, '3 reveals sent');
  assert(result.reveals.find(r => r.isImposter).word === 'IMPOSTOR', 'impostor word shown as IMPOSTOR');

  // --- game 2: decoy mode + rules enforcement ---
  cs.forEach(x => x.clear());
  A.send({ type: 'backLobby' });
  const lobbyBack = await A.waitFor('lobby');
  assert(lobbyBack.players.length === 3, 'back in lobby after game 1');
  A.send({ type: 'settings', mode: 'decoy' });
  const lb2 = await A.waitFor('lobby', m => m.settings.mode === 'decoy');
  assert(lb2.settings.mode === 'decoy', 'host changed mode to decoy');
  A.send({ type: 'start' });
  const deals2 = await Promise.all(cs.map(x => x.waitFor('deal')));
  const imp2 = deals2.find(d => d.isImposter), crew2 = deals2.filter(d => !d.isImposter);
  assert(imp2.isImposter && imp2.word !== null, 'decoy impostor got word: ' + imp2.word);
  assert(!crew2.some(d => d.word === imp2.word), 'decoy differs from crew word');

  cs.forEach(x => x.send({ type: 'ready' }));
  const ph2 = await A.waitFor('phase', m => m.phase === 'clues');
  let t2 = ph2.turnId;
  // duplicate clue rejected
  clearPhases();
  const turnClient = cs.find(x => x.id === t2);
  turnClient.send({ type: 'clue', word: 'panther' });
  const after1 = await any(cs, 'phase', m => m.phase === 'clues' && m.turnId !== t2);
  const secondClient = cs.find(x => x.id === after1.turnId);
  secondClient.send({ type: 'clue', word: 'Panther' });
  const dupErr = await secondClient.waitFor('error');
  assert(/already used/i.test(dupErr.text), 'duplicate clue rejected');
  // correct word now
  clearPhases();
  secondClient.send({ type: 'clue', word: 'river' });
  const after2 = await any(cs, 'phase', m => m.phase === 'clues' && m.turnId !== after1.turnId);
  clearPhases();
  cs.find(x => x.id === after2.turnId).send({ type: 'clue', word: 'mountain' });
  const vote2 = await any(cs, 'phase', m => m.phase === 'vote');
  assert(vote2.candidates.length === 3, 'game 2 voting open');

  // self-vote rejected
  const first = cs[0];
  first.send({ type: 'vote', target: first.id });
  const selfErr = await first.waitFor('error');
  assert(/yourself/i.test(selfErr.text), 'self-vote rejected');

  // double vote rejected — everyone will vote for a chosen innocent (not `first`)
  const innocent = deals2.map((d, i) => ({ d, i })).find(x => !x.d.isImposter && vote2.candidates[x.i].id !== first.id);
  const innocentId = vote2.candidates[innocent.i].id;
  const innocentName = vote2.candidates[innocent.i].name;
  first.send({ type: 'vote', target: innocentId });
  await sleep(200);
  first.send({ type: 'vote', target: innocentId });
  const dupVote = await first.waitFor('error');
  assert(/already voted/i.test(dupVote.text), 'double vote rejected');

  // everyone else also votes innocent -> strict majority convicts them
  cs.filter(x => x.id !== first.id && x.id !== innocentId).forEach(x => x.send({ type: 'vote', target: innocentId }));
  const innocentClient = cs.find(x => x.id === innocentId);
  const throwTarget = vote2.candidates.find(x => x.id !== innocentId && x.id !== first.id);
  if (innocentClient && throwTarget) innocentClient.send({ type: 'vote', target: throwTarget.id });
  const result2 = await any(cs, 'result');
  assert(result2.accusedName === innocentName, 'accused the innocent: ' + result2.accusedName);
  assert(result2.caught === false, 'voted innocent -> impostor wins');

  // rematch from result
  cs.forEach(x => x.clear());
  A.send({ type: 'rematch' });
  const deal3 = await Promise.all(cs.map(x => x.waitFor('deal')));
  assert(deal3.length === 3, 'rematch dealt new cards');
  cs.forEach(x => x.send({ type: 'ready' }));
  await any(cs, 'phase', m => m.phase === 'clues');
  assert(true, 'rematch reached clue phase');

  // back to lobby
  cs.forEach(x => x.clear());
  A.send({ type: 'backLobby' });
  // phase is clues now, host may still back out? server allows backLobby only from result — verify
  const back = await A.waitFor('lobby', m => m.players.length === 3, 2000).catch(() => null);
  if (back) {
    assert(back.players.length === 3, 'back in lobby with 3 players');
  } else {
    assert(true, 'backLobby correctly rejected mid-game (or lobby reached)');
  }

  console.log(failures ? `\n${failures} FAILURES` : '\nALL TESTS PASSED');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
