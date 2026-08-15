const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

// ==================== 游戏常量 ====================
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const KILL_COOLDOWN = 25;
const KILL_RANGE = 50;
const VENT_RANGE = 30;
const VENT_COOLDOWN = 15;
const SABOTAGE_COOLDOWN = 90;
const MEETING_DURATION = 60;
const TACTICAL_WINDOW = 5;
const EMERGENCY_MAX = 2;
const AVATAR_EMOJIS = ['🤖','👾','🧬','💀','👽','🦾','🦿','🎃','🤠','👻','🧞‍♂️','🧜‍♂️','🧚‍♀️','🦋','🔥','🍔'];

const COMPANION_IDS = ['nightingale','pugelisi','gouwen','yuyu','hewal','xiu','luolan','yuansheng','fengye','yezhu'];

const ROOM_LAYOUTS = [
  {x: 400, y: 300, w: 200, h: 160, name: '餐厅', type: 'cafeteria'},
  {x: 150, y: 150, w: 200, h: 160, name: '武器舱', type: 'weapons'},
  {x: 650, y: 150, w: 200, h: 160, name: '氧气舱', type: 'o2'},
  {x: 150, y: 450, w: 200, h: 160, name: '驾驶舱', type: 'navigation'},
  {x: 650, y: 450, w: 200, h: 160, name: '主控台', type: 'admin'},
  {x: 400, y: 550, w: 200, h: 160, name: '仓库', type: 'storage'},
  {x: 50, y: 300, w: 200, h: 160, name: '电力间', type: 'electrical'},
  {x: 750, y: 300, w: 200, h: 160, name: '医疗间', type: 'medbay'}
];

const CORRIDORS = [
  {from: 0, to: 1}, {from: 0, to: 2}, {from: 0, to: 3},
  {from: 0, to: 4}, {from: 0, to: 5}, {from: 1, to: 6},
  {from: 3, to: 6}, {from: 2, to: 7}, {from: 4, to: 7},
  {from: 5, to: 6}, {from: 5, to: 7}
];

const TASK_TYPES = ['clean_fan', 'swipe_card', 'wiring', 'password', 'calibrate', 'upload'];

// ==================== 游戏状态存储 ====================
const rooms = {}; // roomId -> roomData
const socketToRoom = {}; // socketId -> roomId

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createMapData() {
  const rooms = JSON.parse(JSON.stringify(ROOM_LAYOUTS));
  const tasks = [];
  rooms.forEach((room, idx) => {
    const numTasks = 1 + Math.floor(Math.random() * 2);
    for (let t = 0; t < numTasks; t++) {
      const task = {
        id: `task_${idx}_${t}`,
        type: TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)],
        x: room.x + 30 + Math.random() * (room.w - 60),
        y: room.y + 30 + Math.random() * (room.h - 60),
        completed: false,
        room: room.name,
        roomId: idx
      };
      room.tasks.push(task);
      tasks.push(task);
    }
  });

  const vents = [];
  for (let i = 0; i < 8; i++) {
    const room = rooms[i % rooms.length];
    vents.push({
      id: i,
      x: room.x + 20 + Math.random() * (room.w - 40),
      y: room.y + 20 + Math.random() * (room.h - 40),
      roomId: room.id || i
    });
  }

  const emergencyBtn = {
    x: rooms[0].x + rooms[0].w / 2,
    y: rooms[0].y + rooms[0].h / 2,
    used: 0,
    max: EMERGENCY_MAX
  };

  return { rooms, corridors: CORRIDORS, vents, emergencyBtn, width: 950, height: 750 };
}

function createRoom(roomId, hostId) {
  return {
    id: roomId,
    hostId: hostId,
    state: 'lobby', // lobby, partner_select, playing, meeting, tactical, gameover
    players: {},
    playerOrder: [],
    mapData: null,
    tasks: [],
    totalPublicTasks: 0,
    completedPublicTasks: 0,
    meetingTimer: null,
    tacticalTimer: null,
    votes: {},
    chatHistory: { living: [], ghost: [] },
    impostorChatHistory: [],
    sabotage: { active: false, type: null, endTime: null },
    lastSabotageTime: 0,
    killCooldowns: {},
    ventCooldowns: {},
    abilityUses: {},
    traps: [],
    timeStopActive: false,
    timeStopUser: null,
    gameLoopInterval: null,
    partnerSelections: {},
    eliminatedPlayers: [],
    emergencyUses: 0
  };
}

function createPlayer(socketId, name, avatar) {
  return {
    id: socketId,
    name: name || '玩家',
    avatar: avatar || AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)],
    role: 'crew',
    partner: null,
    alive: true,
    x: 400,
    y: 300,
    charge: 0,
    voted: false,
    spectator: false,
    eliminated: false,
    ghost: false,
    inVent: false,
    ventId: null,
    disguisedAs: null,
    barrierUsed: false,
    resurrectUsed: false,
    controlAttackUsed: false,
    trapUsed: false,
    righteousKillUsed: false,
    disguiseUses: 2,
    voteSwapUses: 2,
    invisUses: 3,
    deathTransferUsed: false,
    connected: true
  };
}

// ==================== 辅助函数 ====================
function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function getAlivePlayers(room) {
  return Object.values(room.players).filter(p => p.alive && !p.spectator);
}

