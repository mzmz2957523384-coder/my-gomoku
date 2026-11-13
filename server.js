const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function createEmptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0));
}

function createRoomState() {
  return {
    board: createEmptyBoard(),
    blackId: null,
    whiteId: null,
    turn: 1,
    winner: 0,
    lastMove: null,
    moveCount: 0,
    scores: {}, // 按玩家 socket.id 记录各自胜场
    draws: 0,
  };
}

function checkWin(board, x, y, color) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  for (const [dx, dy] of directions) {
    let count = 1;
    for (let step = 1; step < 5; step++) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15 || board[ny][nx] !== color) break;
      count++;
    }
    for (let step = 1; step < 5; step++) {
      const nx = x - dx * step;
      const ny = y - dy * step;
      if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15 || board[ny][nx] !== color) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', (rawRoomId) => {
    const roomId = String(rawRoomId || '').trim().slice(0, 20);
    if (!roomId) {
      socket.emit('errorMsg', '请输入有效的房间号');
      return;
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, createRoomState());
    }
    const room = rooms.get(roomId);

    if (!room.blackId) {
      room.blackId = socket.id;
    } else if (!room.whiteId) {
      room.whiteId = socket.id;
    } else {
      socket.emit('errorMsg', '该房间已满（已有2名玩家）');
      return;
    }

    room.scores[socket.id] = 0;
    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit('joined', { roomId });
    io.to(roomId).emit('gameState', room);
  });

  socket.on('move', ({ x, y }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    if (!room.blackId || !room.whiteId || room.winner !== 0) return;

    const playerColor = socket.id === room.blackId ? 1 : (socket.id === room.whiteId ? 2 : 0);
    if (playerColor === 0 || playerColor !== room.turn) return;

    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 15 || y < 0 || y >= 15) return;
    if (room.board[y][x] !== 0) return;

    room.board[y][x] = playerColor;
    room.lastMove = { x, y };
    room.moveCount++;

    if (checkWin(room.board, x, y, playerColor)) {
      room.winner = playerColor;
      room.scores[socket.id] = (room.scores[socket.id] || 0) + 1;
    } else if (room.moveCount === 225) {
      room.winner = 3;
      room.draws = (room.draws || 0) + 1;
    } else {
      room.turn = playerColor === 1 ? 2 : 1;
    }

    io.to(roomId).emit('gameState', room);
  });

  socket.on('restart', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    if (!room.blackId || !room.whiteId) return;

    const oldBlack = room.blackId;
    const oldWhite = room.whiteId;

    room.board = createEmptyBoard();
    room.blackId = oldWhite;
    room.whiteId = oldBlack;
    room.turn = 1;
    room.winner = 0;
    room.lastMove = null;
    room.moveCount = 0;

    io.to(roomId).emit('gameState', room);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    if (room.blackId === socket.id) room.blackId = null;
    if (room.whiteId === socket.id) room.whiteId = null;
    delete room.scores[socket.id];

    if (!room.blackId && !room.whiteId) {
      rooms.delete(roomId);
    } else {
      // 换新对手时重置棋局与比分
      room.board = createEmptyBoard();
      room.turn = 1;
      room.winner = 0;
      room.lastMove = null;
      room.moveCount = 0;
      room.draws = 0;
      if (room.blackId) room.scores[room.blackId] = 0;
      if (room.whiteId) room.scores[room.whiteId] = 0;
      io.to(roomId).emit('opponentLeft');
      io.to(roomId).emit('gameState', room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`五子棋服务已启动: http://localhost:${PORT}`);
});
