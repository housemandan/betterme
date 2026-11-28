'use strict';
/* =====================================================================
   EASY-TO-EDIT SETTINGS
   ===================================================================== */
// Campaign ladder: one row per level. dogs = correct picks needed, seconds = time for the whole level.
const LEVELS = [
  { dogs: 10, seconds: 15 },    // level 1
  { dogs: 10, seconds: 12.5 },  // level 2
  { dogs: 10, seconds: 10 },    // level 3
  { dogs: 10, seconds: 9.5 },   // level 4
  { dogs: 10, seconds: 9 },     // level 5
  { dogs: 12, seconds: 10.5 },  // level 6
  { dogs: 12, seconds: 10 },    // level 7
  { dogs: 12, seconds: 9.5 },   // level 8
  { dogs: 15, seconds: 11.5 },  // level 9
  { dogs: 15, seconds: 10.5 },  // level 10
];
const CAMPAIGN_LIVES = 3;     // hearts for the whole campaign (all levels together)
// The sounds from the Android app (folder "sounds"). Several names = one is picked at random.
const SOUNDS = {
  happy:  ['dog_happy_1', 'dog_happy_2', 'dog_happy_3', 'dog_happy_4', 'dog_happy_5'],   // right pick
  wrong:  ['dog_wrong'],                                                                // wrong pick
  sad:    ['dog_sad_1', 'dog_sad_2', 'dog_sad_3', 'dog_sad_4', 'dog_sad_5'],            // game lost
  win:    ['level_win'],                                                                // level passed
  record: ['new_score'],                                                                // made a leaderboard
};
// Sprint speeds, easiest first. Each speed has its own leaderboard.
const SPEEDS = [
  { secs: 2,    name: 'Easy' },
  { secs: 1.5,  name: 'Medium' },
  { secs: 1,    name: 'Normal' },
  { secs: 0.75, name: 'Fast' },
  { secs: 0.5,  name: 'Insane' },
];
const SPRINT_SECONDS = 1;     // Sprint: speed picked for a new player
const BOARD_SIZE = 10;        // names kept on each leaderboard
const MIRROR_CHANCE = 0.5;    // how often each picture is shown flipped left-to-right
const MAX_SAME_SIDE = 4;      // the dog is never in the same spot more than this many times in a row
const LOAD_AHEAD = 5;         // pairs loaded in advance
const GIVE_UP_LOADING = 25;   // seconds before a stuck pair is skipped
const CHEERS = ['Good boy!', 'Nailed it!', 'Woof yes!', 'Sharp eyes!', 'Top dog!'];
const OOPS = ['Fooled you!', 'Ruh-roh!', 'Not quite, bro!', 'So close!'];

/* ===================================================================== */
const $ = id => document.getElementById(id);
const pick = list => list[Math.random() * list.length | 0];
const secsText = n => `${n} second${n === 1 ? '' : 's'}`;
const shuffle = list => {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [list[i], list[j]] = [list[j], list[i]]; }
  return list;
};

const STORE = 'dogornot-game';
// run = the campaign in progress (kept if you close the page); runs = campaign leaderboard
const save = { animals: 'dogs', speed: SPRINT_SECONDS, sound: 'on', name: '', sprint: {}, run: null, runs: [] };
try { Object.assign(save, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { /* start fresh */ }
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(save)); } catch (e) { /* private mode */ } };

let PAIRS = [];
let run = null;   // the round being played
let runId = 0;