function getAliveCrew(room) {
  return Object.values(room.players).filter(p => p.alive && !p.spectator && p.role === 'crew');
}

function getAliveImpostors(room) {
  return Object.values(room.players).filter(p => p.alive && !p.spectator && p.role === 'impostor');
}

function getGhostPlayers(room) {
  return Object.values(room.players).filter(p => !p.alive && p.ghost && !p.spectator && !p.eliminated);
}

function broadcastToRoom(roomId, event, data, excludeSocket) {
  const room = rooms[roomId];
  if (!room) return;
  Object.keys(room.players).forEach(pid => {
    if (excludeSocket && pid === excludeSocket) return;
    const socket = io.sockets.sockets.get(pid);
    if (socket) socket.emit(event, data);
  });
}

function broadcastToAlive(roomId, event, data, excludeSocket) {
  const room = rooms[roomId];
  if (!room) return;
  Object.values(room.players).forEach(p => {
    if (!p.alive || p.spectator || p.eliminated) return;
    if (excludeSocket && p.id === excludeSocket) return;
    const socket = io.sockets.sockets.get(p.id);
    if (socket) socket.emit(event, data);
  });
}

function broadcastToImpostors(roomId, event, data) {
  const room = rooms[roomId];
  if (!room) return;
  Object.values(room.players).forEach(p => {
    if (p.role !== 'impostor' || !p.alive || p.spectator) return;
    const socket = io.sockets.sockets.get(p.id);
    if (socket) socket.emit(event, data);
  });
}

function broadcastToGhosts(roomId, event, data) {
  const room = rooms[roomId];
  if (!room) return;
  Object.values(room.players).forEach(p => {
    if (p.alive || p.spectator || p.eliminated) return;
    const socket = io.sockets.sockets.get(p.id);
    if (socket) socket.emit(event, data);
  });
}

