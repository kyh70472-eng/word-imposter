const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const TOPICS = {
  'Movies': ['Titanic','Avatar','Joker','Frozen','Interstellar','Gladiator','Matrix','Inception','Shrek','Alien','Rocky','Ghostbusters','Jurassic','Cars','Ratatouille','Coco','Moana','Mulan','Aladdin','Ratatouille','Halloween','Saw','It','Shining','Bambi','Dumbo','Zootopia','Coco2','Frozen2','Brave'],
  'Food': ['Pizza','Sushi','Burger','Tacos','Pasta','Steak','Salad','Cookie','Donut','Pancake','Waffle','Ramen','Curry','Cheese','Bacon','Soup','Fries','Brownie','Muffin','Bagel','Pretzel','Cereal','Yogurt','Smoothie','Candy','Popcorn','Churro','Lasagna','Sushi2','Taco'],
  'Animals': ['Lion','Penguin','Koala','Shark','Tiger','Elephant','Giraffe','Monkey','Owl','Wolf','Bear','Fox','Rabbit','Horse','Zebra','Crocodile','Dolphin','Eagle','Frog','Goose','Llama','Otter','Panda','Sloth','Snake','Squirrel','Whale','Camel','Donkey','Flamingo'],
  'Countries': ['Japan','Brazil','France','Egypt','Canada','Italy','Kenya','Norway','Greece','Thailand','Peru','Mexico','Spain','India','Turkey','Morocco','Iceland','Chile','Sweden','Vietnam','Portugal','Poland','Jordan','Nepal','Cuba','Fiji','Bhutan','Malta','Oman','Peru2'],
  'Sports': ['Soccer','Tennis','Boxing','Golf','Cricket','Hockey','Karate','Surfing','Rowing','Archery','Bowling','Fencing','Rugby','Volleyball','Baseball','Basketball','Skating','Cycling','Marathon','Gymnastics','Wrestling','Judo','Kayak','Skiing','Sailing','Darts','Snooker','Handball','Badminton','Fishing'],
  'Space': ['Mars','Comet','Rocket','Galaxy','Astronaut','Saturn','Nebula','Eclipse','Gravity','Orbit','Telescope','Meteor','Venus','Jupiter','Asteroid','Cosmos','Pulsar','Quasar','Lunar','Solar','Photon','Pluto','Europa','Titan','Voyager','Alien','Star','Black Hole','Sun','Moon'],
  'Jobs': ['Doctor','Pilot','Chef','Teacher','Nurse','Lawyer','Firefighter','Dentist','Farmer','Actor','Singer','Dancer','Engineer','Plumber','Carpenter','Journalist','Librarian','Barista','Photographer','Mechanic','Postman','Judge','Police','Waiter','Baker','Butler','Janitor','Coach','Artist','Vet'],
  'Fantasy': ['Dragon','Wizard','Knight','Princess','Castle','Phoenix','Unicorn','Goblin','Mermaid','Demon','Angel','Witch','Sword','Potion','Golem','Giant','Elf','Dwarf','Griffin','Basilisk','Titan','Oracle','Lich','Sprite','Druid','Paladin','Rogue','Bard','Fairy','Demon2'],
  'Holidays': ['Santa','Gift','Reindeer','Snowman','Sleigh','Stocking','Wreath','Candles','Feast','Fireworks','Pumpkin','Easter','Bunny','Valentine','Parade','Confetti','Lantern','Mistletoe','Chimney','Holiday','Calendar','Cheer','Socks','Tree','Star','Bell','Candy','Elf','Snow','Lights'],
  'Music': ['Guitar','Piano','Drums','Violin','Trumpet','Concert','Festival','Karaoke','Record','Headphones','Speaker','Melody','Chorus','Symphony','Ballad','Jazz','Opera','Banjo','Harmonica','Ukulele','Flute','Cello','Bass','Microphone','DJ','Vinyl','Tune','Rhythm','Tempo','Drum'],
  'Tech': ['Laptop','Mouse','Screen','Keyboard','Router','Cloud','Robot','Battery','Charger','Camera','Printer','Tablet','Drone','Wifi','Server','App','Software','Virus','Monitor','Chip','Cable','Browser','Console','Socket','Projector','Scanner','Antenna','Satellite','Phone','Tablet2'],
  'Nature': ['Mountain','River','Ocean','Forest','Desert','Volcano','Waterfall','Canyon','Glacier','Island','Jungle','Valley','Meadow','Swamp','Cliff','Lake','Cave','Storm','Rainbow','Sunset','Lightning','Breeze','Pebble','Cactus','Tornado','Aurora','Tide','Dune','Reef','Sprout']
};

