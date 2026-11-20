const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const ddz = require('./ddz');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
function createEmptyBoard() { return Array.from({ length: 15 }, () => Array(15).fill(0)); }
function createRoomState() {
  return { board: createEmptyBoard(), blackId: null, whiteId: null, turn: 1, winner: 0, lastMove: null, moveCount: 0, scores: {}, draws: 0 };
}
function checkWin(board, x, y, color) {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let count = 1;
    for (let s = 1; s < 5; s++) { const nx = x + dx * s, ny = y + dy * s; if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15 || board[ny][nx] !== color) break; count++; }
    for (let s = 1; s < 5; s++) { const nx = x - dx * s, ny = y - dy * s; if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15 || board[ny][nx] !== color) break; count++; }
    if (count >= 5) return true;
  }
  return false;
}

const ddzRooms = new Map();
const DIFF_NAMES = { easy: '入门AI', medium: '普通AI', hard: '高手AI' };
function createDdzRoom() {
  return {
    seats: [null, null, null], phase: 'waiting', hands: [[], [], []], bottomCards: [],
    turnIdx: 0, dealerIdx: 0, highestBid: 0, highestBidder: -1, bidCount: 0, bids: [null, null, null],
    landlordIdx: -1, lastPlay: null, lastPlaySeat: -1, passCount: 0,
    seatActions: ['', '', ''], seatPlayedCards: [[], [], []], multiplier: 1,
    winnerSide: '', winnerSeat: -1, message: '等待玩家入座，可点击“AI 补位”', aiTimer: null,
  };
}
function buildDdzClientState(room, mySeatIdx) {
  const showAll = room.phase === 'finished';
  return {
    phase: room.phase, mySeatIdx, myHand: mySeatIdx >= 0 ? room.hands[mySeatIdx] : [],
    bottomCards: (room.phase === 'playing' || room.phase === 'finished') ? room.bottomCards : [],
    turnIdx: room.turnIdx, highestBid: room.highestBid, landlordIdx: room.landlordIdx,
    lastPlaySeat: room.lastPlaySeat, lastPlayCards: room.lastPlay ? room.lastPlay.cards : [],
    multiplier: room.multiplier, winnerSide: room.winnerSide, winnerSeat: room.winnerSeat, message: room.message,
    seats: room.seats.map((s, idx) => !s ? null : {
      type: s.type, diff: s.diff, name: s.name, wins: s.wins, score: s.score,
      cardCount: room.hands[idx].length, action: room.seatActions[idx],
      playedCards: room.seatPlayedCards[idx], revealedHand: showAll ? room.hands[idx] : null,
    }),
  };
}
function emitDdzRoom(room) {
  room.seats.forEach((s, idx) => { if (s && s.type === 'human') io.to(s.socketId).emit('ddz:state', buildDdzClientState(room, idx)); });
}
function startDdzRound(room) {
  if (room.aiTimer) clearTimeout(room.aiTimer);
  const deck = ddz.shuffle(ddz.createDeck());
  room.hands = [ddz.sortCards(deck.slice(0, 17)), ddz.sortCards(deck.slice(17, 34)), ddz.sortCards(deck.slice(34, 51))];
  room.bottomCards = ddz.sortCards(deck.slice(51, 54));
  room.phase = 'bidding'; room.turnIdx = room.dealerIdx; room.highestBid = 0; room.highestBidder = -1;
  room.bidCount = 0; room.bids = [null, null, null]; room.landlordIdx = -1; room.lastPlay = null;
  room.lastPlaySeat = -1; room.passCount = 0; room.seatActions = ['', '', '']; room.seatPlayedCards = [[], [], []];
  room.multiplier = 1; room.winnerSide = ''; room.winnerSeat = -1;
  room.message = `发牌完成，请 ${room.seats[room.turnIdx].name} 叫分`;
  emitDdzRoom(room); scheduleDdzAiIfNeeded(room);
}
function becomeLandlord(room, idx, bid) {
  room.landlordIdx = idx; room.multiplier = bid;
  room.hands[idx] = ddz.sortCards([...room.hands[idx], ...room.bottomCards]);
  room.phase = 'playing'; room.turnIdx = idx; room.seatActions = ['', '', '']; room.seatPlayedCards = [[], [], []];
  room.message = `${room.seats[idx].name} 成为地主（${bid}分），请先出牌`;
  emitDdzRoom(room); scheduleDdzAiIfNeeded(room);
}
function handleDdzBid(room, idx, bid) {
  if (room.phase !== 'bidding' || room.turnIdx !== idx) return;
  if (bid !== 0 && (bid <= room.highestBid || bid < 1 || bid > 3)) return;
  room.bids[idx] = bid; room.bidCount++; room.seatActions[idx] = bid === 0 ? '不叫' : `叫 ${bid} 分`;
  if (bid > room.highestBid) { room.highestBid = bid; room.highestBidder = idx; }
  if (bid === 3) { becomeLandlord(room, idx, 3); return; }
  if (room.bidCount >= 3) {
    if (room.highestBidder >= 0) becomeLandlord(room, room.highestBidder, room.highestBid);
    else {
      room.dealerIdx = (room.dealerIdx + 1) % 3; room.message = '无人叫分，重新发牌...';
      emitDdzRoom(room); room.aiTimer = setTimeout(() => startDdzRound(room), 900);
    }
    return;
  }
  room.turnIdx = (idx + 1) % 3; room.message = `请 ${room.seats[room.turnIdx].name} 叫分`;
  emitDdzRoom(room); scheduleDdzAiIfNeeded(room);
}
function handleDdzPlay(room, idx, cardIds) {
  if (room.phase !== 'playing' || room.turnIdx !== idx) return;
  const hand = room.hands[idx], selected = hand.filter(c => cardIds.includes(c.id));
  if (selected.length !== cardIds.length || selected.length === 0) return;
  const analysis = ddz.analyzeCards(selected);
  if (!analysis) return;
  const prevAnalysis = (room.lastPlay && room.lastPlaySeat !== idx) ? room.lastPlay.analysis : null;
  if (!ddz.canBeat(analysis, prevAnalysis)) return;

  room.hands[idx] = hand.filter(c => !cardIds.includes(c.id));
  room.lastPlay = { cards: ddz.sortCards(selected), analysis }; room.lastPlaySeat = idx; room.passCount = 0;
  room.seatActions[idx] = ''; room.seatPlayedCards[idx] = room.lastPlay.cards;
  if (analysis.type === 'BOMB' || analysis.type === 'ROCKET') room.multiplier *= 2;

  if (room.hands[idx].length === 0) {
    room.phase = 'finished'; room.winnerSeat = idx; room.winnerSide = (idx === room.landlordIdx) ? 'landlord' : 'peasants';
    const pts = room.multiplier;
    room.seats.forEach((s, i) => {
      const win = (room.winnerSide === 'landlord') ? (i === room.landlordIdx) : (i !== room.landlordIdx);
      if (win) s.wins++;
      s.score += (i === room.landlordIdx) ? (room.winnerSide === 'landlord' ? pts * 2 : -pts * 2) : (room.winnerSide === 'peasants' ? pts : -pts);
    });
    room.dealerIdx = (room.dealerIdx + 1) % 3;
    room.message = room.winnerSide === 'landlord' ? `🎉 地主 ${room.seats[room.landlordIdx].name} 获胜！` : `🎉 农民阵营获胜！`;
    emitDdzRoom(room); return;
  }

  room.turnIdx = (idx + 1) % 3; room.seatActions[room.turnIdx] = ''; room.seatPlayedCards[room.turnIdx] = [];
  room.message = `轮到 ${room.seats[room.turnIdx].name} 出牌`;
  emitDdzRoom(room); scheduleDdzAiIfNeeded(room);
}
function handleDdzPass(room, idx) {
  if (room.phase !== 'playing' || room.turnIdx !== idx || !room.lastPlay || room.lastPlaySeat === idx) return;
  room.passCount++; room.seatActions[idx] = '不出'; room.seatPlayedCards[idx] = [];
  const nextIdx = (idx + 1) % 3;
  room.turnIdx = nextIdx; room.seatActions[nextIdx] = ''; room.seatPlayedCards[nextIdx] = [];
  if (room.passCount >= 2 || nextIdx === room.lastPlaySeat) {
    room.lastPlay = null; room.passCount = 0; room.seatActions = ['', '', '']; room.seatPlayedCards = [[], [], []];
    room.message = `${room.seats[nextIdx].name} 获得出牌权，请自由出牌`;
  } else room.message = `轮到 ${room.seats[nextIdx].name} 出牌`;
  emitDdzRoom(room); scheduleDdzAiIfNeeded(room);
}
function scheduleDdzAiIfNeeded(room) {
  if (room.phase !== 'bidding' && room.phase !== 'playing') return;
  const curSeat = room.seats[room.turnIdx];
  if (!curSeat || curSeat.type !== 'ai') return;
  room.aiTimer = setTimeout(() => {
    if (room.phase === 'bidding') handleDdzBid(room, room.turnIdx, ddz.chooseAiBid(room.hands[room.turnIdx], room.highestBid, curSeat.diff));
    else if (room.phase === 'playing') {
      const prev = (room.lastPlay && room.lastPlaySeat !== room.turnIdx) ? room.lastPlay.analysis : null;
      const chosen = ddz.chooseAiPlay(room.hands[room.turnIdx], prev, room.lastPlaySeat, room.turnIdx, room.landlordIdx, room.hands.map(h => h.length), curSeat.diff);
      if (chosen && chosen.length > 0) handleDdzPlay(room, room.turnIdx, chosen.map(c => c.id));
      else handleDdzPass(room, room.turnIdx);
    }
  }, 750);
}