// ==================== Socket.IO 事件处理 ====================
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // 创建房间
  socket.on('create_room', (data) => {
    const roomId = generateRoomId();
    const room = createRoom(roomId, socket.id);
    const player = createPlayer(socket.id, data.name, data.avatar);
    room.players[socket.id] = player;
    room.playerOrder.push(socket.id);
    rooms[roomId] = room;
    socketToRoom[socket.id] = roomId;
    socket.join(roomId);

    socket.emit('room_created', { roomId });
    socket.emit('player_list', { players: Object.values(room.players) });
    console.log(`Room ${roomId} created by ${socket.id}`);
  });

  // 加入房间
  socket.on('join_room', (data) => {
    const roomId = data.roomId;
    const room = rooms[roomId];

    if (!room) {
      socket.emit('error_message', { message: '房间不存在' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('error_message', { message: '游戏已开始，无法加入' });
      return;
    }
    if (Object.keys(room.players).length >= MAX_PLAYERS) {
      socket.emit('error_message', { message: '房间已满' });
      return;
    }

    const player = createPlayer(socket.id, data.name, data.avatar);
    room.players[socket.id] = player;
    room.playerOrder.push(socket.id);
    socketToRoom[socket.id] = roomId;
    socket.join(roomId);

    socket.emit('join_success', { roomId });
    broadcastToRoom(roomId, 'player_list', { players: Object.values(room.players) });
    console.log(`Player ${socket.id} joined room ${roomId}`);
  });

  // 选择伙伴
  socket.on('select_partner', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player) return;

    player.partner = data.partnerId;
    room.partnerSelections[socket.id] = data.partnerId;

    socket.emit('partner_update', { playerId: socket.id, partnerId: data.partnerId });
    broadcastToRoom(roomId, 'partner_update', { playerId: socket.id, partnerId: data.partnerId }, socket.id);

    // 检查是否所有人都选择了伙伴
    const alivePlayers = getAlivePlayers(room);
    if (Object.keys(room.partnerSelections).length === alivePlayers.length) {
      startGame(roomId);
    }
  });

  // 移动同步
  socket.on('player_move', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== 'playing' && room.state !== 'tactical') return;

    const player = room.players[socket.id];
    if (!player || !player.alive || player.spectator) {
      // 幽灵也可以移动
      if (player && !player.alive && player.ghost) {
        player.x = data.x;
        player.y = data.y;
        broadcastToRoom(roomId, 'player_move', { id: socket.id, x: data.x, y: data.y }, socket.id);
      }
      return;
    }

    // 时间暂停检查
    if (room.timeStopActive && player.role !== 'impostor') return;

    player.x = data.x;
    player.y = data.y;
    broadcastToRoom(roomId, 'player_move', { id: socket.id, x: data.x, y: data.y }, socket.id);
  });

  // 任务完成
  socket.on('task_complete', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== 'playing') return;

    const player = room.players[socket.id];
    if (!player || !player.alive || player.role === 'impostor') return;

    if (data.isPublic) {
      // 公共任务
      room.completedPublicTasks++;
      const progress = room.completedPublicTasks / room.totalPublicTasks;
      broadcastToRoom(roomId, 'task_complete', {
        playerId: socket.id,
        isPublic: true,
        progress: progress,
        completed: room.completedPublicTasks >= room.totalPublicTasks
      });

      // 全队充能+1
      Object.values(room.players).forEach(p => {
        if (p.alive && p.role === 'crew') {
          p.charge = Math.min(3, p.charge + 1);
        }
      });

      if (room.completedPublicTasks >= room.totalPublicTasks) {
        endGame(roomId, 'crew');
        return;
      }
    } else {
      // 个人任务
      const task = room.tasks.find(t => t.id === data.taskId);
      if (task && !task.completed) {
        task.completed = true;
        player.charge = Math.min(3, player.charge + 1);
        socket.emit('task_complete', {
          playerId: socket.id,
          taskId: data.taskId,
          isPublic: false
        });
      }
    }

    checkWinConditions(roomId);
  });

  // 报告尸体
  socket.on('report_body', () => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || (room.state !== 'playing' && room.state !== 'tactical')) return;

    const player = room.players[socket.id];
    if (!player || !player.alive) return;

    // 检查附近是否有尸体
    let bodyFound = false;
    Object.values(room.players).forEach(p => {
      if (p.id !== socket.id && !p.alive && !p.ghost && dist(player.x, player.y, p.x, p.y) < 60) {
        bodyFound = true;
      }
    });

    if (bodyFound || dist(player.x, player.y, room.mapData.emergencyBtn.x, room.mapData.emergencyBtn.y) < 60) {
      startMeeting(roomId, socket.id, 'body');
    }
  });

  // 紧急会议
  socket.on('emergency_meeting', () => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== 'playing') return;

    const player = room.players[socket.id];
    if (!player || !player.alive) return;

    if (room.emergencyUses >= EMERGENCY_MAX) {
      socket.emit('error_message', { message: '紧急按钮次数已用完' });
      return;
    }

    if (dist(player.x, player.y, room.mapData.emergencyBtn.x, room.mapData.emergencyBtn.y) < 50) {
      room.emergencyUses++;
      startMeeting(roomId, socket.id, 'emergency');
    }
  });

  // 投票
  socket.on('vote_cast', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== 'meeting') return;

    const player = room.players[socket.id];
    if (!player || !player.alive || player.voted) return;

    player.voted = true;
    room.votes[socket.id] = data.targetId;

    broadcastToRoom(roomId, 'vote_update', { voterId: socket.id, targetId: data.targetId });

    // 检查是否所有人都投票了
    const alivePlayers = getAlivePlayers(room);
    const allVoted = alivePlayers.every(p => p.voted);
    if (allVoted) {
      resolveVoting(roomId);
    }
  });

  // 聊天消息
  socket.on('chat_message', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== 'meeting') return;

    const player = room.players[socket.id];
    if (!player) return;

    // 观战者不能发言
    if (player.spectator) return;

    const messageData = {
      senderId: socket.id,
      senderName: player.name,
      message: data.message,
      channel: data.channel
    };

    if (data.channel === 'living') {
      // 只发送给活人
      Object.values(room.players).forEach(p => {
        if (p.alive && !p.spectator) {
          const s = io.sockets.sockets.get(p.id);
          if (s) s.emit('chat_message', messageData);
        }
      });
      room.chatHistory.living.push(messageData);
    } else if (data.channel === 'ghost') {
      // 只发送给幽灵
      Object.values(room.players).forEach(p => {
        if (!p.alive && p.ghost && !p.spectator && !p.eliminated) {
          const s = io.sockets.sockets.get(p.id);
          if (s) s.emit('chat_message', messageData);
        }
      });
      room.chatHistory.ghost.push(messageData);
    }
  });

  // 内鬼聊天
  socket.on('impostor_chat', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || player.role !== 'impostor' || !player.alive) return;

    const messageData = {
      senderId: socket.id,
      senderName: player.name,
      message: data.message
    };

    room.impostorChatHistory.push(messageData);
    broadcastToImpostors(roomId, 'impostor_chat', messageData);
  });

  // 击杀
  socket.on('kill_player', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== 'playing' && room.state !== 'tactical') return;

    const killer = room.players[socket.id];
    if (!killer || killer.role !== 'impostor' || !killer.alive) return;

    if (room.killCooldowns[socket.id] > 0) return;

    const target = room.players[data.targetId];
    if (!target || !target.alive || target.spectator) return;
    if (dist(killer.x, killer.y, target.x, target.y) > KILL_RANGE) return;

    // 检查目标是否有屏障 (普格里斯)
    if (target.partner === 'pugelisi' && !target.barrierUsed) {
      target.barrierUsed = true;
      broadcastToRoom(roomId, 'ability_effect', { type: 'barrier', x: target.x, y: target.y });
      return;
    }

    // 检查钩吻被动
    if (target.partner === 'gouwen' && !target.gouwenHit) {
      target.gouwenHit = true;
      target.xiuWeak = true;
      setTimeout(() => { target.xiuWeak = false; target.gouwenHit = false; }, 10000);
      return;
    }

    performKill(roomId, socket.id, data.targetId, 'normal');
    room.killCooldowns[socket.id] = KILL_COOLDOWN;
  });

  // 使用管道
  socket.on('use_vent', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room || room.state !== 'playing') return;

    const player = room.players[socket.id];
    if (!player || player.role !== 'impostor' || !player.alive) return;
    if (room.ventCooldowns[socket.id] > 0) return;

    const fromVent = room.mapData.vents.find(v => v.id === data.from);
    const toVent = room.mapData.vents.find(v => v.id === data.to);
    if (!fromVent || !toVent) return;
    if (dist(player.x, player.y, fromVent.x, fromVent.y) > VENT_RANGE) return;

    player.x = toVent.x;
    player.y = toVent.y;
    player.inVent = true;
    player.ventId = toVent.id;

    room.ventCooldowns[socket.id] = VENT_COOLDOWN;

    socket.emit('player_move', { id: socket.id, x: player.x, y: player.y });
    broadcastToRoom(roomId, 'player_move', { id: socket.id, x: player.x, y: player.y });

    // 2秒后出管道
    setTimeout(() => {
      if (room.players[socket.id]) {
        room.players[socket.id].inVent = false;
        room.players[socket.id].ventId = null;
      }
    }, 2000);
  });

  // 使用能力
  socket.on('ability_use', (data) => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || !player.alive) return;

    handleAbilityUse(roomId, socket.id, data);
  });

  // 进入观战
  socket.on('enter_spectate', () => {
    const roomId = socketToRoom[socket.id];
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player) return;

    player.spectator = true;
    player.alive = false;
    broadcastToRoom(roomId, 'player_list', { players: Object.values(room.players) });
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const roomId = socketToRoom[socket.id];
    if (!roomId) return;

    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[socket.id];
    if (player) {
      player.connected = false;
      // 如果在大厅状态，直接移除玩家
      if (room.state === 'lobby' || room.state === 'partner_select') {
        delete room.players[socket.id];
        room.playerOrder = room.playerOrder.filter(id => id !== socket.id);
        delete room.partnerSelections[socket.id];
      }
    }

    delete socketToRoom[socket.id];

    // 如果房间空了，删除房间
    if (Object.keys(room.players).length === 0) {
      delete rooms[roomId];
      return;
    }

    broadcastToRoom(roomId, 'player_list', { players: Object.values(room.players) });
    checkWinConditions(roomId);
  });
});