const MODES = ['topic', 'decoy'];
const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4}, () => letters[Math.floor(Math.random()*letters.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function shuffle(a) { for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

const server = http.createServer((req, res) => {
  const file = req.url === '/' || req.url.startsWith('/?') ? 'client.html' : req.url.slice(1).split('?')[0];
  const safe = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const fp = path.join(__dirname, safe);
  if (!fp.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fp);
    const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg) { room.players.forEach(p => send(p.ws, msg)); }

function publicPlayers(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, connected: p.ws.readyState === 1 }));
}

function updateLobby(room) {
  room.players.forEach(p => send(p.ws, {
    type: 'lobby',
    code: room.code,
    hostId: room.hostId,
    myId: p.id,
    players: publicPlayers(room),
    settings: room.settings
  }));
}

function deal(room) {
  const words = shuffle([...TOPICS[room.settings.topic]]);
  const crewWord = words[0];
  const imps = shuffle(room.players.map(p => p.id)).slice(0, room.settings.imps);
  const decoys = shuffle(words.slice(1));
  room.players.forEach(p => {
    p.isImposter = imps.includes(p.id);
    p.clue = null;
    if (p.isImposter) {
      p.word = room.settings.mode === 'decoy' ? (decoys.shift() || crewWord) : null;
    } else {
      p.word = crewWord;
    }
    p.ready = false;
  });
  room.votes = {};
  room.turn = 0;
  room.phase = 'reveal';
  room.players.forEach(p => {
    send(p.ws, {
      type: 'deal',
      topic: room.settings.topic,
      mode: room.settings.mode,
      word: p.word,
      isImposter: p.isImposter
    });
  });
  broadcast(room, { type: 'phase', phase: 'reveal', total: room.players.length });
  broadcast(room, { type: 'ready', players: publicPlayers(room) });
}

function startClues(room) {
  room.phase = 'clues';
  room.turn = 0;
  broadcast(room, { type: 'phase', phase: 'clues', turnId: room.players[0].id, turnName: room.players[0].name, clues: clueList(room) });
}

function clueList(room) {
  return room.players.filter(p => p.clue).map(p => ({ name: p.name, word: p.clue }));
}

function nextTurn(room) {
  room.turn++;
  if (room.turn >= room.players.length) {
    startVote(room);
  } else {
    broadcast(room, { type: 'phase', phase: 'clues', turnId: room.players[room.turn].id, turnName: room.players[room.turn].name, clues: clueList(room) });
  }
}

function startVote(room) {
  room.phase = 'vote';
  room.votes = {};
  room.voteNotice = null;
  broadcast(room, {
    type: 'phase',
    phase: 'vote',
    candidates: room.players.map(p => ({ id: p.id, name: p.name })),
    votedCount: 0,
    total: room.players.length
  });
}

function tallyVotes(room) {
  const counts = {};
  Object.values(room.votes).forEach(t => counts[t] = (counts[t] || 0) + 1);
  const max = Math.max(...Object.values(counts));
  const leaders = Object.keys(counts).filter(k => counts[k] === max);
  if (leaders.length > 1) {
    room.votes = {};
    broadcast(room, { type: 'voteTie', votedCount: 0, total: room.players.length, candidates: room.players.map(p => ({ id: p.id, name: p.name })) });
    return;
  }
  const accused = room.players.find(p => p.id === leaders[0]);
  const caught = accused.isImposter;
  room.phase = 'result';
  broadcast(room, {
    type: 'result',
    accusedId: accused.id,
    accusedName: accused.name,
    caught,
    imposterNames: room.players.filter(p => p.isImposter).map(p => p.name),
    reveals: room.players.map(p => ({
      name: p.name,
      word: p.isImposter ? (p.word || 'IMPOSTOR') : p.word,
      isImposter: p.isImposter,
      clue: p.clue
    }))
  });
}

function resetToLobby(room) {
  room.phase = 'lobby';
  room.players.forEach(p => { p.ready = false; p.isImposter = false; p.word = null; p.clue = null; });
  room.votes = {};
  updateLobby(room);
}

wss.on('connection', ws => {
  let room = null;
  let player = null;

  const err = text => send(ws, { type: 'error', text });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      if (room) return err('Already in a room.');
      const name = String(msg.name || '').trim().slice(0, 14);
      if (!name) return err('Enter a name.');
      const topic = TOPICS[msg.topic] ? msg.topic : 'Movies';
      const mode = MODES.includes(msg.mode) ? msg.mode : 'topic';
      const imps = Math.max(1, Math.min(2, +msg.imps || 1));
      room = { code: makeCode(), hostId: null, phase: 'lobby', settings: { topic, mode, imps }, players: [], votes: {}, turn: 0 };
      player = { id: Math.random().toString(36).slice(2, 9), name, ws, ready: false, word: null, isImposter: false, clue: null };
      room.players.push(player);
      room.hostId = player.id;
      rooms.set(room.code, room);
      updateLobby(room);
      return;
    }

    if (msg.type === 'join') {
      if (room) return err('Already in a room.');
      const code = String(msg.code || '').trim().toUpperCase();
      const name = String(msg.name || '').trim().slice(0, 14);
      if (!name) return err('Enter a name.');
      const target = rooms.get(code);
      if (!target) return err('Room not found. Check the code.');
      if (target.phase !== 'lobby') return err('Game already in progress.');
      if (target.players.length >= 12) return err('Room is full (12 max).');
      if (target.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return err('Name already taken.');
      room = target;
      player = { id: Math.random().toString(36).slice(2, 9), name, ws, ready: false, word: null, isImposter: false, clue: null };
      room.players.push(player);
      updateLobby(room);
      return;
    }

    if (!room || !player) return err('Not in a room yet.');
    if (msg.type === 'start') {
      if (player.id !== room.hostId) return err('Only the host can start.');
      if (room.phase !== 'lobby') return err('Game already running.');
      if (room.players.length < 3) return err('Need at least 3 players.');
      if (room.settings.imps >= room.players.length) return err('Too many impostors for this group.');
      deal(room);
      return;
    }

    if (msg.type === 'settings') {
      if (player.id !== room.hostId) return err('Only the host can change settings.');
      if (room.phase !== 'lobby') return err('Game in progress.');
      if (TOPICS[msg.topic]) room.settings.topic = msg.topic;
      if (MODES.includes(msg.mode)) room.settings.mode = msg.mode;
      if (msg.imps != null) room.settings.imps = Math.max(1, Math.min(2, +msg.imps || 1));
      updateLobby(room);
      return;
    }

    if (msg.type === 'ready') {
      if (room.phase !== 'reveal') return err('Not in the reveal phase.');
      player.ready = true;
      broadcast(room, { type: 'ready', players: publicPlayers(room) });
      if (room.players.every(p => p.ready)) startClues(room);
      return;
    }

    if (msg.type === 'clue') {
      if (room.phase !== 'clues') return err('Not your clue phase yet.');
      if (room.players[room.turn]?.id !== player.id) return err('Not your turn.');
      const word = String(msg.word || '').trim().slice(0, 20);
      if (word && room.players.some(p => p.clue && p.clue.toLowerCase() === word.toLowerCase())) {
        return err('That word was already used.');
      }
      player.clue = word || '(pass)';
      nextTurn(room);
      return;
    }

    if (msg.type === 'vote') {
      if (room.phase !== 'vote') return err('Voting is not open.');
      if (room.votes[player.id]) return err('You already voted.');
      const target = room.players.find(p => p.id === msg.target);
      if (!target) return err('Invalid target.');
      if (target.id === player.id) return err("You can't vote for yourself.");
      room.votes[player.id] = target.id;
      const votedCount = Object.keys(room.votes).length;
      broadcast(room, { type: 'voteProgress', votedCount, total: room.players.length });
      if (votedCount === room.players.length) tallyVotes(room);
      return;
    }

    if (msg.type === 'rematch') {
      if (player.id !== room.hostId) return err('Only the host can rematch.');
      if (room.phase !== 'result') return err('No finished game to rematch.');
      deal(room);
      return;
    }

    if (msg.type === 'backLobby') {
      if (player.id !== room.hostId) return err('Only the host can do that.');
      resetToLobby(room);
      return;
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.players = room.players.filter(p => p.id !== player?.id);
    if (room.players.length === 0) { rooms.delete(room.code); return; }
    if (room.hostId === player?.id) room.hostId = room.players[0].id;
    if (room.phase === 'lobby' || room.phase === 'result') {
      updateLobby(room);
      if (room.phase === 'result' && room.players.length < 3) resetToLobby(room);
      return;
    }
    // mid-game: if too few remain, go back to lobby
    if (room.players.length < 3) {
      resetToLobby(room);
      return;
    }
    broadcast(room, { type: 'notice', text: `${player.name} left the game.` });
    if (room.phase === 'reveal') {
      broadcast(room, { type: 'ready', players: publicPlayers(room) });
      if (room.players.every(p => p.ready)) startClues(room);
    } else if (room.phase === 'clues') {
      if (room.turn >= room.players.length) startVote(room);
      else broadcast(room, { type: 'phase', phase: 'clues', turnId: room.players[room.turn].id, turnName: room.players[room.turn].name, clues: clueList(room) });
    } else if (room.phase === 'vote') {
      Object.keys(room.votes).forEach(k => { if (!room.players.some(p => p.id === k)) delete room.votes[k]; });
      const votedCount = Object.keys(room.votes).length;
      if (votedCount === room.players.length) tallyVotes(room);
      else broadcast(room, { type: 'voteProgress', votedCount, total: room.players.length, candidates: room.players.map(p => ({ id: p.id, name: p.name })) });
    }
  });
});

const PORT = process.env.PORT || 3456;
server.listen(PORT, () => console.log(`Imposter running at http://localhost:${PORT}`));