/* ---------- sounds ---------- */
let audio = null;
function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audio) audio = new Ctx();
  if (audio.state === 'suspended') audio.resume();
}
const clips = {};   // file name -> decoded sound
function loadSounds() {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) return;
  const decoder = new Offline(1, 1, 44100);
  Object.values(SOUNDS).flat().forEach(name => fetch(`sounds/${name}.ogg`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(data => new Promise((ok, no) => decoder.decodeAudioData(data, ok, no)))
    .then(buffer => { clips[name] = buffer; })
    .catch(() => { /* the back-up noise is used instead */ }));
}
function play(kind) {
  if (save.sound !== 'on' || !audio) return;
  const ready = SOUNDS[kind].filter(name => clips[name]);
  if (!ready.length) return kind === 'wrong' || kind === 'sad' ? sadNoise() : bark();
  const source = audio.createBufferSource();
  source.buffer = clips[pick(ready)];
  source.connect(audio.destination);
  source.start();
}
function tone(at, length, points, volume, filterType, filterHz, wobble) {
  const t = audio.currentTime + at;
  const osc = audio.createOscillator(), filter = audio.createBiquadFilter(), gain = audio.createGain();
  osc.type = 'sawtooth';
  points.forEach(([when, hz], i) => i ? osc.frequency.exponentialRampToValueAtTime(hz, t + when) : osc.frequency.setValueAtTime(hz, t));
  filter.type = filterType; filter.frequency.value = filterHz; filter.Q.value = 1.2;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
  gain.gain.setValueAtTime(volume, t + length * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  if (wobble) {
    const lfo = audio.createOscillator(), depth = audio.createGain();
    lfo.frequency.value = 6; depth.gain.value = wobble;
    lfo.connect(depth).connect(osc.frequency); lfo.start(t); lfo.stop(t + length);
  }
  osc.connect(filter).connect(gain).connect(audio.destination);
  osc.start(t); osc.stop(t + length + 0.05);
}
function noise(at, length, volume, hz) {
  const t = audio.currentTime + at, n = Math.floor(audio.sampleRate * length);
  const buffer = audio.createBuffer(1, n, audio.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
  src.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = hz; gain.gain.value = volume;
  src.connect(filter).connect(gain).connect(audio.destination); src.start(t);
}
function bark() {
  if (save.sound !== 'on' || !audio) return;
  [0, 0.17].forEach((at, i) => {   // "arf arf!"
    const high = i ? 1.18 : 1;
    tone(at, 0.13, [[0, 320 * high], [0.035, 620 * high], [0.13, 240 * high]], 0.5, 'bandpass', 950);
    noise(at, 0.06, 0.25, 1400);
  });
}
function sadNoise() {
  if (save.sound !== 'on' || !audio) return;
  [[0, 233, 0.24], [0.26, 220, 0.24], [0.52, 208, 0.24]].forEach(([at, hz, len]) =>
    tone(at, len, [[0, hz * 0.96], [0.06, hz]], 0.28, 'lowpass', 900));
  tone(0.78, 0.75, [[0, 196], [0.3, 190], [0.75, 130]], 0.3, 'lowpass', 800, 7);   // "waaah"
}

/* ---------- picture loading: only fully loaded pictures are ever shown ---------- */
const cache = new Map();
function load(photo) {
  let img = cache.get(photo.src);
  if (!img) {
    img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    img.draggable = false;
    img.ready = new Promise(done => {
      img.onload = () => (img.decode ? img.decode() : Promise.resolve()).then(() => done(true), () => done(true));
      img.onerror = () => { cache.delete(photo.src); done(false); };
    });
    img.src = photo.src;
    cache.set(photo.src, img);
  }
  return img;
}
const loadPair = p => Promise.all([load(p.animal).ready, load(p.thing).ready]).then(r => r[0] && r[1]);
const loadAhead = () => run.deck.slice(run.at, run.at + LOAD_AHEAD).forEach(loadPair);

/* ---------- dealing a round: no photo appears twice ---------- */
const photoKey = photo => photo.src.split('?')[0];
function deal() {
  const pool = shuffle(PAIRS.filter(p => save.animals === 'all' || p.kind === 'dog'));
  const used = new Set(), deck = [];
  for (const p of pool) {
    const a = photoKey(p.animal), b = photoKey(p.thing);
    if (used.has(a) || used.has(b)) continue;
    used.add(a); used.add(b); deck.push(p);
  }
  // with "All animals", make sure a non-dog pair turns up early
  if (save.animals === 'all') {
    const i = deck.findIndex(p => p.kind === 'other');
    if (i > -1) { const [other] = deck.splice(i, 1); deck.splice(Math.random() * 5 | 0, 0, other); }
  }
  return deck;
}

/* ---------- screens ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
  window.scrollTo(0, 0);
}
function menu() {
  run = null; runId++;
  const speed = speedOf(save.speed), top = (save.sprint[speed.secs] || [])[0];
  $('sprintInfo').textContent = `${speed.name}: ${speed.secs} s per pick, 1 life` + (top ? ` · record: ${top.score}` : '');
  $('speeds').replaceChildren(...SPEEDS.map(s => {
    const b = document.createElement('button');
    b.append(s.name, Object.assign(document.createElement('small'), { textContent: `${s.secs} s` }));
    b.className = s.secs === speed.secs ? 'on' : '';
    b.onclick = () => { save.speed = s.secs; persist(); menu(); };
    return b;
  }));
  if (save.run && save.run.lives < 1) endRun();
  const saved = save.run;
  $('campaignInfo').textContent = saved
    ? `Continue: level ${saved.level} of ${LEVELS.length} · ${hearts(saved.lives)}`
    : `${LEVELS.length} levels · ${CAMPAIGN_LIVES} lives ${hearts(CAMPAIGN_LIVES)}`;
  $('restart').hidden = !saved;
  const others = PAIRS.filter(p => p.kind === 'other').length;
  $('animalNote').textContent = save.animals === 'all' ? `Only ${others} non-dog pair so far. More coming!` : '';
  for (const key of ['animals', 'sound']) $(key).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === save[key]));
  $('mute').textContent = save.sound === 'on' ? '🔊' : '🔇';
  show('menu');
}

/* ---------- leaderboards (saved on this device) ---------- */
const speedOf = secs => SPEEDS.find(s => s.secs === secs) || SPEEDS.find(s => s.secs === SPRINT_SECONDS);
const playerName = () => save.name.trim() || 'Player';
// Sprint: longest streaks first. A tie keeps the earlier score on top.
function addSprint(secs, score) {
  const list = save.sprint[secs] || (save.sprint[secs] = []);
  const entry = { name: playerName(), score };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list.splice(BOARD_SIZE);
  persist();
  return list.includes(entry) ? entry : null;
}
// Campaign: one row per run. Most levels cleared first, then most lives left, then the quicker time.
const better = (a, b) => b.level - a.level || b.lives - a.lives || a.time - b.time;
const hearts = n => '❤️'.repeat(Math.max(0, n)) + '🤍'.repeat(Math.max(0, CAMPAIGN_LIVES - n));
// closes the campaign in progress and puts it on the board; returns its row if it made the top list
function endRun() {
  const r = save.run;
  save.run = null;
  let entry = null;
  if (r && r.level > 1) {
    const row = { name: playerName(), level: r.level - 1, lives: Math.max(0, r.lives), time: r.time };
    save.runs.push(row);
    save.runs.sort(better);
    save.runs.splice(BOARD_SIZE);
    if (save.runs.includes(row)) entry = row;
  }
  persist();
  return entry;
}
function table(rows, mine, empty) {
  if (!rows.length) return Object.assign(document.createElement('p'), { className: 'note', textContent: empty });
  const list = document.createElement('ol');
  list.className = 'board';
  rows.forEach(r => {
    const li = document.createElement('li');
    if (r.entry === mine) li.className = 'mine';
    li.append(Object.assign(document.createElement('span'), { textContent: r.entry.name }),
              Object.assign(document.createElement('b'), { textContent: r.value }));
    list.append(li);
  });
  return list;
}
const sprintTable = (secs, mine) => table((save.sprint[secs] || []).map(entry => ({ entry, value: `${entry.score} in a row` })), mine, 'No scores yet at this speed.');
const campaignTable = mine => table(save.runs.map(entry => ({ entry,
  value: `${entry.level} level${entry.level > 1 ? 's' : ''} · ${entry.lives}❤️ · ${entry.time.toFixed(1)} s` })), mine, 'Clear a level, then finish your run to get on the board.');

/* ---------- celebrations ---------- */
function confetti(count, symbols) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = Object.assign(document.createElement('div'), { className: 'confetti' });
  for (let i = 0; i < count; i++) {
    const bit = Object.assign(document.createElement('i'), { textContent: pick(symbols) });
    bit.style.left = Math.random() * 100 + '%';
    bit.style.fontSize = 16 + Math.random() * 22 + 'px';
    bit.style.animationDelay = Math.random() * 0.6 + 's';
    bit.style.animationDuration = 1.4 + Math.random() * 1.2 + 's';
    box.append(bit);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3500);
}

let boardTab = 'sprint';
function leaders(tab, secs) {
  boardTab = tab;
  const speed = speedOf(secs === undefined ? save.speed : secs);
  $('boardTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
  $('boardSpeeds').hidden = tab !== 'sprint';
  $('boardSpeeds').replaceChildren(...SPEEDS.map(s => {
    const b = document.createElement('button');
    b.append(s.name, Object.assign(document.createElement('small'), { textContent: `${s.secs} s` }));
    b.className = s.secs === speed.secs ? 'on' : '';
    b.onclick = () => leaders('sprint', s.secs);
    return b;
  }));
  $('boardList').replaceChildren(tab === 'sprint' ? sprintTable(speed.secs) : campaignTable());
  show('leaders');
}

/* ---------- playing ---------- */
function prepare(mode) {
  const id = ++runId;
  if (mode === 'campaign' && !save.run) { save.run = { level: 1, lives: CAMPAIGN_LIVES, time: 0 }; persist(); }
  const levelNo = mode === 'campaign' ? Math.min(save.run.level, LEVELS.length) : 0;
  const level = levelNo ? LEVELS[levelNo - 1] : null;
  run = { mode, level, levelNo, deck: deal(), at: 0, score: 0, skipped: 0,
          secs: speedOf(save.speed).secs, limit: level ? level.seconds : speedOf(save.speed).secs, left: 0, phase: 'ready' };
  run.left = run.limit;
  $('readyTitle').textContent = level ? `Level ${run.levelNo}` : 'Sprint';
  $('readyText').textContent = level
    ? `${hearts(save.run.lives)} A miss or running out of time costs a heart.`
    : `${speedOf(run.secs).name}: ${secsText(run.secs)} per pick, one life. How far can you get?`;
  // campaign: show the goal of the coming level in big type
  $('goal').replaceChildren(...(level ? [`🐶 ${level.dogs} dogs`, `⏱️ ${secsText(level.seconds)}`]
    .map(t => Object.assign(document.createElement('b'), { textContent: t })) : []));
  const first = run.deck.slice(0, LOAD_AHEAD);
  let done = 0, ok = 0;
  const label = () => { $('readyLoad').textContent = done < first.length ? `Fetching pictures… ${done} of ${first.length}` : ok ? 'Ready!' : 'Pictures did not load. Check your internet, then press Go to retry.'; };
  $('start').disabled = true; label();
  // Go unlocks when the first two pairs are in; the rest keep loading behind it
  first.forEach((p, i) => loadPair(p).then(good => {
    if (id !== runId) return;
    done++; if (good) ok++; label();
    if (ok >= 2 || done === first.length) $('start').disabled = false;
  }));
  show('ready');
}

function begin() {
  unlockAudio();
  show('game');
  nextPair();
}

function hud() {
  $('status').textContent = run.mode === 'sprint'
    ? `Streak: ${run.score}`
    : `L${run.levelNo} · ${run.score}/${run.level.dogs} · ${Math.max(0, run.left).toFixed(1)} s`;
  $('hearts').textContent = run.mode === 'campaign' && save.run ? hearts(save.run.lives) : '';
  const part = Math.max(0, run.left / run.limit);
  $('bar').style.transform = `scaleX(${part})`;
  $('bar').classList.toggle('low', part < 0.3);
}

async function nextPair() {
  const id = runId;
  run.phase = 'loading';
  if (run.mode === 'sprint') run.left = run.limit;
  hud();
  const pair = run.deck[run.at];
  if (!pair) {   // no unused pictures left
    return finish(run.mode === 'sprint' ? 'cleared' : 'outofpictures');
  }
  const tiles = [$('t0'), $('t1')];
  tiles.forEach(t => { t.replaceChildren(); t.className = 'tile'; });
  $('message').textContent = '';
  $('prompt').textContent = `Pick the ${pair.find}`;
  loadAhead();
  const slow = setTimeout(() => { if (id === runId) $('message').textContent = 'Fetching pictures…'; }, 250);
  let timer;
  const good = await Promise.race([loadPair(pair), new Promise(r => { timer = setTimeout(() => r(false), GIVE_UP_LOADING * 1000); })]);
  clearTimeout(slow); clearTimeout(timer);
  if (id !== runId) return;
  if (!good) {   // skip a picture that will not load
    run.at++;
    if (++run.skipped >= 3) return finish('offline');
    return nextPair();
  }
  run.skipped = 0;
  run.pair = pair;
  run.sides = shuffle(['animal', 'thing']);
  const spot = run.sides.indexOf('animal');
  if (spot === run.spot && run.same >= MAX_SAME_SIDE) run.sides.reverse();
  const now = run.sides.indexOf('animal');
  run.same = now === run.spot ? run.same + 1 : 1;
  run.spot = now;
  // each picture may be mirrored, so pairs are harder to memorize ("noFlip": true in the data turns this off)
  run.flips = run.sides.map(side => !pair[side].noFlip && Math.random() < MIRROR_CHANCE);
  tiles.forEach((t, i) => {
    const img = load(pair[run.sides[i]]);
    img.style.transform = run.flips[i] ? 'scaleX(-1)' : '';
    t.append(img);
  });
  $('message').textContent = '';
  layout();
  run.phase = 'choose';
  run.last = performance.now();
}

// the clock only runs while both pictures are on screen and you have not picked yet
setInterval(() => {
  if (!run || run.phase !== 'choose') return;
  const now = performance.now();
  if (!document.hidden) run.left -= Math.min(now - run.last, 250) / 1000;
  run.last = now;
  hud();
  if (run.left <= 0) answer(-1);
}, 50);

function answer(choice) {   // 0 or 1 = picture tapped, -1 = time ran out
  if (!run || run.phase !== 'choose') return;
  // count the time since the last clock tick, so a late tap cannot beat the clock
  if (choice > -1) { run.left -= Math.min(performance.now() - run.last, 250) / 1000; if (run.left <= 0) choice = -1; }
  run.phase = 'feedback';
  const id = runId, right = choice > -1 && run.sides[choice] === 'animal';
  const timedOut = choice === -1;
  [$('t0'), $('t1')].forEach((t, i) => {
    const photo = run.pair[run.sides[i]], isAnimal = run.sides[i] === 'animal';
    if (isAnimal) t.classList.add('good');
    else if (i === choice) t.classList.add('bad');
    if (!right && isAnimal) t.append(Object.assign(document.createElement('span'), { className: 'mark', textContent: `${run.pair.find.toUpperCase()}!` }));
    // credit captions appear after the pick, so they cannot give the answer away
    if (photo.cap) t.append(Object.assign(document.createElement('span'), { textContent: photo.cap }));
  });
  const captioned = run.pair.animal.cap || run.pair.thing.cap;
  let wait;
  if (right) {
    run.score++; play('happy');
    $('message').textContent = pick(CHEERS);
    wait = captioned ? 1500 : 600;
  } else {
    play('wrong');
    const words = timedOut ? 'Too slow!' : pick(OOPS);
    if (run.mode === 'campaign') {   // costs a heart; the clock is left alone
      save.run.lives--; persist();
      $('message').textContent = `${words} −1 ❤️`;
    } else $('message').textContent = words;
    wait = 1700;
  }
  run.at++;
  hud();
  setTimeout(() => {
    if (id !== runId) return;
    if (run.mode === 'sprint') return right ? nextPair() : finish(timedOut ? 'timeout' : 'wrong');
    if (save.run.lives < 1) return finish('gameover');
    if (run.score >= run.level.dogs) return finish('passed');
    if (timedOut) return finish('timeout');
    nextPair();
  }, wait);
}

function finish(why) {
  run.phase = 'over';
  let face, title, text, button, action, entry = null, redraw = null;
  let board = [];   // the leaderboard the new score belongs to
  const mode = run.mode;
  if (mode === 'sprint') {
    const secs = run.secs;
    if (run.score) entry = addSprint(secs, run.score);
    board = save.sprint[secs] || [];
    redraw = () => sprintTable(secs, entry);
    face = why === 'cleared' ? '🏆' : '🐶';
    title = why === 'cleared' ? 'You beat them all!' : why === 'timeout' ? 'Time’s up!' : why === 'offline' ? 'Pictures are not loading' : 'Game over';
    text = `You got ${run.score} in a row at ${secs} s.`;
    button = 'Run it back'; action = () => prepare('sprint');
    if (why === 'cleared') play('win'); else if (why !== 'offline') play('sad');
  } else if (why === 'passed') {
    save.run.time += run.level.seconds - Math.max(0, run.left);
    save.run.level = run.levelNo + 1; persist();
    const spare = `${run.score} dogs with ${Math.max(0, run.left).toFixed(1)} seconds to spare.`;
    play('win');
    confetti(24, ['🦴', '🐾', '🎉']);
    if (run.levelNo >= LEVELS.length) {
      const lives = save.run.lives;
      entry = endRun(); board = save.runs; redraw = () => campaignTable(entry);
      face = '🏆'; title = 'Campaign complete!'; text = `All ${LEVELS.length} levels, ${hearts(lives)} left.`;
      button = 'Play again';
    } else {
      const next = LEVELS[run.levelNo];
      face = '🎉'; title = `Level ${run.levelNo} passed!`;
      text = `${spare} ${hearts(save.run.lives)} Next, level ${save.run.level}: ${next.dogs} dogs in ${secsText(next.seconds)}.`;
      button = `Level ${save.run.level}`;
    }
    action = () => prepare('campaign');
  } else if (why === 'gameover') {
    const cleared = run.levelNo - 1;
    entry = endRun(); board = save.runs; redraw = () => campaignTable(entry);
    face = '🐕'; title = 'Game over'; text = `Out of hearts on level ${run.levelNo}. Levels cleared: ${cleared}.`;
    button = 'New campaign'; action = () => prepare('campaign');
    play('sad');
  } else {
    face = '🐕';
    title = why === 'offline' ? 'Pictures are not loading' : why === 'outofpictures' ? 'Out of pictures!' : 'Time’s up!';
    text = `You found ${run.score} of ${run.level.dogs} dogs. ${hearts(save.run.lives)}`;
    button = `Retry level ${run.levelNo}`; action = () => prepare('campaign');
  }
  if (why === 'offline') text += ' Check your internet and try again.';
  $('resultBoard').replaceChildren(...(redraw ? [redraw()] : []));
  // made the top list: celebrate, after the dog has had its say
  const rank = entry ? board.indexOf(entry) + 1 : 0;
  $('rank').textContent = rank ? (rank === 1 ? '🥇 New record!' : `⭐ Top ${BOARD_SIZE}! You are number ${rank}.`) : '';
  if (rank) {
    const id = runId;
    setTimeout(() => {
      if (id !== runId || $('result').hidden) return;
      play('record');
      confetti(70, ['⭐', '🎉', '🦴', '🐾', '🏅']);
    }, why === 'cleared' || why === 'passed' ? 900 : 1200);
  }
  // the score is saved already; typing a name just relabels it
  $('nameRow').hidden = !entry;
  $('name').value = save.name;
  $('name').oninput = () => {
    save.name = $('name').value.slice(0, 14);
    entry.name = playerName();
    persist();
    $('resultBoard').replaceChildren(redraw());
  };
  $('resultFace').textContent = face; $('resultTitle').textContent = title; $('resultText').textContent = text;
  $('again').textContent = button;
  $('again').onclick = action;
  $('again').disabled = true;   // stops a fast double tap from skipping this screen
  setTimeout(() => { $('again').disabled = false; }, 600);
  show('result');
}

/* ---------- layout: side by side or stacked, whichever makes bigger pictures ---------- */
function fit(img, crop, flipped) {
  const F = img.parentNode.clientWidth;
  const k = F * crop[2] / Math.min(img.naturalWidth, img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  const place = (v, size) => Math.min(0, Math.max(F - size, v));
  img.style.width = w + 'px'; img.style.height = h + 'px';
  const left = place(F / 2 - crop[0] * w, w);
  // a mirrored picture is shifted the opposite way, so the same crop stays in view
  img.style.left = (flipped ? F - w - left : left) + 'px';
  img.style.top = place(F / 2 - crop[1] * h, h) + 'px';
}
function layout() {
  if ($('game').hidden) return;
  const board = $('board'), W = board.clientWidth, H = board.clientHeight, gap = 10;
  const side = Math.min((W - gap) / 2, H), stacked = Math.min(W, (H - gap) / 2);
  const size = Math.floor(Math.min(560, Math.max(side, stacked, 80)));
  board.classList.toggle('column', stacked > side);
  [$('t0'), $('t1')].forEach((t, i) => {
    t.style.width = t.style.height = size + 'px';
    const img = t.querySelector('img');
    if (img && img.naturalWidth && run && run.pair) fit(img, run.pair[run.sides[i]].crop, run.flips[i]);
  });
}
new ResizeObserver(layout).observe($('board'));

/* ---------- credits ---------- */
function buildCredits() {
  const seen = new Set(), items = [];
  const link = (href, text) => Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' });
  for (const p of PAIRS) for (const photo of [p.animal, p.thing]) {
    if (seen.has(photoKey(photo))) continue;
    seen.add(photoKey(photo));
    const li = document.createElement('li');
    if (photo.title) li.append(`“${photo.title}” by ${photo.by}. `);
    else if (photo.by) li.append(`Photo by ${photo.by}. `);
    else li.append(`Photo from ${photo.site}. `);
    li.append(link(photo.source, `Source: ${photo.site}`), ' · ', link(photo.licenseUrl, photo.license), photo.license.startsWith('CC BY') && !photo.noFlip ? ' · cropped, may be mirrored' : ' · cropped');
    items.push({ needsCredit: photo.license.startsWith('CC BY') ? 0 : 1, li });
  }
  items.sort((a, b) => a.needsCredit - b.needsCredit);
  $('creditList').replaceChildren(...items.map(i => i.li));
}

/* ---------- buttons and keys ---------- */
$('play').onclick = () => { unlockAudio(); play('happy'); menu(); };
$('restart').onclick = () => { if (confirm('Start the campaign over from level 1?')) { endRun(); menu(); } };
$('goSprint').onclick = () => { unlockAudio(); prepare('sprint'); };
$('goCampaign').onclick = () => { unlockAudio(); prepare('campaign'); };
$('start').onclick = () => { if (run.deck.slice(0, LOAD_AHEAD).every(p => !cache.has(p.animal.src) || !cache.has(p.thing.src))) prepare(run.mode); else begin(); };
$('readyBack').onclick = $('quit').onclick = $('home').onclick = $('creditsBack').onclick = $('leadersBack').onclick = menu;
$('goLeaders').onclick = () => leaders(boardTab);
$('boardTabs').onclick = e => { if (e.target.dataset.v) leaders(e.target.dataset.v); };
$('goCredits').onclick = () => show('credits');
$('t0').onclick = () => answer(0);
$('t1').onclick = () => answer(1);
$('animals').onclick = e => { if (e.target.dataset.v) { save.animals = e.target.dataset.v; persist(); menu(); } };
$('sound').onclick = e => { if (e.target.dataset.v) { save.sound = e.target.dataset.v; persist(); menu(); unlockAudio(); play('happy'); } };
$('mute').onclick = () => { save.sound = save.sound === 'on' ? 'off' : 'on'; persist(); $('mute').textContent = save.sound === 'on' ? '🔊' : '🔇'; };
addEventListener('keydown', e => {
  if (e.repeat || e.target.tagName === 'INPUT') return;
  const choice = { ArrowLeft: 0, ArrowUp: 0, ArrowRight: 1, ArrowDown: 1 }[e.key];
  if (choice !== undefined && !$('game').hidden) { e.preventDefault(); answer(choice); }
});

/* ---------- start ---------- */
loadSounds();
$('play').disabled = true;
fetch('game-pairs.json', { cache: 'no-cache' })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(data => {
    PAIRS = data;
    buildCredits();
    $('play').disabled = false;
    deal().slice(0, 2).forEach(loadPair);   // head start for slow internet
  })
  .catch(() => { document.querySelector('.sub').textContent = 'The game could not load. Open it through the preview, not by double-clicking the file.'; });