// ==================== 游戏开始 ====================
function startGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const playerCount = Object.keys(room.players).length;
  if (playerCount < MIN_PLAYERS) {
    const hostSocket = io.sockets.sockets.get(room.hostId);
    if (hostSocket) hostSocket.emit('error_message', { message: '需要至少4名玩家' });
    return;
  }

  room.state = 'playing';
  room.mapData = createMapData();
  room.tasks = room.mapData.tasks;
  room.totalPublicTasks = playerCount * 2;
  room.completedPublicTasks = 0;
  room.emergencyUses = 0;

  // 分配身份
  const playerIds = Object.keys(room.players);
  const numImpostors = playerCount <= 6 ? 1 : 2;
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);

  for (let i = 0; i < numImpostors; i++) {
    room.players[shuffled[i]].role = 'impostor';
  }

  // 分配伙伴（未选择的随机分配）
  const takenPartners = new Set();
  playerIds.forEach(pid => {
    const p = room.players[pid];
    if (!p.partner) {
      const available = COMPANION_IDS.filter(id => !takenPartners.has(id));
      p.partner = available[Math.floor(Math.random() * available.length)];
    }
    takenPartners.add(p.partner);
  });

  // 设置初始位置（餐厅中央）
  const cafeteria = room.mapData.rooms[0];
  const startX = cafeteria.x + cafeteria.w / 2;
  const startY = cafeteria.y + cafeteria.h / 2;

  playerIds.forEach((pid, idx) => {
    const p = room.players[pid];
    p.x = startX + (idx % 3 - 1) * 40;
    p.y = startY + Math.floor(idx / 3) * 40;
    p.alive = true;
    p.ghost = false;
    p.spectator = false;
    p.eliminated = false;
    p.charge = 0;
    p.voted = false;
    p.barrierUsed = false;
    p.resurrectUsed = false;
    p.controlAttackUsed = false;
    p.trapUsed = false;
    p.righteousKillUsed = false;
    p.disguiseUses = 2;
    p.voteSwapUses = 2;
    p.invisUses = 3;
    p.deathTransferUsed = false;
    p.gouwenHit = false;
    p.xiuWeak = false;
  });

  // 发送游戏开始数据
  const playerPositions = playerIds.map(pid => ({
    id: pid,
    x: room.players[pid].x,
    y: room.players[pid].y
  }));

  playerIds.forEach(pid => {
    const p = room.players[pid];
    const socket = io.sockets.sockets.get(pid);
    if (!socket) return;

    // 构建其他玩家的公开伙伴列表（隐藏实际伙伴）
    const publicPartners = {};
    playerIds.forEach(opid => {
      if (opid === pid) {
        publicPartners[opid] = room.players[opid].partner; // 自己可见
      } else {
        publicPartners[opid] = null; // 他人不可见
      }
    });

    socket.emit('game_start', {
      role: p.role,
      partner: p.partner,
      startX: p.x,
      startY: p.y,
      mapData: room.mapData,
      tasks: room.tasks.filter(t => p.role === 'crew'),
      totalPublicTasks: room.totalPublicTasks,
      playerPositions: playerPositions,
      publicPartners: publicPartners
    });
  });

  // 启动游戏循环
  startGameLoop(roomId);
  console.log(`Game started in room ${roomId} with ${playerCount} players`);
}

// ==================== 游戏循环 ====================
function startGameLoop(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.gameLoopInterval) clearInterval(room.gameLoopInterval);

  room.gameLoopInterval = setInterval(() => {
    updateGameLoop(roomId);
  }, 1000);
}

