// Wordle-lite: static, no build, PDT-based daily word
(function(){
  'use strict';

  // Minimal solution list (all 5 letters). Cycles by PDT day.
  // Feel free to expand; selection is deterministic per day in LA time.
  const WORDS = [
    'arise','slate','crate','trace','stare','alert','later','alter','irate','adieu',
    'ocean','alone','about','other','which','there','their','first','would','could',
    'house','place','great','might','sound','world','after','thing','where','heart',
    'sweet','laugh','smile','tears','happy','rough','cough','night','light','right',
    'sight','fight','tight','apple','peach','grape','lemon','melon','berry','chair','table',
    'couch','floor','clock','watch','phone','email','paper','angel','devil','saint',
    'pride','bride','bloom','broom','broke','break','wheat','plant','earth','river',
    'ocean','beach','shore','mount','range','plate','globe','north','south','seven',
    'eight','three','score','zebra','tiger','panda','camel','whale','shark','eagle',
    'crowd','spell','spoon','speak','spare','spark','shard','share','shape','shade',
    'proud','cloud','clown','crown','pound','round','bound','found','piano','viola',
    'cello','flute','drums','organ','spice','salty','umami','steam','steal','steel',
    'still','stool','stove','store','stark','stack','stake','stage','stain','brain',
    'drain','grain','train','plane','plain','brand','grand','stand','trend','sugar',
    'knife','sword','shield','armor','arrow','board','brick','stone','metal','glass',
    'fiber','nylon','linen','cotton','wooly','sheep','goose','geese','eaten','eater',
    'baker','maker','joker','wiser','wiser','wiper','riper','rider','raven','river',
    'rainy','sunny','windy','storm','cloud','clear','humid','dryly','moist','aroma',
    'spicy','basil','thyme','cumin','onion','garlic','ginge','minty','cocoa','candy',
    'cookie','brown','black','white','green','bluey','amber','ivory','lemon','mango',
    'olive','pearl','coral','flame','blaze','ember','smoke','sooty','ashen','metal',
    'robot','cable','wires','mouse','track','input','audio','video','codec','pixel',
    'frame','layer','stack','queue','array','chart','graph','table','entry','value',
    'logic','event','state','token','model','agent','error','debug','fixes','tests'
  ].filter(w => w.length === 5);

  // Get Los Angeles (PDT/PST) local date parts and label
  function getLA_YMD(date = new Date()){
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const parts = dtf.formatToParts(date);
    const y = parts.find(p=>p.type==='year').value;
    const m = parts.find(p=>p.type==='month').value;
    const d = parts.find(p=>p.type==='day').value;
    return { y, m, d, label: `${y}-${m}-${d}` };
  }

  function pdtDayIndex(){
    const { y, m, d } = getLA_YMD();
    const todayUTC = Date.UTC(+y, +m-1, +d);
    const baseUTC = Date.UTC(2025, 0, 1); // Anchor: 2025-01-01 LA date
    return Math.floor((todayUTC - baseUTC) / 86400000);
  }

  // Pick today's word deterministically
  const dayIdx = pdtDayIndex();
  const answer = WORDS[((dayIdx % WORDS.length) + WORDS.length) % WORDS.length].toUpperCase();

  // DOM refs
  const boardEl = document.getElementById('board');
  const keyboardEl = document.getElementById('keyboard');
  const toastEl = document.getElementById('toast');
  const resetBtn = document.getElementById('resetBtn');
  const dateLabel = document.getElementById('dateLabel');
  dateLabel.textContent = `PDT date: ${getLA_YMD().label}`;

  // Build board (6 rows x 5 cols)
  const ROWS = 6, COLS = 5;
  const tiles = [];
  for(let r=0;r<ROWS;r++){
    tiles[r] = [];
    for(let c=0;c<COLS;c++){
      const t = document.createElement('div');
      t.className = 'tile';
      t.setAttribute('role','gridcell');
      t.dataset.row = String(r);
      t.dataset.col = String(c);
      boardEl.appendChild(t);
      tiles[r][c] = t;
    }
  }

  // Build on-screen keyboard
  const rows = ['QWERTYUIOP','ASDFGHJKL','ENTERZXCVBNMDEL'];
  rows.forEach((row, idx) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kbd-row';
    rowEl.dataset.row = String(idx+1);
    if(row.startsWith('ENTER')){
      addKey('ENTER', rowEl, true);
      for(const ch of row.slice(5)) addKey(ch, rowEl);
    } else if(row.endsWith('DEL')){
      for(const ch of row.slice(0,-3)) addKey(ch, rowEl);
      addKey('DEL', rowEl, true);
    } else {
      for(const ch of row) addKey(ch, rowEl);
    }
    keyboardEl.appendChild(rowEl);
  });

  function addKey(label, rowEl, wide=false){
    const b = document.createElement('button');
    b.className = 'key' + (wide ? ' wide' : '');
    b.textContent = label;
    b.dataset.key = label;
    b.type = 'button';
    rowEl.appendChild(b);
  }

  // Game state
  let curRow = 0, curCol = 0;
  let done = false;
  const keyboardState = new Map(); // letter -> absent|present|correct

  const storageKey = 'wordle-lite-pdt-' + getLA_YMD().label;
  hydrateFromStorage();

  // Input handlers
  window.addEventListener('keydown', (e) => {
    if(done) return;
    const k = e.key;
    if(k === 'Enter'){ onEnter(); return; }
    if(k === 'Backspace'){ onDel(); return; }
    if(k.length === 1 && /[a-zA-Z]/.test(k)){
      onChar(k.toUpperCase());
    }
  });

  keyboardEl.addEventListener('click', (e) => {
    const t = e.target;
    if(!(t instanceof HTMLElement)) return;
    const key = t.dataset.key;
    if(!key) return;
    if(key === 'ENTER') onEnter();
    else if(key === 'DEL') onDel();
    else onChar(key);
  });

  resetBtn.addEventListener('click', () => {
    localStorage.removeItem(storageKey);
    window.location.reload();
  });

  // Add-to-Home-Screen support and fallback instructions
  const a2hsBtn = document.getElementById('a2hsBtn');
  const installModal = document.getElementById('installModal');
  const installBody = document.getElementById('installBody');
  const installClose = document.getElementById('installClose');
  let deferredPrompt = null;

  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  function showModal(html){
    installBody.innerHTML = html;
    installModal.hidden = false;
    installModal.classList.add('show');
  }
  function hideModal(){
    installModal.classList.remove('show');
    installModal.hidden = true;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    a2hsBtn.style.display = '';
  });

  if(isStandalone){
    a2hsBtn.style.display = 'none';
  } else {
    a2hsBtn.style.display = '';
  }

  a2hsBtn.addEventListener('click', async () => {
    if(deferredPrompt){
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if(outcome === 'accepted') showToast('Install started');
      deferredPrompt = null;
      return;
    }
    if(isiOS){
      showModal(`
        <p>iOS (Safari):</p>
        <p>1) Tap the Share icon (square with arrow).</p>
        <p>2) Choose <b>Add to Home Screen</b>.</p>
        <p>3) Tap Add.</p>
      `);
    } else {
      showModal(`
        <p>Android / other browsers:</p>
        <p>Open the browser menu and choose <b>Add to Home screen</b> or <b>Install app</b>.</p>
        <p>If you don't see it, your browser may not support installing pages.</p>
      `);
    }
  });

  installClose.addEventListener('click', hideModal);

  function onChar(ch){
    if(curCol >= COLS || done) return;
    const t = tiles[curRow][curCol];
    t.textContent = ch;
    t.classList.add('filled');
    curCol++;
  }

  function onDel(){
    if(curCol === 0 || done) return;
    curCol--;
    const t = tiles[curRow][curCol];
    t.textContent = '';
    t.classList.remove('filled');
  }

  function onEnter(){
    if(curCol < COLS){
      showToast('Not enough letters');
      return;
    }
    const guess = getGuess(curRow);
    // Optional: dictionary check could go here. We accept any 5-letter guess.
    const result = evaluateGuess(guess, answer);
    applyResult(curRow, guess, result, true);

    persistAppendGuess(guess);

    if(guess === answer){
      done = true;
      showToast('You got it!');
      persistStatus('won');
      return;
    }

    curRow++;
    curCol = 0;
    if(curRow >= ROWS){
      done = true;
      showToast(`Out of tries — ${answer}`);
      persistStatus('lost');
    }
  }

  function getGuess(r){
    let s = '';
    for(let c=0;c<COLS;c++) s += tiles[r][c].textContent || '';
    return s;
  }

  function evaluateGuess(guess, target){
    const res = Array(COLS).fill('absent');
    const tArr = target.split('');
    const gArr = guess.split('');
    const counts = Object.create(null);
    for(let i=0;i<COLS;i++){
      if(gArr[i] === tArr[i]){
        res[i] = 'correct';
      } else {
        const ch = tArr[i];
        counts[ch] = (counts[ch]||0) + 1;
      }
    }
    for(let i=0;i<COLS;i++){
      if(res[i] === 'correct') continue;
      const ch = gArr[i];
      if(counts[ch] > 0){
        res[i] = 'present';
        counts[ch]--;
      } else {
        res[i] = 'absent';
      }
    }
    return res; // array of 'correct'|'present'|'absent'
  }

  function applyResult(r, guess, result, animate=false){
    const flipMs = 1000; // must match CSS .tile.flip duration
    const midMs = Math.floor(flipMs/2);
    const baseDelay = 300; // delay between tiles
    for(let i=0;i<COLS;i++){
      const t = tiles[r][i];
      const st = result[i];
      const doAt = animate ? i*baseDelay : 0;
      setTimeout(() => {
        t.classList.remove('filled');
        if(animate){
          t.classList.add('flip');
          // At flip midpoint, set the color class for reveal
          setTimeout(() => {
            t.classList.add(st);
          }, midMs);
          t.addEventListener('animationend', function onEnd(){
            t.classList.remove('flip');
            t.removeEventListener('animationend', onEnd);
          });
        } else {
          t.classList.add(st);
        }
      }, doAt);
      // keyboard coloring with priority: correct > present > absent
      const ch = guess[i];
      const prev = keyboardState.get(ch);
      if(prev === 'correct') continue;
      if(prev === 'present' && st === 'absent') continue;
      keyboardState.set(ch, st);
      colorKeyboardKey(ch, st);
    }
  }

  function colorKeyboardKey(ch, st){
    const btn = keyboardEl.querySelector(`[data-key="${ch}"]`);
    if(!btn) return;
    btn.classList.remove('absent','present','correct');
    btn.classList.add(st);
  }

  let toastTimer = null;
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> toastEl.classList.remove('show'), 1500);
  }

  // Persistence (per-PDT-day)
  function hydrateFromStorage(){
    try{
      const raw = localStorage.getItem(storageKey);
      if(!raw) return;
      const data = JSON.parse(raw);
      if(!data || !Array.isArray(data.guesses)) return;
      for(let i=0;i<data.guesses.length && i<ROWS;i++){
        const g = String(data.guesses[i]).toUpperCase();
        for(let c=0;c<COLS;c++){
          tiles[i][c].textContent = g[c] || '';
          if(g[c]) tiles[i][c].classList.add('filled');
        }
        const res = evaluateGuess(g, answer);
        applyResult(i, g, res, false);
        curRow = i+1; curCol = 0;
      }
      if(data.status === 'won' || data.status === 'lost') done = true;
    } catch{}
  }

  function persistAppendGuess(guess){
    const data = readState();
    data.guesses.push(guess);
    writeState(data);
  }

  function persistStatus(status){
    const data = readState();
    data.status = status;
    writeState(data);
  }

  function readState(){
    try{ return JSON.parse(localStorage.getItem(storageKey)) || { guesses: [], status: 'playing' }; }
    catch{ return { guesses: [], status: 'playing' }; }
  }

  function writeState(data){
    try{ localStorage.setItem(storageKey, JSON.stringify(data)); } catch{}
  }

})();