io.on('connection', (socket) => {
  socket.on('joinRoom', (rawRoomId) => {
    const roomId = String(rawRoomId || '').trim().slice(0, 20);
    if (!roomId) return socket.emit('errorMsg', '请输入有效的房间号');
    if (!rooms.has(roomId)) rooms.set(roomId, createRoomState());
    const room = rooms.get(roomId);
    if (!room.blackId) room.blackId = socket.id;
    else if (!room.whiteId) room.whiteId = socket.id;
    else return socket.emit('errorMsg', '该房间已满（已有2名玩家）');
    room.scores[socket.id] = 0; socket.join(roomId); socket.data.roomId = roomId;
    socket.emit('joined', { roomId }); io.to(roomId).emit('gameState', room);
  });
  socket.on('move', ({ x, y }) => {
    const roomId = socket.data.roomId, room = rooms.get(roomId);
    if (!room || !room.blackId || !room.whiteId || room.winner !== 0) return;
    const pc = socket.id === room.blackId ? 1 : (socket.id === room.whiteId ? 2 : 0);
    if (pc === 0 || pc !== room.turn || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 15 || y < 0 || y >= 15 || room.board[y][x] !== 0) return;
    room.board[y][x] = pc; room.lastMove = { x, y }; room.moveCount++;
    if (checkWin(room.board, x, y, pc)) { room.winner = pc; room.scores[socket.id] = (room.scores[socket.id] || 0) + 1; }
    else if (room.moveCount === 225) { room.winner = 3; room.draws = (room.draws || 0) + 1; }
    else room.turn = pc === 1 ? 2 : 1;
    io.to(roomId).emit('gameState', room);
  });
  socket.on('restart', () => {
    const roomId = socket.data.roomId, room = rooms.get(roomId);
    if (!room || !room.blackId || !room.whiteId) return;
    const oldBlack = room.blackId; room.board = createEmptyBoard();
    room.blackId = room.whiteId; room.whiteId = oldBlack; room.turn = 1; room.winner = 0; room.lastMove = null; room.moveCount = 0;
    io.to(roomId).emit('gameState', room);
  });
  socket.on('emote', ({ icon, text }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const cleanIcon = String(icon || '').slice(0, 8);
    const cleanText = String(text || '').slice(0, 24);
    if (!cleanIcon) return;
    io.to(roomId).emit('emote', { fromId: socket.id, icon: cleanIcon, text: cleanText });
  });

  socket.on('ddz:joinRoom', ({ roomId: rawRoomId, name }) => {
    const roomId = String(rawRoomId || '').trim().slice(0, 20);
    if (!roomId) return socket.emit('ddz:error', '请输入有效的房间号');
    if (!ddzRooms.has(roomId)) ddzRooms.set(roomId, createDdzRoom());
    const room = ddzRooms.get(roomId), emptyIdx = room.seats.findIndex(s => s === null);
    if (emptyIdx === -1) return socket.emit('ddz:error', '该房间3个座位已满');
    room.seats[emptyIdx] = { type: 'human', socketId: socket.id, name: String(name || '').trim().slice(0, 10) || `玩家${emptyIdx + 1}`, score: 0, wins: 0 };
    socket.data.ddzRoomId = roomId; socket.data.ddzSeatIdx = emptyIdx;
    socket.emit('ddz:joined', { roomId, seatIdx: emptyIdx }); emitDdzRoom(room);
  });
  socket.on('ddz:addAi', ({ diff, fillAll }) => {
    const room = ddzRooms.get(socket.data.ddzRoomId);
    if (!room || room.phase !== 'waiting') return;
    const validDiff = ['easy', 'medium', 'hard'].includes(diff) ? diff : 'medium';
    let added = 0;
    for (let i = 0; i < 3; i++) {
      if (room.seats[i] === null) {
        room.seats[i] = { type: 'ai', diff: validDiff, name: `${DIFF_NAMES[validDiff]}${i + 1}`, score: 0, wins: 0 };
        added++; if (!fillAll) break;
      }
    }
    if (added > 0) { room.message = room.seats.every(s => s !== null) ? '3人已集齐，点击“开始发牌”即可开局！' : '已添加AI补位，还差1位'; emitDdzRoom(room); }
  });
  socket.on('ddz:removeAi', (seatIdx) => {
    const room = ddzRooms.get(socket.data.ddzRoomId);
    if (room && room.phase === 'waiting' && room.seats[seatIdx] && room.seats[seatIdx].type === 'ai') {
      room.seats[seatIdx] = null; room.message = '等待玩家入座，可点击“AI 补位”'; emitDdzRoom(room);
    }
  });
  socket.on('ddz:startGame', () => {
    const room = ddzRooms.get(socket.data.ddzRoomId);
    if (!room || (room.phase !== 'waiting' && room.phase !== 'finished')) return;
    if (room.seats.some(s => s === null)) return socket.emit('ddz:error', '需要凑齐3个人才能发牌（可点“AI 补位”）');
    startDdzRound(room);
  });
  socket.on('ddz:bid', (bid) => { const room = ddzRooms.get(socket.data.ddzRoomId); if (room) handleDdzBid(room, socket.data.ddzSeatIdx, Number(bid)); });
  socket.on('ddz:play', (cardIds) => {
    const room = ddzRooms.get(socket.data.ddzRoomId);
    if (!room || !Array.isArray(cardIds)) return;
    const prevLast = room.lastPlay; handleDdzPlay(room, socket.data.ddzSeatIdx, cardIds);
    if (room.phase === 'playing' && room.turnIdx === socket.data.ddzSeatIdx && room.lastPlay === prevLast) socket.emit('ddz:error', '牌型不合法，或管不上上家的牌');
  });
  socket.on('ddz:pass', () => { const room = ddzRooms.get(socket.data.ddzRoomId); if (room) handleDdzPass(room, socket.data.ddzSeatIdx); });
  socket.on('ddz:hint', () => {
    const room = ddzRooms.get(socket.data.ddzRoomId), idx = socket.data.ddzSeatIdx;
    if (!room || room.phase !== 'playing' || room.turnIdx !== idx) return;
    const prev = (room.lastPlay && room.lastPlaySeat !== idx) ? room.lastPlay.analysis : null;
    const plays = ddz.findBeatingPlays(room.hands[idx], prev);
    if (plays.length === 0) socket.emit('ddz:hintResult', []);
    else { const nb = plays.filter(p => p.analysis.type !== 'BOMB' && p.analysis.type !== 'ROCKET'); socket.emit('ddz:hintResult', (nb.length > 0 ? nb[0] : plays[0]).cards.map(c => c.id)); }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      if (room.blackId === socket.id) room.blackId = null;
      if (room.whiteId === socket.id) room.whiteId = null;
      delete room.scores[socket.id];
      if (!room.blackId && !room.whiteId) rooms.delete(roomId);
      else {
        room.board = createEmptyBoard(); room.turn = 1; room.winner = 0; room.lastMove = null; room.moveCount = 0; room.draws = 0;
        if (room.blackId) room.scores[room.blackId] = 0;
        if (room.whiteId) room.scores[room.whiteId] = 0;
        io.to(roomId).emit('opponentLeft'); io.to(roomId).emit('gameState', room);
      }
    }
    const ddzId = socket.data.ddzRoomId, seatIdx = socket.data.ddzSeatIdx;
    if (ddzId && ddzRooms.has(ddzId)) {
      const room = ddzRooms.get(ddzId);
      if (room.aiTimer) clearTimeout(room.aiTimer);
      if (room.seats[seatIdx] && room.seats[seatIdx].socketId === socket.id) room.seats[seatIdx] = null;
      if (!room.seats.some(s => s && s.type === 'human')) ddzRooms.delete(ddzId);
      else {
        room.phase = 'waiting'; room.hands = [[], [], []]; room.bottomCards = [];
        room.seatActions = ['', '', '']; room.seatPlayedCards = [[], [], []];
        room.message = '有玩家离开，已回到等待状态（可点AI补位）'; emitDdzRoom(room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`游戏服务已启动: http://localhost:${PORT}`));