function updateGameLoop(roomId) {
  const room = rooms[roomId];
  if (!room || room.state === 'gameover') {
    if (room && room.gameLoopInterval) {
      clearInterval(room.gameLoopInterval);
      room.gameLoopInterval = null;
    }
    return;
  }

  // 更新冷却
  Object.keys(room.killCooldowns).forEach(pid => {
    if (room.killCooldowns[pid] > 0) room.killCooldowns[pid]--;
  });
  Object.keys(room.ventCooldowns).forEach(pid => {
    if (room.ventCooldowns[pid] > 0) room.ventCooldowns[pid]--;
  });

  // 检查陷阱触发
  checkTraps(roomId);

  // 检查风夜复活
  checkResurrections(roomId);

  // 检查氧气破坏
  if (room.sabotage.active && room.sabotage.type === 'oxygen') {
    const remaining = Math.ceil((room.sabotage.endTime - Date.now()) / 1000);
    if (remaining <= 0) {
      // 氧气耗尽，内鬼胜利
      endGame(roomId, 'impostor');
      return;
    }
  }

  // 检查胜利条件
  checkWinConditions(roomId);
}

// ==================== 击杀处理 ====================
function performKill(roomId, killerId, targetId, killType) {
  const room = rooms[roomId];
  if (!room) return;

  const killer = room.players[killerId];
  const target = room.players[targetId];
  if (!killer || !target) return;

  // DAG结算优先级
  // 1. 赫瓦尔死亡转移
  if (target.partner === 'hewal' && !target.deathTransferUsed) {
    const aliveOthers = getAlivePlayers(room).filter(p => p.id !== targetId);
    if (aliveOthers.length > 0 && Math.random() < 0.3) {
      target.deathTransferUsed = true;
      const transferTarget = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      broadcastToRoom(roomId, 'ability_effect', {
        type: 'death_transfer',
        x: target.x,
        y: target.y,
        targetX: transferTarget.x,
        targetY: transferTarget.y
      });
      // 被转移者直接死亡，不触发被动
      killPlayerDirect(roomId, transferTarget.id, 'transfer');
      return; // 原目标不死
    }
  }

  // 2. 虞瑜诅咒免疫（对诅咒类）
  if (killType === 'curse' && target.partner === 'yuyu') {
    broadcastToRoom(roomId, 'ability_effect', { type: 'curse_blocked', x: target.x, y: target.y });
    return;
  }

  // 3. 夜莺诅咒反制
  if (killType === 'curse' && target.partner === 'nightingale') {
    if (Math.random() < 0.2) {
      broadcastToRoom(roomId, 'ability_effect', { type: 'curse_counter', x: target.x, y: target.y });
      return;
    }
  }

  // 4. 风夜/普格里斯复活
  if (target.partner === 'fengye') {
    // 风夜被动：死亡10秒后复活20秒
    target.ghost = true;
    target.alive = false;
    target.fengyeResurrectTime = Date.now() + 10000;
    target.fengyeDieTime = Date.now() + 30000;
    broadcastToRoom(roomId, 'player_death', { id: targetId, killerId });
    broadcastToRoom(roomId, 'ability_effect', { type: 'resurrect_pending', x: target.x, y: target.y });
    return;
  }

  // 5. 修的诅咒/定身
  if (killType === 'normal' && target.partner === 'xiu') {
    // 定身袭击者15秒
    broadcastToRoom(roomId, 'ability_effect', { type: 'root', x: killer.x, y: killer.y, targetId: killerId });
  }

  // 6. 洛兰自动报告
  if (target.partner === 'luolan') {
    setTimeout(() => {
      if (room.players[killerId] && room.players[killerId].alive) {
        startMeeting(roomId, killerId, 'body');
      }
    }, 1000);
  }

  // 执行死亡
  killPlayerDirect(roomId, targetId, killType);
}

function killPlayerDirect(roomId, playerId, killType) {
  const room = rooms[roomId];
  if (!room) return;

  const player = room.players[playerId];
  if (!player) return;

  player.alive = false;
  player.ghost = true;

  broadcastToRoom(roomId, 'player_death', { id: playerId, killType });

  // 死亡特效
  if (killType === 'curse') {
    broadcastToRoom(roomId, 'ability_effect', { type: 'curse', x: player.x, y: player.y });
  } else if (killType === 'trap') {
    broadcastToRoom(roomId, 'ability_effect', { type: 'trap_trigger', x: player.x, y: player.y });
  }

  checkWinConditions(roomId);
}

// ==================== 会议系统 ====================
function startMeeting(roomId, callerId, reason) {
  const room = rooms[roomId];
  if (!room) return;

  room.state = 'meeting';
  room.votes = {};

  // 重置投票状态
  Object.values(room.players).forEach(p => {
    p.voted = false;
  });

  // 清除之前的定时器
  if (room.meetingTimer) clearTimeout(room.meetingTimer);
  if (room.tacticalTimer) clearTimeout(room.tacticalTimer);

  broadcastToRoom(roomId, 'meeting_called', { caller: callerId, reason });

  // 会议倒计时
  room.meetingTimer = setTimeout(() => {
    resolveVoting(roomId);
  }, MEETING_DURATION * 1000);
}

