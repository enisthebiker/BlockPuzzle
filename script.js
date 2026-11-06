(() => {
  'use strict';

  const SIZE = 8;
  const SHAPES = [
    [[0,0]], [[0,0],[1,0]], [[0,0],[1,0],[2,0]], [[0,0],[0,1],[0,2]],
    [[0,0],[1,0],[0,1],[1,1]], [[0,0],[1,0],[2,0],[3,0]], [[0,0],[0,1],[0,2],[0,3]],
    [[0,0],[1,0],[2,0],[1,1]], [[0,0],[0,1],[1,1],[2,1]], [[0,0],[1,0],[1,1],[1,2]],
    [[0,0],[1,0],[2,0],[0,1]], [[0,0],[1,0],[0,1],[0,2]], [[0,0],[1,0],[2,0],[2,1]],
    [[1,0],[0,1],[1,1],[2,1],[1,2]], [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]],
    [[0,0],[1,0],[0,1],[1,1],[0,2],[1,2]], [[0,0],[0,1],[1,1],[1,2]], [[1,0],[1,1],[0,1],[0,2]]
  ];
  const CARD_TYPES = [
    { id: 'swap', icon: '↔', name: 'Değiştir' },
    { id: 'singleClear', icon: '−1', name: 'Tek hücre sil' },
    { id: 'areaClear', icon: '▦', name: 'Alan temizle' },
    { id: 'doubleScore', icon: '×2', name: 'Çift puan' },
    { id: 'comboGuard', icon: '◇', name: 'Combo koru' },
    { id: 'crossBonus', icon: '✣', name: 'Çapraz +2' },
    { id: 'refresh', icon: '⟳', name: 'Parçaları yenile' }
  ];
  const boardEl = document.querySelector('#board');
  const trayEl = document.querySelector('#pieceTray');
  const scoreEl = document.querySelector('#score');
  const comboEl = document.querySelector('#combo');
  const hintEl = document.querySelector('#hint');
  const rotateButton = document.querySelector('#rotateButton');
  const soundButton = document.querySelector('#soundToggle');
  const modal = document.querySelector('#gameOver');
  const cardTrayEl = document.querySelector('#specialCardTray');
  const cardProgressEl = document.querySelector('#cardProgress');
  const cardMessageEl = document.querySelector('#cardMessage');
  const state = {
    board: [], pieces: [], score: 0, combo: 0, selected: -1, drag: null,
    audio: null, muted: localStorage.getItem('blockPuzzleMuted') === 'true', gameOver: false,
    cardInventory: Object.fromEntries(CARD_TYPES.map(card => [card.id, 0])),
    linesTowardCard: 0, activeCard: null,
    effects: { doubleScore: false, comboGuard: false, crossBonus: false }
  };
  const cells = [];

  function rotate(shape) {
    const rotated = shape.map(([x, y]) => [-y, x]);
    const minX = Math.min(...rotated.map(([x]) => x));
    const minY = Math.min(...rotated.map(([, y]) => y));
    return normalize(rotated.map(([x, y]) => [x - minX, y - minY]));
  }
  function normalize(shape) {
    const minX = Math.min(...shape.map(([x]) => x));
    const minY = Math.min(...shape.map(([, y]) => y));
    return shape.map(([x, y]) => [x - minX, y - minY]);
  }
  function dimensions(shape) {
    return { cols: Math.max(...shape.map(([x]) => x)) + 1, rows: Math.max(...shape.map(([, y]) => y)) + 1 };
  }
  function initBoard() {
    boardEl.replaceChildren();
    cells.length = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell'; cell.setAttribute('role', 'gridcell');
      cell.dataset.index = String(i);
      boardEl.append(cell); cells.push(cell);
    }
  }
  function randomShape() { return SHAPES[Math.floor(Math.random() * SHAPES.length)].map(([x,y]) => [x,y]); }
  function newPieces() {
    state.pieces = Array.from({ length: 3 }, () => ({ shape: randomShape(), used: false }));
    state.selected = -1;
    renderPieces();
    checkGameOver();
  }
  function renderPieces() {
    trayEl.replaceChildren();
    state.pieces.forEach((piece, index) => {
      const slot = document.createElement('button');
      slot.type = 'button'; slot.className = 'piece-slot';
      slot.setAttribute('aria-label', piece.used ? 'Kullanılmış parça' : `Parça ${index + 1} seç`);
      if (piece.used) slot.classList.add('used');
      if (state.selected === index) slot.classList.add('selected');
      const { cols, rows } = dimensions(piece.shape);
      const grid = document.createElement('span'); grid.className = 'piece-grid';
      grid.style.setProperty('--cols', cols); grid.style.setProperty('--rows', rows);
      const occupied = new Set(piece.shape.map(([x,y]) => `${x},${y}`));
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const block = document.createElement('i'); block.className = `mini-cell${occupied.has(`${x},${y}`) ? '' : ' empty'}`; grid.append(block);
      }
      slot.append(grid);
      slot.addEventListener('click', () => {
        if (state.activeCard === 'swap') { replaceSelectedPiece(index); return; }
        if (!state.activeCard && !piece.used) selectPiece(index);
      });
      slot.addEventListener('pointerdown', event => startDrag(event, index));
      trayEl.append(slot);
    });
    rotateButton.disabled = state.selected < 0 || state.pieces[state.selected]?.used;
    renderSpecialCards();
  }
  function selectPiece(index) {
    if (state.gameOver || state.activeCard || state.pieces[index].used) return;
    state.selected = index; renderPieces(); playTone(420, .055, 'sine', .045);
    hintEl.textContent = 'Tahtada uygun bir konum seç.';
    clearPreview();
  }
  function canPlace(shape, x, y) {
    return shape.every(([dx,dy]) => {
      const cx = x + dx, cy = y + dy;
      return cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && !state.board[cy][cx];
    });
  }
  function clearPreview() { cells.forEach(cell => cell.classList.remove('preview-valid', 'preview-invalid')); }
  function updatePreview(x, y) {
    clearPreview();
    if (state.selected < 0 || state.pieces[state.selected]?.used) return;
    const shape = state.pieces[state.selected].shape;
    const valid = canPlace(shape, x, y);
    shape.forEach(([dx,dy]) => {
      const cx=x+dx, cy=y+dy;
      if (cx>=0 && cx<SIZE && cy>=0 && cy<SIZE) cells[cy*SIZE+cx].classList.add(valid ? 'preview-valid' : 'preview-invalid');
    });
  }
  function boardCellAt(clientX, clientY) {
    const rect = boardEl.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(boardEl).gap) || 0;
    const cellSize = (rect.width - gap * (SIZE - 1)) / SIZE;
    const x = Math.floor((clientX - rect.left) / (cellSize + gap));
    const y = Math.floor((clientY - rect.top) / (cellSize + gap));
    return { x, y };
  }
  function startDrag(event, index) {
    if (state.gameOver || state.activeCard || state.pieces[index].used || event.button !== 0) return;
    event.preventDefault(); selectPiece(index);
    state.drag = { index, pointerId: event.pointerId };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp, { once: true });
    document.addEventListener('pointercancel', cancelDrag, { once: true });
  }
  function onPointerMove(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    const { x, y } = boardCellAt(event.clientX, event.clientY); updatePreview(x, y);
  }
  function onPointerUp(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    const { x, y } = boardCellAt(event.clientX, event.clientY);
    const index = state.drag.index; state.drag = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', cancelDrag);
    clearPreview();
    attemptPlace(index, x, y);
  }
  function cancelDrag() {
    state.drag = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', cancelDrag);
    clearPreview();
  }
  function attemptPlace(index, x, y) {
    if (state.gameOver || state.pieces[index]?.used) return false;
    const piece = state.pieces[index];
    if (!canPlace(piece.shape, x, y)) { hintEl.textContent = 'Buraya yerleştirilemiyor. Başka bir konum dene.'; playTone(150,.08,'sine',.025); return false; }
    piece.shape.forEach(([dx,dy]) => {
      const cell = cells[(y+dy)*SIZE+x+dx];
      state.board[y+dy][x+dx] = true;
      cell.classList.remove('preview-valid', 'preview-invalid');
      cell.classList.add('filled');
    });
    piece.used = true; state.selected = -1; renderPieces(); playTone(300,.07,'triangle',.045);
    const completedRows = [];
    for (let row=0; row<SIZE; row++) if (state.board[row].every(Boolean)) completedRows.push(row);
    const completedCols = [];
    for (let col=0; col<SIZE; col++) if (state.board.every(row => row[col])) completedCols.push(col);
    const lineCount = completedRows.length + completedCols.length;
    if (lineCount) {
      state.combo++;
      let movePoints = lineCount * state.combo;
      const moveNotes = [];
      if (state.effects.doubleScore) { movePoints *= 2; state.effects.doubleScore = false; moveNotes.push('Çift puan uygulandı'); }
      if (state.effects.crossBonus && completedRows.length && completedCols.length) {
        movePoints += 2; state.effects.crossBonus = false; moveNotes.push('Çapraz bonus +2');
      }
      state.score += movePoints;
      const cardRewards = awardCardsForLines(lineCount);
      const clearing = new Set();
      completedRows.forEach(row => { for (let col=0;col<SIZE;col++) clearing.add(row*SIZE+col); });
      completedCols.forEach(col => { for (let row=0;row<SIZE;row++) clearing.add(row*SIZE+col); });
      clearing.forEach(cellIndex => cells[cellIndex].classList.add('clearing'));
      completedRows.forEach(row => state.board[row].fill(false));
      completedCols.forEach(col => state.board.forEach(row => { row[col] = false; }));
      setTimeout(() => {
        clearing.forEach(cellIndex => {
          cells[cellIndex].classList.remove('clearing');
          const row = Math.floor(cellIndex / SIZE), col = cellIndex % SIZE;
          cells[cellIndex].classList.toggle('filled', state.board[row][col]);
        });
      }, 210);
      playTone(580 + lineCount * 75,.16,'sine',.045);
      const lineMessage = [`${lineCount} çizgi temizlendi · ×${state.combo} combo`, ...moveNotes];
      if (cardRewards.awarded.length) lineMessage.push(`Kart kazandın: ${cardRewards.awarded.map(card => card.name).join(', ')}`);
      if (cardRewards.skipped) lineMessage.push('Envanter dolu; ödül atlandı');
      hintEl.textContent = lineMessage.join(' · ');
    } else {
      if (state.effects.comboGuard) { state.effects.comboGuard = false; hintEl.textContent = 'Güzel yerleştirme. Combo korundu.'; }
      else { state.combo = 0; hintEl.textContent = 'Güzel yerleştirme. Sıradaki parçayı seç.'; }
    }
    updateScore();
    renderSpecialCards();
    if (state.pieces.every(item => item.used)) newPieces(); else checkGameOver();
    return true;
  }
  function inventorySize() {
    return Object.values(state.cardInventory).reduce((total, count) => total + count, 0);
  }

  function cardEffectIsActive(cardId) {
    return cardId === 'doubleScore' ? state.effects.doubleScore
      : cardId === 'comboGuard' ? state.effects.comboGuard
      : cardId === 'crossBonus' ? state.effects.crossBonus : false;
  }

  function cardCanBeUsed(cardId) {
    if (state.gameOver || state.cardInventory[cardId] < 1 || cardEffectIsActive(cardId)) return false;
    if (cardId === 'swap' || cardId === 'refresh') return state.pieces.some(piece => !piece.used);
    if (cardId === 'singleClear' || cardId === 'areaClear') return state.board.some(row => row.some(Boolean));
    return true;
  }

  function renderSpecialCards() {
    if (!cardTrayEl) return;
    cardTrayEl.replaceChildren();
    const total = inventorySize();
    cardProgressEl.textContent = `${state.linesTowardCard}/10 çizgi · ${total}/3`;
    const activeEffects = CARD_TYPES.filter(card => cardEffectIsActive(card.id)).map(card => card.name);
    const actionText = state.activeCard === 'swap' ? 'Değiştirilecek kullanılmamış parçayı seç.'
      : state.activeCard === 'singleClear' ? 'Silinecek dolu hücreyi seç.'
      : state.activeCard === 'areaClear' ? 'Temizlenecek alanın merkezini seç.' : '';
    cardMessageEl.textContent = actionText || (activeEffects.length ? `Aktif: ${activeEffects.join(' · ')}` : 'Her 10 çizgide bir kart kazan.');

    CARD_TYPES.forEach(card => {
      const count = state.cardInventory[card.id];
      const selected = state.activeCard === card.id;
      const effectActive = cardEffectIsActive(card.id);
      const usable = cardCanBeUsed(card.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `special-card${selected ? ' is-selected' : ''}${effectActive ? ' is-effect-active' : ''}`;
      button.disabled = state.gameOver || (!selected && !usable);
      button.setAttribute('aria-label', `${card.name}, elde ${count}`);
      button.setAttribute('aria-pressed', String(selected || effectActive));
      const top = document.createElement('span'); top.className = 'card-topline';
      const icon = document.createElement('span'); icon.className = 'card-icon'; icon.textContent = card.icon;
      const quantity = document.createElement('span'); quantity.className = 'card-count'; quantity.textContent = `×${count}`;
      top.append(icon, quantity);
      const name = document.createElement('span'); name.className = 'card-name'; name.textContent = card.name;
      const status = document.createElement('span'); status.className = 'card-state';
      status.textContent = selected ? 'Seçili' : effectActive ? 'Etkin' : usable ? 'Hazır' : count ? 'Kullanılamaz' : 'Yok';
      button.append(top, name, status);
      button.addEventListener('click', () => activateCard(card.id));
      cardTrayEl.append(button);
    });
  }

  function consumeCard(cardId) {
    state.cardInventory[cardId]--;
  }

  function awardCardsForLines(lineCount) {
    const result = { awarded: [], skipped: 0 };
    state.linesTowardCard += lineCount;
    while (state.linesTowardCard >= 10) {
      state.linesTowardCard -= 10;
      if (inventorySize() >= 3) { result.skipped++; continue; }
      const card = CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
      state.cardInventory[card.id]++;
      result.awarded.push(card);
    }
    renderSpecialCards();
    return result;
  }

  function cancelCardSelection() {
    if (!state.activeCard) return;
    state.activeCard = null;
    renderSpecialCards();
    hintEl.textContent = 'Kart işlemi iptal edildi. Kart harcanmadı.';
  }

  function activateCard(cardId) {
    if (state.gameOver || state.drag) return;
    if (state.activeCard === cardId) { cancelCardSelection(); return; }
    if (state.activeCard) cancelCardSelection();
    if (!cardCanBeUsed(cardId)) return;
    state.selected = -1;
    clearPreview();
    renderPieces();

    if (cardId === 'swap' || cardId === 'singleClear' || cardId === 'areaClear') {
      state.activeCard = cardId;
      renderSpecialCards();
      hintEl.textContent = cardId === 'swap' ? 'Değiştirilecek kullanılmamış parçaya tıkla.'
        : cardId === 'singleClear' ? 'Silmek için dolu bir hücreye tıkla.' : '3×3 alanı temizlemek için merkez hücreye tıkla.';
      return;
    }

    if (cardId === 'refresh') {
      state.pieces = state.pieces.map(piece => piece.used ? piece : { shape: randomShape(), used: false });
      consumeCard(cardId);
      renderPieces();
      hintEl.textContent = 'Kullanılmamış parçalar yenilendi.';
      checkGameOver();
      return;
    }

    state.effects[cardId] = true;
    consumeCard(cardId);
    renderSpecialCards();
    hintEl.textContent = cardId === 'doubleScore' ? 'Çift puan aktif: sonraki çizgi temizleme puanı iki katına çıkar.'
      : cardId === 'comboGuard' ? 'Combo koruma aktif: sonraki çizgi temizlenmeyen hamlede combo korunur.'
      : 'Çapraz bonus aktif: yatay ve dikey çizgi birlikte temizlenirse +2 puan.';
  }

  function shapeSignature(shape) {
    return shape.map(([x, y]) => [x, y]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([x, y]) => `${x},${y}`).join(';');
  }

  function sameShapeUnderRotation(first, second) {
    let candidate = second;
    for (let turn = 0; turn < 4; turn++) {
      if (shapeSignature(first) === shapeSignature(candidate)) return true;
      candidate = rotate(candidate);
    }
    return false;
  }

  function replaceSelectedPiece(index) {
    const piece = state.pieces[index];
    if (state.activeCard !== 'swap' || !piece || piece.used) return;

    const choices = SHAPES.filter(shape => !sameShapeUnderRotation(shape, piece.shape));
    piece.shape = choices[Math.floor(Math.random() * choices.length)].map(([x, y]) => [x, y]);
    consumeCard('swap');
    state.activeCard = null;
    state.selected = -1;
    renderPieces();
    hintEl.textContent = 'Parça değiştirildi.';
    checkGameOver();
  }

  function clearSpecialCells(indices) {
    indices.forEach(index => {
      const row = Math.floor(index / SIZE), col = index % SIZE;
      state.board[row][col] = false;
      cells[index].classList.remove('preview-valid', 'preview-invalid');
      cells[index].classList.add('clearing');
    });
    setTimeout(() => indices.forEach(index => {
      const row = Math.floor(index / SIZE), col = index % SIZE;
      cells[index].classList.remove('clearing');
      cells[index].classList.toggle('filled', state.board[row][col]);
    }), 210);
  }

  function handleSpecialCardTarget(index) {
    const row = Math.floor(index / SIZE), col = index % SIZE;
    if (state.activeCard === 'swap') { hintEl.textContent = 'Kartı kullanmak için kullanılmamış parçaya tıkla.'; return; }
    if (state.activeCard === 'singleClear') {
      if (!state.board[row][col]) { hintEl.textContent = 'Bu hücre boş. Kart harcanmadı; dolu hücre seç.'; return; }
      clearSpecialCells([index]);
      consumeCard('singleClear'); state.activeCard = null;
      renderSpecialCards(); hintEl.textContent = 'Tek hücre silindi.';
      return;
    }
    if (state.activeCard === 'areaClear') {
      const startX = col - 1;
      const startY = row - 1;
      const targets = [];
      for (let y = Math.max(0, startY); y < Math.min(SIZE, startY + 3); y++) for (let x = Math.max(0, startX); x < Math.min(SIZE, startX + 3); x++) {
        if (state.board[y][x]) targets.push(y * SIZE + x);
      }
      if (!targets.length) { hintEl.textContent = 'Bu alanda dolu hücre yok. Kart harcanmadı; başka merkez seç.'; return; }
      clearSpecialCells(targets);
      consumeCard('areaClear'); state.activeCard = null;
      renderSpecialCards(); hintEl.textContent = `${targets.length} hücrelik alan temizlendi.`;
    }
  }
  function updateScore() { scoreEl.textContent = String(state.score); comboEl.textContent = `×${state.combo}`; }
  function checkGameOver() {
    if (state.pieces.length !== 3 || state.pieces.some(piece => !piece) || state.gameOver) return;
    const hasMove = state.pieces.some(piece => {
      if (piece.used) return false;
      let shape = piece.shape.map(([x, y]) => [x, y]);
      for (let orientation = 0; orientation < 4; orientation++) {
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
          if (canPlace(shape, x, y)) return true;
        }
        shape = rotate(shape);
      }
      return false;
    });
    if (!hasMove) {
      state.gameOver = true;
      document.querySelector('#finalScore').textContent = String(state.score);
      modal.classList.remove('hidden');
      document.querySelector('#playAgainButton').focus();
      renderSpecialCards();
    }
  }
  function rotateSelected() {
    if (state.selected < 0 || state.pieces[state.selected]?.used || state.gameOver) return;
    state.pieces[state.selected].shape = rotate(state.pieces[state.selected].shape);
    clearPreview();
    renderPieces(); playTone(500,.06,'sine',.04);
    hintEl.textContent = 'Parça döndürüldü.';
  }
  function resetGame() {
    if (state.drag) cancelDrag();
    state.board = Array.from({length:SIZE}, () => Array(SIZE).fill(false));
    state.score=0; state.combo=0; state.selected=-1; state.gameOver=false; state.drag=null;
    state.cardInventory = Object.fromEntries(CARD_TYPES.map(card => [card.id, 0]));
    state.linesTowardCard = 0; state.activeCard = null;
    state.effects = { doubleScore: false, comboGuard: false, crossBonus: false };
    cells.forEach(cell => cell.classList.remove('filled','clearing','preview-valid','preview-invalid'));
    updateScore();
    renderSpecialCards(); modal.classList.add('hidden'); hintEl.textContent='Bir parça seç ve tahtaya yerleştir.';
    newPieces();
  }
  function ensureAudio() {
    if (!state.audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      state.audio = new AudioContext();
      state.audio.master = state.audio.createGain(); state.audio.master.gain.value = state.muted ? 0 : .90; state.audio.master.connect(state.audio.destination);
      startMusic();
    }
    if (state.audio.state === 'suspended') state.audio.resume();
  }
  function playTone(freq, duration, type='sine', volume=.04) {
    if (state.muted) return; ensureAudio(); if (!state.audio) return;
    const ctx=state.audio, osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.type=type; osc.frequency.setValueAtTime(freq,ctx.currentTime);
    gain.gain.setValueAtTime(.0001,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(volume * 1.3,ctx.currentTime+.012); gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+duration);
    osc.connect(gain); gain.connect(ctx.master); osc.start(); osc.stop(ctx.currentTime+duration+.02);
  }
  function startMusic() {
    const ctx=state.audio;
    const notes=[220,261.63,329.63,293.66,196,246.94,293.66,261.63];
    const playNote = () => {
      if (!state.audio || state.muted) return;
      const now=ctx.currentTime, note=notes[Math.floor(Date.now()/3500)%notes.length];
      const osc=ctx.createOscillator(), gain=ctx.createGain(), filter=ctx.createBiquadFilter();
      osc.type='sine'; osc.frequency.value=note; filter.type='lowpass'; filter.frequency.value=650;
      gain.gain.setValueAtTime(.0001,now); gain.gain.linearRampToValueAtTime(.024,now+1.1); gain.gain.linearRampToValueAtTime(.0001,now+3.2);
      osc.connect(filter); filter.connect(gain); gain.connect(ctx.master); osc.start(now); osc.stop(now+3.3);
    };
    if (!state.musicTimer) { playNote(); state.musicTimer=setInterval(playNote,3500); }
  }
  function toggleSound() {
    state.muted=!state.muted; localStorage.setItem('blockPuzzleMuted',String(state.muted));
    soundButton.setAttribute('aria-pressed',String(!state.muted));
    soundButton.setAttribute('aria-label',state.muted?'Sesi aç':'Sesi kapat');
    soundButton.innerHTML = state.muted ? '♫ <span>Ses kapalı</span>' : '♫ <span>Ses açık</span>';
    if (!state.muted) { ensureAudio(); playTone(440,.08,'sine',.035); }
    else if (state.audio) state.audio.master.gain.setTargetAtTime(0,state.audio.currentTime,.04);
    if (!state.muted && state.audio) state.audio.master.gain.setTargetAtTime(.42,state.audio.currentTime,.06);
  }

  initBoard();
  soundButton.setAttribute('aria-pressed',String(!state.muted));
  soundButton.setAttribute('aria-label',state.muted?'Sesi aç':'Sesi kapat');
  soundButton.innerHTML = state.muted ? '♫ <span>Ses kapalı</span>' : '♫ <span>Ses açık</span>';
  soundButton.addEventListener('pointerdown', ensureAudio, { once: true });
  soundButton.addEventListener('click', toggleSound);
  rotateButton.addEventListener('click', rotateSelected);
  document.querySelector('#restartButton').addEventListener('click', resetGame);
  document.querySelector('#playAgainButton').addEventListener('click', resetGame);
  const handleWheelRotate = event => {
    if (state.selected < 0 || state.drag || event.ctrlKey) return;
    if (event.deltaY === 0) return;
    rotateSelected();
  };
  boardEl.addEventListener('wheel', handleWheelRotate, { passive: true });
  trayEl.addEventListener('wheel', handleWheelRotate, { passive: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.activeCard) { event.preventDefault(); cancelCardSelection(); return; }
    if (event.key.toLowerCase() === 'r' && !event.repeat) rotateSelected();
  });
  boardEl.addEventListener('click', event => {
    if (state.drag) return;
    const cell = event.target.closest('.cell');
    if (!cell) return;
    const index = Number(cell.dataset.index);
    if (state.activeCard) { handleSpecialCardTarget(index); return; }
    if (state.selected < 0) return;
    attemptPlace(state.selected, index % SIZE, Math.floor(index / SIZE));
  });
  boardEl.addEventListener('pointermove', event => {
    if (state.drag || state.selected<0) return;
    const {x,y}=boardCellAt(event.clientX,event.clientY); updatePreview(x,y);
  });
  boardEl.addEventListener('pointerleave', clearPreview);
  resetGame();
})();









