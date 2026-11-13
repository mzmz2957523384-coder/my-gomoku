const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 内存中存储所有房间状态
const rooms = new Map();

function createEmptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0));
}

function createRoomState() {
  return {
    board: createEmptyBoard(),
    blackId: null,
    whiteId: null,
    turn: 1, // 1: 黑棋, 2: 白棋
    winner: 0, // 0: 进行中, 1: 黑胜, 2: 白胜, 3: 平局
    lastMove: null,
    moveCount: 0,
  };
}

// 胜负判定算法：检查四个方向是否五子连珠
function checkWin(board, x, y, color) {
  const directions = [
    [1, 0],  // 横向
    [0, 1],  // 纵向
    [1, 1],  // 主对角线
    [1, -1], // 副对角线
  ];

  for (const [dx, dy] of directions) {
    let count = 1;
    // 正向查找
    for (let step = 1; step < 5; step++) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      if (nx < 0 || nx >= 15 || ny < 0 || ny >= 15 || board[ny][nx] !== color) break;
      count++;
    }
    // 反向查找
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
  // 加入房间
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

    // 分配黑白棋槽位
    if (!room.blackId) {
      room.blackId = socket.id;
    } else if (!room.whiteId) {
      room.whiteId = socket.id;
    } else {
      socket.emit('errorMsg', '该房间已满（已有2名玩家）');
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit('joined', { roomId });
    io.to(roomId).emit('gameState', room);
  });

  // 落子
  socket.on('move', ({ x, y }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    // 必须两名玩家都已就位且未结束
    if (!room.blackId || !room.whiteId || room.winner !== 0) return;

    // 校验当前是否是该玩家回合
    const playerColor = socket.id === room.blackId ? 1 : (socket.id === room.whiteId ? 2 : 0);
    if (playerColor === 0 || playerColor !== room.turn) return;

    // 校验坐标合法性与空位
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 15 || y < 0 || y >= 15) return;
    if (room.board[y][x] !== 0) return;

    // 执行落子
    room.board[y][x] = playerColor;
    room.lastMove = { x, y };
    room.moveCount++;

    if (checkWin(room.board, x, y, playerColor)) {
      room.winner = playerColor;
    } else if (room.moveCount === 225) {
      room.winner = 3; // 平局
    } else {
      room.turn = playerColor === 1 ? 2 : 1;
    }

    io.to(roomId).emit('gameState', room);
  });

  // 再来一局（互换黑白）
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

  // 断开连接清理
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    if (room.blackId === socket.id) room.blackId = null;
    if (room.whiteId === socket.id) room.whiteId = null;

    if (!room.blackId && !room.whiteId) {
      rooms.delete(roomId);
    } else {
      // 对手离开后重置棋局，等待新玩家加入
      room.board = createEmptyBoard();
      room.turn = 1;
      room.winner = 0;
      room.lastMove = null;
      room.moveCount = 0;
      io.to(roomId).emit('opponentLeft');
      io.to(roomId).emit('gameState', room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`五子棋服务已启动: http://localhost:${PORT}`);
});