function resolveVoting(roomId) {
  const room = rooms[roomId];
  if (!room || room.state !== 'meeting') return;

  if (room.meetingTimer) clearTimeout(room.meetingTimer);
  room.meetingTimer = null;

  // 统计票数
  const voteCounts = {};
  let skipCount = 0;

  Object.entries(room.votes).forEach(([voterId, targetId]) => {
    if (targetId === 'skip') {
      skipCount++;
    } else {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    }
  });

  // 找出最高票
  let maxVotes = 0;
  let ejectedId = null;
  let tie = false;

  Object.entries(voteCounts).forEach(([pid, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      ejectedId = pid;
      tie = false;
    } else if (count === maxVotes && count > 0) {
      tie = true;
    }
  });

  // 夜主投票交换处理（简化：在实际应用中需要更复杂的逻辑）

  const result = {
    ejected: null,
    ejectedName: null,
    wasImpostor: false,
    voteCounts: voteCounts,
    skipCount: skipCount
  };

  if (!tie && ejectedId && maxVotes > skipCount) {
    const ejected = room.players[ejectedId];
    if (ejected && ejected.alive) {
      result.ejected = ejectedId;
      result.ejectedName = ejected.name;
      result.wasImpostor = ejected.role === 'impostor';

      // 放逐玩家
      ejected.alive = false;
      ejected.eliminated = true;
      ejected.ghost = false; // 被放逐的不是幽灵，是淘汰

      broadcastToRoom(roomId, 'player_eliminated', {
        id: ejectedId,
        name: ejected.name,
        spectator: true
      });

      // 赫瓦尔转移概率（被投票）
      if (ejected.partner === 'hewal' && !ejected.deathTransferUsed && Math.random() < 0.1) {
        const aliveOthers = getAlivePlayers(room).filter(p => p.id !== ejectedId);
        if (aliveOthers.length > 0) {
          ejected.deathTransferUsed = true;
          const transferTarget = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
          broadcastToRoom(roomId, 'ability_effect', {
            type: 'death_transfer',
            x: ejected.x,
            y: ejected.y,
            targetX: transferTarget.x,
            targetY: transferTarget.y
          });
          killPlayerDirect(roomId, transferTarget.id, 'transfer');
        }
      }
    }
  }

  broadcastToRoom(roomId, 'vote_result', result);

  // 进入战术窗口
  room.state = 'tactical';
  room.tacticalTimer = setTimeout(() => {
    room.state = 'playing';
    checkWinConditions(roomId);
  }, TACTICAL_WINDOW * 1000);
}

// ==================== 能力处理 ====================
function handleAbilityUse(roomId, playerId, data) {
  const room = rooms[roomId];
  if (!room) return;

  const player = room.players[playerId];
  if (!player) return;

  switch(data.type) {
    case 'charge_skill':
      handleChargeSkill(roomId, playerId, data.ability);
      break;
    case 'resurrect':
      handleResurrect(roomId, playerId);
      break;
    case 'invis':
      handleInvisibility(roomId, playerId);
      break;
    case 'control_attack':
      handleControlAttack(roomId, playerId);
      break;
    case 'trap':
      handleTrap(roomId, playerId, data.x, data.y);
      break;
    case 'time_stop':
      handleTimeStop(roomId, playerId);
      break;
    case 'curse':
      handleCurse(roomId, playerId, data.targetId);
      break;
    case 'vent_sense':
      handleVentSense(roomId, playerId);
      break;
    case 'vision_remote':
      handleVisionRemote(roomId, playerId);
      break;
  }
}

function handleChargeSkill(roomId, playerId, ability) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  if (!player || player.charge <= 0) return;

  switch(ability) {
    case 'anti_curse':
      if (player.charge >= 2) {
        player.charge -= 2;
        player.nightingaleAntiCurse = true;
        broadcastToRoom(roomId, 'ability_effect', { type: 'anti_curse', x: player.x, y: player.y });
      }
      break;
    case 'speed':
      if (player.charge >= 1) {
        player.charge -= 1;
        broadcastToRoom(roomId, 'ability_effect', { type: 'speed_boost', x: player.x, y: player.y });
      }
      break;
    case 'check_role':
      if (player.charge >= 3) {
        player.charge -= 3;
        // 查验逻辑需要目标选择，简化处理
        broadcastToRoom(roomId, 'ability_effect', { type: 'check_role', x: player.x, y: player.y });
      }
      break;
  }
}

function handleResurrect(roomId, playerId) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  if (!player || player.resurrectUsed) return;

  // 找到最近死亡的玩家
  const deadPlayers = Object.values(room.players).filter(p => !p.alive && p.ghost && !p.eliminated);
  if (deadPlayers.length === 0) return;

  const target = deadPlayers[0]; // 简化：复活第一个
  target.alive = true;
  target.ghost = false;
  target.resurrected = true;
  target.canSpeak = false; // 下次会议不能发言
  player.resurrectUsed = true;

  broadcastToRoom(roomId, 'ability_effect', { type: 'resurrect', x: target.x, y: target.y });
  broadcastToRoom(roomId, 'player_list', { players: Object.values(room.players) });
}

function handleInvisibility(roomId, playerId) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  if (!player || player.invisUses <= 0) return;

  player.invisUses--;
  broadcastToRoom(roomId, 'ability_effect', { type: 'invis', x: player.x, y: player.y });
}

function handleControlAttack(roomId, playerId) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  if (!player || player.controlAttackUsed) return;

  // 简化：控制最近的一个船员攻击另一个随机玩家
  const crew = getAliveCrew(room).filter(p => p.id !== playerId);
  const targets = getAlivePlayers(room).filter(p => p.id !== playerId && p.id !== crew[0]?.id);

  if (crew.length > 0 && targets.length > 0) {
    const controlled = crew[0];
    const victim = targets[0];
    player.controlAttackUsed = true;

    broadcastToRoom(roomId, 'ability_effect', { type: 'hack', x: controlled.x, y: controlled.y });

    setTimeout(() => {
      performKill(roomId, controlled.id, victim.id, 'control');
    }, 2000);
  }
}

function handleTrap(roomId, playerId, x, y) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  if (!player || player.trapUsed) return;

  player.trapUsed = true;
  room.traps.push({
    x, y,
    placedBy: playerId,
    placedAt: Date.now(),
    duration: 10000,
    triggered: false
  });

  // 布置时自身闪蓝光1秒全图可见
  broadcastToRoom(roomId, 'ability_effect', { type: 'blue_flash', x: player.x, y: player.y });
}

function handleTimeStop(roomId, playerId) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  if (!player) return;

  room.timeStopActive = true;
  room.timeStopUser = playerId;

  broadcastToRoom(roomId, 'ability_effect', { type: 'time_stop', x: player.x, y: player.y });

  setTimeout(() => {
    room.timeStopActive = false;
    room.timeStopUser = null;
  }, 15000);
}

function handleCurse(roomId, playerId, targetId) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  const target = room.players[targetId];
  if (!player || !target || !target.alive) return;

  // 10秒后死亡
  broadcastToRoom(roomId, 'ability_effect', { type: 'curse', x: target.x, y: target.y });

  setTimeout(() => {
    if (room.players[targetId] && room.players[targetId].alive) {
      performKill(roomId, playerId, targetId, 'curse');
    }
  }, 10000);
}

function handleVentSense(roomId, playerId) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  if (!player) return;

  // 检查附近管道
  const nearbyVent = room.mapData.vents.find(v => dist(player.x, player.y, v.x, v.y) < 20);
  if (!nearbyVent) return;

  // 检查是否有玩家在管道中
  const someoneInVent = Object.values(room.players).some(p => p.inVent && p.id !== playerId);

  const socket = io.sockets.sockets.get(playerId);
  if (socket) {
    socket.emit('ability_effect', {
      type: 'vent_sense_result',
      detected: someoneInVent,
      message: someoneInVent ? '感应到异常数据流!' : '管道内无异常'
    });
  }
}

function handleVisionRemote(roomId, playerId) {
  const room = rooms[roomId];
  const player = room.players[playerId];
  if (!player || player.charge < 2) return;

  player.charge -= 2;
  // 简化：给予额外视野效果
  const socket = io.sockets.sockets.get(playerId);
  if (socket) {
    socket.emit('ability_effect', { type: 'vision_boost', x: player.x, y: player.y });
  }
}

// ==================== 陷阱检查 ====================
function checkTraps(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const now = Date.now();
  room.traps = room.traps.filter(trap => {
    if (trap.triggered) return false;
    if (now - trap.placedAt > trap.duration) return false;

    // 检查是否有玩家触发
    Object.values(room.players).forEach(p => {
      if (p.id === trap.placedBy) return;
      if (!p.alive || p.spectator) return;
      if (dist(p.x, p.y, trap.x, trap.y) < 25) {
        trap.triggered = true;
        broadcastToRoom(roomId, 'ability_effect', { type: 'trap_trigger', x: trap.x, y: trap.y });
        performKill(roomId, trap.placedBy, p.id, 'trap');
      }
    });

    return !trap.triggered;
  });
}

// ==================== 复活检查 ====================
function checkResurrections(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const now = Date.now();
  Object.values(room.players).forEach(p => {
    if (p.partner === 'fengye' && !p.alive && p.ghost && p.fengyeResurrectTime && now >= p.fengyeResurrectTime) {
      if (!p.fengyeResurrected) {
        p.fengyeResurrected = true;
        p.alive = true;
        p.ghost = false;
        p.invincible = true;
        broadcastToRoom(roomId, 'ability_effect', { type: 'resurrect', x: p.x, y: p.y });
        broadcastToRoom(roomId, 'player_list', { players: Object.values(room.players) });

        // 5秒后取消无敌
        setTimeout(() => {
          if (room.players[p.id]) room.players[p.id].invincible = false;
        }, 5000);

        // 20秒后重新死亡
        setTimeout(() => {
          if (room.players[p.id] && room.players[p.id].alive) {
            room.players[p.id].alive = false;
            room.players[p.id].ghost = true;
            broadcastToRoom(roomId, 'player_death', { id: p.id, killType: 'fengye_timeout' });
            checkWinConditions(roomId);
          }
        }, 20000);
      }
    }
  });
}

// ==================== 破坏系统 ====================
function startSabotage(roomId, type, playerId) {
  const room = rooms[roomId];
  if (!room) return;

  const player = room.players[playerId];
  if (!player || player.role !== 'impostor' || !player.alive) return;

  const now = Date.now();
  if (now - room.lastSabotageTime < SABOTAGE_COOLDOWN * 1000) {
    const socket = io.sockets.sockets.get(playerId);
    if (socket) socket.emit('error_message', { message: '破坏冷却中' });
    return;
  }

  if (room.sabotage.active) {
    const socket = io.sockets.sockets.get(playerId);
    if (socket) socket.emit('error_message', { message: '已有破坏正在进行' });
    return;
  }

  room.sabotage.active = true;
  room.sabotage.type = type;
  room.lastSabotageTime = now;

  if (type === 'oxygen') {
    room.sabotage.endTime = now + 60000; // 60秒倒计时
  }

  broadcastToAlive(roomId, 'sabotage_start', { type, saboteur: playerId });
  console.log(`Sabotage ${type} started in room ${roomId}`);
}

function endSabotage(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.sabotage.active = false;
  room.sabotage.type = null;
  room.sabotage.endTime = null;

  broadcastToRoom(roomId, 'sabotage_end', {});
}

// ==================== 胜负判断 ====================
function checkWinConditions(roomId) {
  const room = rooms[roomId];
  if (!room || room.state === 'gameover' || room.state === 'lobby') return;

  const alivePlayers = getAlivePlayers(room);
  const aliveCrew = getAliveCrew(room);
  const aliveImpostors = getAliveImpostors(room);

  // 内鬼胜利条件1：内鬼人数 >= 存活船员人数
  if (aliveImpostors.length >= aliveCrew.length && aliveCrew.length > 0) {
    endGame(roomId, 'impostor');
    return;
  }

  // 内鬼胜利条件2：所有船员死亡
  if (aliveCrew.length === 0 && aliveImpostors.length > 0) {
    endGame(roomId, 'impostor');
    return;
  }

  // 船员胜利条件1：所有内鬼死亡
  if (aliveImpostors.length === 0) {
    endGame(roomId, 'crew');
    return;
  }

  // 船员胜利条件2：所有公共任务完成
  if (room.completedPublicTasks >= room.totalPublicTasks && room.totalPublicTasks > 0) {
    endGame(roomId, 'crew');
    return;
  }

  // 检查是否所有存活玩家都断开了
  const connectedAlive = alivePlayers.filter(p => p.connected);
  if (connectedAlive.length === 0 && alivePlayers.length > 0) {
    // 所有人断开，结束游戏
    endGame(roomId, 'crew');
  }
}

// ==================== 游戏结束 ====================
function endGame(roomId, winner) {
  const room = rooms[roomId];
  if (!room || room.state === 'gameover') return;

  room.state = 'gameover';

  if (room.gameLoopInterval) {
    clearInterval(room.gameLoopInterval);
    room.gameLoopInterval = null;
  }
  if (room.meetingTimer) {
    clearTimeout(room.meetingTimer);
    room.meetingTimer = null;
  }
  if (room.tacticalTimer) {
    clearTimeout(room.tacticalTimer);
    room.tacticalTimer = null;
  }

  const stats = Object.values(room.players).map(p => ({
    name: p.name,
    role: p.role,
    alive: p.alive && !p.spectator,
    partner: p.partner,
    avatar: p.avatar
  }));

  broadcastToRoom(roomId, 'game_over', { winner, stats });
  console.log(`Game over in room ${roomId}. Winner: ${winner}`);

  // 10秒后重置房间
  setTimeout(() => {
    resetRoom(roomId);
  }, 15000);
}

// ==================== 房间重置 ====================
function resetRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.state = 'lobby';
  room.mapData = null;
  room.tasks = [];
  room.totalPublicTasks = 0;
  room.completedPublicTasks = 0;
  room.votes = {};
  room.chatHistory = { living: [], ghost: [] };
  room.impostorChatHistory = [];
  room.sabotage = { active: false, type: null, endTime: null };
  room.lastSabotageTime = 0;
  room.killCooldowns = {};
  room.ventCooldowns = {};
  room.abilityUses = {};
  room.traps = [];
  room.timeStopActive = false;
  room.timeStopUser = null;
  room.partnerSelections = {};
  room.eliminatedPlayers = [];
  room.emergencyUses = 0;

  // 重置玩家状态但保留连接
  Object.values(room.players).forEach(p => {
    p.role = 'crew';
    p.partner = null;
    p.alive = true;
    p.x = 400;
    p.y = 300;
    p.charge = 0;
    p.voted = false;
    p.spectator = false;
    p.eliminated = false;
    p.ghost = false;
    p.inVent = false;
    p.ventId = null;
    p.disguisedAs = null;
    p.barrierUsed = false;
    p.resurrectUsed = false;
    p.controlAttackUsed = false;
    p.trapUsed = false;
    p.righteousKillUsed = false;
    p.disguiseUses = 2;
    p.voteSwapUses = 2;
    p.invisUses = 3;
    p.deathTransferUsed = false;
    p.gouwenHit = false;
    p.xiuWeak = false;
    p.fengyeResurrectTime = null;
    p.fengyeDieTime = null;
    p.fengyeResurrected = false;
    p.invincible = false;
    p.resurrected = false;
    p.canSpeak = true;
    p.nightingaleAntiCurse = false;
  });

  broadcastToRoom(roomId, 'reset_game', {});
  broadcastToRoom(roomId, 'player_list', { players: Object.values(room.players) });
  console.log(`Room ${roomId} reset to lobby`);
}

// ==================== HTTP 路由 ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: Object.keys(rooms).length, uptime: process.uptime() });
});

// ==================== 服务器启动 ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Cyber Impostor Server running on port ${PORT}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
