const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const players = {};

const COMPANIONS = [
  { id: 'nightingale', name: '夜莺', passive: { type: 'curse_counter', probBase: 0.2 }, active: { impostor: { type: 'double_kill', cost: 0 }, crew: { type: 'charge_skill', cost: 2, effect: '反制状态' } } },
  { id: 'pugelisi', name: '普格里斯', passive: { type: 'barrier', trigger: '被击杀时', effect: '3秒无敌屏障' }, active: { both: { type: 'resurrect', window: '投票后', effect: '复活被击杀玩家' } } },
  { id: 'gouwen', name: '钩吻', passive: { type: 'double_hit', trigger: '受伤时', effect: '需两次伤害才死亡' }, active: { impostor: { type: 'frenzy', effect: '1.5倍移速15秒' }, crew: { type: 'charge_skill', cost: 1, effect: '1.5倍移速15秒' } } },
  { id: 'yuyu', name: '虞瑜', passive: { type: 'curse_immune', effect: '免疫诅咒' }, active: { both: { type: 'summon', effect: '召唤附身' }, impostor_extra: { type: 'control_attack', uses: 1, effect: '控制袭击' }, crew_extra: { type: 'vision_remote', effect: '远程任务' } } },
  { id: 'hewal', name: '赫瓦尔', passive: { type: 'death_transfer', probBase: 0.3, probVote: 0.1, effect: '死亡转移' }, active: { impostor: { type: 'invis', uses: 3, effect: '隐身10秒' }, crew: { type: 'charge_skill', cost: 3, effect: '查验阵营' } } },
  { id: 'xiu', name: '修', passive: { type: 'root', trigger: '被击杀时', effect: '定身袭击者15秒' }, active: { impostor: { type: 'curse', effect: '10秒后死亡' }, crew: { type: 'fast_task', effect: '任务耗时减半' } } },
  { id: 'luolan', name: '洛兰', passive: { type: 'auto_report', effect: '死亡1秒后自动报告' }, active: { both: { type: 'vent_sense', effect: '管道感知' } } },
  { id: 'yuansheng', name: '渊生', active: { impostor: { type: 'trap', uses: 1, effect: '布置陷阱' } } },
  { id: 'fengye', name: '风夜', passive: { type: 'resurrect', trigger: '被击杀时', effect: '10秒后复活20秒' }, active: { impostor: { type: 'time_stop', effect: '时停15秒' }, crew: { type: 'righteous_kill', uses: 1, effect: '正义击杀' } } },
  { id: 'yezhu', name: '夜主', active: { impostor: { type: 'disguise', uses: 2, effect: '伪装15秒' }, crew: { type: 'vote_swap', uses: 2, effect: '交换投票' } } }
];

const MAP_ROOMS = [
  { name: '餐厅', x: 400, y: 300, w: 200, h: 150, color: '#00f0ff', items: ['table','chairs','menu'] },
  { name: '武器舱', x: 700, y: 200, w: 150, h: 120, color: '#ff00ff', items: ['rack','ammo'] },
  { name: '氧气舱', x: 700, y: 450, w: 150, h: 120, color: '#00f0ff', items: ['tank','gauge'] },
  { name: '驾驶舱', x: 100, y: 200, w: 150, h: 120, color: '#b300ff', items: ['seat','wheel','star_map'] },
  { name: '主控台', x: 100, y: 450, w: 150, h: 120, color: '#ff00ff', items: ['screen','console'] },
  { name: '仓库', x: 250, y: 100, w: 150, h: 100, color: '#b300ff', items: ['shelf','boxes'] },
  { name: '电力间', x: 550, y: 100, w: 150, h: 100, color: '#ff3131', items: ['panel','cables'] },
  { name: '医疗间', x: 250, y: 500, w: 150, h: 100, color: '#00f0ff', items: ['bed','cabinet'] }
];

const CORRIDORS = [
  { from: '餐厅', to: '武器舱', points: [[600,250],[700,250]] },
  { from: '餐厅', to: '氧气舱', points: [[600,400],[700,400]] },
  { from: '餐厅', to: '驾驶舱', points: [[300,250],[200,250]] },
  { from: '餐厅', to: '主控台', points: [[300,400],[200,400]] },
  { from: '餐厅', to: '仓库', points: [[400,250],[350,200],[350,150]] },
  { from: '餐厅', to: '电力间', points: [[500,250],[550,200],[550,150]] },
  { from: '餐厅', to: '医疗间', points: [[400,450],[350,500],[350,550]] }
];

const VENTS = [
  { id: 0, x: 350, y: 250 }, { id: 1, x: 650, y: 250 },
  { id: 2, x: 350, y: 400 }, { id: 3, x: 650, y: 400 },
  { id: 4, x: 200, y: 150 }, { id: 5, x: 500, y: 150 },
  { id: 6, x: 200, y: 550 }, { id: 7, x: 500, y: 550 }
];

const TASK_TYPES = [
  { type: 'clean_fan', name: '清理电风扇', room: '氧气舱', clicks: 5, time: 8 },
  { type: 'swipe_card', name: '刷卡', room: '医疗间', time: 3 },
  { type: 'wiring', name: '接线', room: '电力间', pairs: 4 },
  { type: 'password', name: '解谜密码', room: '主控台', digits: 4, code: '2049' },
  { type: 'antenna', name: '校准天线', room: '驾驶舱', time: 2 },
  { type: 'upload', name: '数据上传', room: '仓库', time: 10 }
];

const EMOJIS = ['🤖','👾','🧬','💀','👽','🦾','🦿','🎃','🤠','👻','🧞','🧜','🪼','🦋','🪲','🔥','🍔','🍞'];

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function dist(a, b) {
  return Math.hypot((a.x||0) - (b.x||0), (a.y||0) - (b.y||0));
}

function getAlive(game) {
  return Object.values(game.players).filter(p => p.alive && !p.ghost && !p.eliminated && !p.spectating);
}

function getCrew(game) {
  return getAlive(game).filter(p => p.role === 'crew');
}

function getImpostors(game) {
  return getAlive(game).filter(p => p.role === 'impostor');
}

function dynamicProb(base, aliveCount) {
  return Math.min(1, base * (1 + (10 - aliveCount) * 0.05));
}

function checkWin(room) {
  const game = room.game;
  if (!game) return false;
  const aliveCrew = getCrew(game).length;
  const aliveImp = getImpostors(game).length;
  if (aliveImp >= aliveCrew && aliveCrew > 0) {
    endGame(room, 'impostor');
    return true;
  }
  const total = game.tasks.length;
  const done = game.tasks.filter(t => t.completed).length;
  if (total > 0 && done >= total) {
    endGame(room, 'crew');
    return true;
  }
  if (game.oxygenSabotage && game.oxygenTimer <= 0) {
    endGame(room, 'impostor');
    return true;
  }
  return false;
}

function endGame(room, winner) {
  if (room.ended) return;
  room.ended = true;
  room.game.winner = winner;
  io.to(room.id).emit('game_over', { winner, players: room.game.players });
  setTimeout(() => resetGame(room), 15000);
}

function resetGame(room) {
  room.state = 'lobby';
  room.ended = false;
  if (room.gameLoop) clearInterval(room.gameLoop);
  if (room.meetingTimer) clearInterval(room.meetingTimer);
  room.game = null;
  Object.values(room.players).forEach(p => {
    p.companion = null;
    p.ready = false;
  });
  io.to(room.id).emit('reset_game');
}

function startGame(room) {
  const plist = Object.values(room.players);
  const count = plist.length;
  if (count < 4) return;
  const impCount = count <= 6 ? 1 : 2;
  const shuffled = [...plist].sort(() => Math.random() - 0.5);
  const impostors = new Set(shuffled.slice(0, impCount).map(p => p.id));

  const availComp = COMPANIONS.map(c => c.id);
  plist.forEach(p => {
    if (!p.companion || !availComp.includes(p.companion)) {
      const idx = Math.floor(Math.random() * availComp.length);
      p.companion = availComp.splice(idx, 1)[0];
    } else {
      availComp.splice(availComp.indexOf(p.companion), 1);
    }
  });

  room.game = {
    players: {}, tasks: [], meetings: 0, emergencyUses: 0,
    sabotages: [], lastSabotageTime: 0, phase: 'free',
    messages: [], votes: {}, voteSwap: null,
    oxygenSabotage: false, oxygenTimer: 0,
    traps: [], effects: [], timeStopOwner: null,
    timer: 0
  };

  plist.forEach((p, i) => {
    const isImp = impostors.has(p.id);
    room.game.players[p.id] = {
      id: p.id, name: p.name,
      x: 400 + (Math.random() - 0.5) * 80,
      y: 300 + (Math.random() - 0.5) * 60,
      role: isImp ? 'impostor' : 'crew',
      companion: p.companion, alive: true, ghost: false,
      eliminated: false, spectating: false,
      charge: 0, tasks: [], taskProgress: 0,
      cooldowns: { kill: 0, vent: 0, sabotage: 0 },
      effects: [], invisible: false, disguised: null,
      barrier: false, barrierUsed: false, rooted: false,
      speedMod: 1, injured: false, inVent: false,
      resurrected: false, invincible: false, mute: false,
      emoji: EMOJIS[i % EMOJIS.length],
      ventUses: 0, abilityUses: {}
    };
  });

  const taskCount = count * 2;
  for (let i = 0; i < taskCount; i++) {
    const ttype = TASK_TYPES[Math.floor(Math.random() * TASK_TYPES.length)];
    const rdata = MAP_ROOMS.find(r => r.name === ttype.room);
    room.game.tasks.push({
      id: 'task_' + i, type: ttype.type, name: ttype.name,
      room: ttype.room,
      x: rdata.x + 30 + Math.random() * (rdata.w - 60),
      y: rdata.y + 30 + Math.random() * (rdata.h - 60),
      completed: false, assigned: null, data: { ...ttype }
    });
  }

  const crews = plist.filter(p => !impostors.has(p.id));
  crews.forEach(p => {
    const pts = room.game.tasks.filter(t => !t.assigned && t.room).slice(0, 2);
    pts.forEach(t => t.assigned = p.id);
    room.game.players[p.id].tasks = pts.map(t => t.id);
  });

  room.state = 'playing';
  room.game.phase = 'free';
  room.ended = false;

  plist.forEach(p => {
    const gp = room.game.players[p.id];
    const others = plist.map(pl => {
      const gpl = room.game.players[pl.id];
      return {
        id: pl.id, name: pl.name,
        companion: pl.id === p.id ? pl.companion : null,
        x: gpl.x, y: gpl.y, emoji: gpl.emoji,
        role: pl.id === p.id ? gpl.role : null
      };
    });
    io.to(p.id).emit('game_start', {
      role: gp.role, companion: gp.companion, emoji: gp.emoji,
      players: others,
      tasks: gp.role === 'crew' ? gp.tasks : [],
      allTasks: room.game.tasks.map(t => ({ id: t.id, x: t.x, y: t.y, room: t.room, name: t.name, type: t.type })),
      map: { rooms: MAP_ROOMS, corridors: CORRIDORS, vents: VENTS }
    });
  });

  startGameLoop(room);
}

function startGameLoop(room) {
  if (room.gameLoop) clearInterval(room.gameLoop);
  room.gameLoop = setInterval(() => {
    if (room.state !== 'playing' || room.ended) return;
    const game = room.game;

    Object.values(game.players).forEach(p => {
      if (p.cooldowns.kill > 0) p.cooldowns.kill -= 0.1;
      if (p.cooldowns.vent > 0) p.cooldowns.vent -= 0.1;
      if (p.cooldowns.sabotage > 0) p.cooldowns.sabotage -= 0.1;
    });

    if (game.oxygenSabotage && game.oxygenTimer > 0) {
      game.oxygenTimer -= 0.1;
      io.to(room.id).emit('oxygen_update', { timer: Math.ceil(game.oxygenTimer) });
      if (game.oxygenTimer <= 0) checkWin(room);
    }

    game.traps = game.traps.filter(trap => {
      trap.time -= 0.1;
      if (trap.time <= 0) return false;
      Object.values(game.players).forEach(p => {
        if (p.alive && !p.ghost && p.id !== trap.owner && dist(p, trap) < 30) {
          killPlayer(room, p.id, 'trap', trap.owner);
          io.to(room.id).emit('effect_trigger', { type: 'trap_trigger', x: trap.x, y: trap.y });
        }
      });
      return true;
    });

    if (game.timeStopOwner) {
      const owner = game.players[game.timeStopOwner];
      if (!owner || !owner.alive || owner.ghost) {
        game.timeStopOwner = null;
        io.to(room.id).emit('effect_end', { type: 'time_stop' });
      }
    }
  }, 100);
}

function killPlayer(room, targetId, method, killerId) {
  const game = room.game;
  const target = game.players[targetId];
  if (!target || !target.alive || target.ghost || target.eliminated || target.spectating) return;
  if (target.invincible) return;

  const killer = game.players[killerId];
  const companion = COMPANIONS.find(c => c.id === target.companion);
  const aliveCount = getAlive(game).length;

  // DAG结算优先级
  // 1. 死亡转移 (赫瓦尔)
  if (companion && companion.id === 'hewal' && method !== 'transfer' && method !== 'vote') {
    const prob = dynamicProb(companion.passive.probBase, aliveCount);
    if (Math.random() < prob) {
      const others = Object.values(game.players).filter(p => p.alive && !p.ghost && p.id !== targetId);
      if (others.length > 0) {
        const transferTarget = others[Math.floor(Math.random() * others.length)];
        io.to(room.id).emit('effect_trigger', { type: 'death_transfer', from: targetId, to: transferTarget.id });
        killPlayer(room, transferTarget.id, 'transfer', killerId);
        return;
      }
    }
  }

  // 2. 虞瑜诅咒免疫
  if (companion && companion.id === 'yuyu' && method === 'curse') {
    const killerComp = killer ? killer.companion : null;
    if (killerComp !== 'xiu') {
      io.to(targetId).emit('effect_trigger', { type: 'curse_immune' });
      return;
    }
  }

  // 3. 夜莺诅咒反制
  if (companion && companion.id === 'nightingale' && method === 'curse') {
    io.to(targetId).emit('effect_trigger', { type: 'curse_counter' });
    const prob = dynamicProb(companion.passive.probBase, aliveCount);
    if (Math.random() < prob && target.role !== 'impostor') {
      target.curseChance = true;
    }
    return;
  }

  // 4. 普格里斯屏障
  if (companion && companion.id === 'pugelisi' && (method === 'kill' || method === 'trap') && !target.barrierUsed) {
    target.barrierUsed = true;
    target.barrier = true;
    target.invincible = true;
    io.to(room.id).emit('effect_trigger', { type: 'barrier', playerId: targetId });
    setTimeout(() => {
      if (game.players[targetId]) {
        game.players[targetId].barrier = false;
        game.players[targetId].invincible = false;
      }
    }, 3000);
    return;
  }

  // 5. 风夜复活
  if (companion && companion.id === 'fengye' && method !== 'vote' && method !== 'transfer') {
    target.alive = false;
    target.ghost = true;
    target.resurrectTimer = 10;
    io.to(room.id).emit('player_death', { playerId: targetId, method, killerId });
    io.to(room.id).emit('effect_trigger', { type: 'ghost', playerId: targetId });

    setTimeout(() => {
      if (game.players[targetId] && game.players[targetId].ghost && !game.players[targetId].eliminated) {
        game.players[targetId].alive = true;
        game.players[targetId].ghost = false;
        game.players[targetId].resurrected = true;
        game.players[targetId].invincible = true;
        io.to(room.id).emit('effect_trigger', { type: 'resurrect', playerId: targetId });
        setTimeout(() => {
          if (game.players[targetId]) game.players[targetId].invincible = false;
        }, 5000);
        setTimeout(() => {
          if (game.players[targetId] && game.players[targetId].resurrected && !game.players[targetId].eliminated) {
            game.players[targetId].alive = false;
            game.players[targetId].ghost = true;
            io.to(room.id).emit('effect_trigger', { type: 're_death', playerId: targetId });
          }
        }, 20000);
      }
    }, 10000);
    checkWin(room);
    return;
  }

  // 6. 钩吻双血
  if (companion && companion.id === 'gouwen' && method === 'kill' && !target.injured) {
    target.injured = true;
    target.speedMod = 0.8;
    io.to(targetId).emit('effect_trigger', { type: 'injured' });
    setTimeout(() => {
      if (game.players[targetId]) {
        game.players[targetId].injured = false;
        game.players[targetId].speedMod = 1;
      }
    }, 10000);
    return;
  }

  // 7. 修的根须
  if (companion && companion.id === 'xiu' && method === 'kill' && killer && killer.alive && !killer.ghost) {
    killer.rooted = true;
    io.to(room.id).emit('effect_trigger', { type: 'root', playerId: killerId });
    setTimeout(() => {
      if (game.players[killerId]) game.players[killerId].rooted = false;
    }, 15000);
  }

  // 8. 洛兰自动报告
  if (companion && companion.id === 'luolan' && method !== 'vote' && method !== 'transfer') {
    target.alive = false;
    target.ghost = true;
    io.to(room.id).emit('player_death', { playerId: targetId, method, killerId });
    setTimeout(() => {
      if (room.game && !room.ended) startMeeting(room, 'body', targetId);
    }, 1000);
    checkWin(room);
    return;
  }

  // 实际死亡
  target.alive = false;
  target.ghost = true;
  target.deathTime = Date.now();
  target.chargeFrozen = target.charge;

  io.to(room.id).emit('player_death', { playerId: targetId, method, killerId });
  checkWin(room);
}

function startMeeting(room, type, reporterId) {
  if (!room.game || room.game.phase === 'meeting' || room.ended) return;
  room.game.phase = 'meeting';
  room.game.meetings++;
  room.game.votes = {};
  room.game.voteSwap = null;
  room.game.messages = [];
  room.game.meetingTimer = 60;

  Object.values(room.game.players).forEach(p => {
    if (p.alive && !p.ghost && !p.eliminated && !p.spectating) {
      p.x = 400 + (Math.random() - 0.5) * 60;
      p.y = 300 + (Math.random() - 0.5) * 40;
    }
  });

  io.to(room.id).emit('meeting_start', { type, reporterId, timer: 60 });

  if (room.meetingTimer) clearInterval(room.meetingTimer);
  room.meetingTimer = setInterval(() => {
    if (!room.game || room.ended) { clearInterval(room.meetingTimer); return; }
    room.game.meetingTimer--;
    io.to(room.id).emit('meeting_timer', { timer: room.game.meetingTimer });
    if (room.game.meetingTimer <= 0) {
      clearInterval(room.meetingTimer);
      endMeeting(room);
    }
  }, 1000);
}

function endMeeting(room) {
  if (!room.game || room.game.phase !== 'meeting') return;

  const votes = room.game.votes;
  const voteCounts = {};
  Object.values(votes).forEach(v => {
    voteCounts[v] = (voteCounts[v] || 0) + 1;
  });

  // 夜主投票交换
  if (room.game.voteSwap) {
    const { from, to } = room.game.voteSwap;
    Object.keys(votes).forEach(voterId => {
      if (votes[voterId] === from) votes[voterId] = to;
      else if (votes[voterId] === to) votes[voterId] = from;
    });
    // 重新计数
    Object.keys(voteCounts).forEach(k => delete voteCounts[k]);
    Object.values(votes).forEach(v => {
      voteCounts[v] = (voteCounts[v] || 0) + 1;
    });
  }

  let maxVotes = 0;
  let candidates = [];
  Object.entries(voteCounts).forEach(([id, count]) => {
    if (id === 'skip') return;
    if (count > maxVotes) { maxVotes = count; candidates = [id]; }
    else if (count === maxVotes) { candidates.push(id); }
  });

  let ejected = null;
  if (candidates.length === 1 && maxVotes > 0) {
    ejected = candidates[0];
    const player = room.game.players[ejected];
    if (player) {
      player.alive = false;
      player.eliminated = true;
      player.ghost = false;
      io.to(room.id).emit('player_ejected', { playerId: ejected });

      const comp = COMPANIONS.find(c => c.id === player.companion);
      if (comp && comp.id === 'hewal') {
        const prob = dynamicProb(comp.passive.probVote || 0.1, getAlive(room.game).length + 1);
        if (Math.random() < prob) {
          const aliveOthers = Object.values(room.game.players).filter(p => p.alive && !p.ghost && p.id !== ejected);
          if (aliveOthers.length > 0) {
            const transferTarget = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
            killPlayer(room, transferTarget.id, 'transfer', ejected);
          }
        }
      }
    }
  }

  room.game.phase = 'tactical';
  room.game.tacticalTimer = 5;
  io.to(room.id).emit('meeting_end', { ejected, tacticalTime: 5 });

  setTimeout(() => {
    if (room.game && !room.ended) {
      room.game.phase = 'free';
      io.to(room.id).emit('phase_change', { phase: 'free' });
      checkWin(room);
    }
  }, 5000);
}

// Socket.io 事件
io.on('connection', socket => {
  console.log('Connected:', socket.id);

  socket.on('create_room', () => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      id: roomId, players: {}, state: 'lobby',
      host: socket.id, game: null, ended: false,
      gameLoop: null, meetingTimer: null
    };
    socket.join(roomId);
    socket.emit('room_created', { roomId });
  });

  socket.on('join_room', ({ roomId, name }) => {
    if (!rooms[roomId]) return socket.emit('error', { msg: '房间不存在' });
    const room = rooms[roomId];
    if (Object.keys(room.players).length >= 10) return socket.emit('error', { msg: '房间已满' });
    if (room.state !== 'lobby') return socket.emit('error', { msg: '游戏已开始' });

    room.players[socket.id] = {
      id: socket.id,
      name: name || '玩家' + Math.floor(Math.random() * 999),
      roomId, companion: null, ready: false
    };
    players[socket.id] = room.players[socket.id];
    socket.join(roomId);

    socket.emit('join_success', {
      roomId,
      players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, companion: p.companion })),
      host: room.host
    });
    socket.to(roomId).emit('player_joined', { id: socket.id, name: room.players[socket.id].name });
  });

  socket.on('select_partner', ({ companionId }) => {
    const player = players[socket.id];
    if (!player) return;
    const room = rooms[player.roomId];
    if (!room || room.state !== 'lobby') return;
    const taken = Object.values(room.players).some(p => p.companion === companionId);
    if (taken) return socket.emit('error', { msg: '伙伴已被选择' });
    player.companion = companionId;
    io.to(room.id).emit('partner_update', { playerId: socket.id, companionId });
  });

  socket.on('start_game', () => {
    const player = players[socket.id];
    if (!player) return;
    const room = rooms[player.roomId];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 4) return socket.emit('error', { msg: '至少需要4名玩家' });
    startGame(room);
  });

  socket.on('player_move', ({ x, y }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (!gp || !gp.alive || gp.ghost || gp.eliminated || gp.spectating || gp.rooted) return;
    if (room.game.timeStopOwner && room.game.timeStopOwner !== socket.id) return;

    gp.x = Math.max(20, Math.min(980, x));
    gp.y = Math.max(20, Math.min(680, y));
    socket.to(room.id).emit('player_moved', { id: socket.id, x: gp.x, y: gp.y });
  });

  socket.on('task_interact', ({ taskId }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (!gp || gp.role !== 'crew' || !gp.alive || gp.ghost || gp.eliminated) return;

    const task = room.game.tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;
    if (dist(gp, task) > 50) return;

    socket.emit('task_start', { task: { id: task.id, type: task.type, data: task.data } });
  });

  socket.on('task_complete', ({ taskId }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];

    const task = room.game.tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;

    task.completed = true;
    gp.charge = Math.min(3, gp.charge + 1);
    gp.taskProgress++;

    io.to(room.id).emit('task_completed', { taskId, playerId: socket.id });

    const allDone = room.game.tasks.every(t => t.completed);
    if (allDone) {
      Object.values(room.game.players).forEach(p => {
        if (p.role === 'crew') p.charge = Math.min(3, p.charge + 1);
      });
      io.to(room.id).emit('public_task_complete');
    }
    checkWin(room);
  });

  socket.on('kill_attempt', ({ targetId }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    const target = room.game.players[targetId];

    if (!gp || gp.role !== 'impostor' || !gp.alive || gp.ghost || gp.eliminated) return;
    if (!target || !target.alive || target.ghost || target.eliminated || target.invincible) return;
    if (gp.cooldowns.kill > 0) return;
    if (dist(gp, target) > 50) return;

    gp.cooldowns.kill = gp.killCooldown || 25;
    killPlayer(room, targetId, 'kill', socket.id);
  });

  socket.on('report_body', ({ targetId }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (!gp || !gp.alive || gp.ghost || gp.eliminated || gp.spectating) return;

    const target = room.game.players[targetId];
    if (!target || target.alive) return;
    if (dist(gp, target) > 60) return;

    startMeeting(room, 'body', socket.id);
  });

  socket.on('emergency_meeting', () => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (!gp || !gp.alive || gp.ghost || gp.eliminated || gp.spectating) return;
    if (room.game.emergencyUses >= 2) return socket.emit('error', { msg: '紧急会议次数已用完' });

    const canteen = MAP_ROOMS[0];
    if (Math.abs(gp.x - canteen.x) > 120 || Math.abs(gp.y - canteen.y) > 90) {
      return socket.emit('error', { msg: '必须在餐厅使用紧急按钮' });
    }

    room.game.emergencyUses++;
    startMeeting(room, 'emergency', socket.id);
  });

  socket.on('chat_message', ({ text, channel }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (!gp) return;
    if (room.game.phase !== 'meeting') return;
    if (gp.spectating) return;

    const msg = {
      id: Date.now() + Math.random(),
      playerId: socket.id, playerName: gp.name,
      text, channel: channel || 'living',
      isGhost: gp.ghost || !gp.alive,
      isEliminated: gp.eliminated
    };
    room.game.messages.push(msg);

    if (msg.channel === 'ghost') {
      Object.values(room.game.players).forEach(p => {
        if ((p.ghost || !p.alive) && !p.eliminated && !p.spectating) io.to(p.id).emit('chat_message', msg);
      });
    } else {
      Object.values(room.game.players).forEach(p => {
        if (p.alive && !p.ghost && !p.eliminated && !p.spectating) io.to(p.id).emit('chat_message', msg);
      });
    }
  });

  socket.on('vote_cast', ({ targetId }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.game.phase !== 'meeting' || room.ended) return;
    const gp = room.game.players[socket.id];
    if (!gp || !gp.alive || gp.ghost || gp.eliminated || gp.spectating) return;

    room.game.votes[socket.id] = targetId || 'skip';
    io.to(room.id).emit('vote_update', { playerId: socket.id, voted: true });

    const votedCount = Object.keys(room.game.votes).length;
    const aliveCount = Object.values(room.game.players).filter(p => p.alive && !p.ghost && !p.eliminated && !p.spectating).length;
    if (votedCount >= aliveCount) {
      if (room.meetingTimer) clearInterval(room.meetingTimer);
      endMeeting(room);
    }
  });

  socket.on('ability_use', ({ ability, targetId, data }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (!gp || !gp.alive || gp.ghost || gp.eliminated || gp.spectating) return;

    handleAbility(room, socket.id, ability, targetId, data);
  });

  socket.on('vent_use', ({ ventId, targetVentId }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (gp.role !== 'impostor' || !gp.alive || gp.ghost || gp.eliminated) return;
    if (gp.cooldowns.vent > 0) return;

    const vent = VENTS[ventId];
    const targetVent = VENTS[targetVentId];
    if (!vent || !targetVent || ventId === targetVentId) return;
    if (dist(gp, vent) > 40) return;

    gp.cooldowns.vent = 15;
    gp.x = targetVent.x;
    gp.y = targetVent.y;
    gp.inVent = true;

    io.to(socket.id).emit('vent_teleport', { x: targetVent.x, y: targetVent.y });
    socket.to(room.id).emit('player_moved', { id: socket.id, x: targetVent.x, y: targetVent.y });

    setTimeout(() => { if (gp) gp.inVent = false; }, 2000);
  });

  socket.on('sabotage', ({ type }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (gp.role !== 'impostor' || !gp.alive || gp.ghost || gp.eliminated) return;
    if (room.game.sabotages.length >= 2) return;
    if (Date.now() - room.game.lastSabotageTime < 90000) return socket.emit('error', { msg: '破坏冷却中' });

    const targetRoom = type === 'power' ? '电力间' : '氧气舱';
    const roomData = MAP_ROOMS.find(r => r.name === targetRoom);
    if (Math.abs(gp.x - roomData.x) > 100 || Math.abs(gp.y - roomData.y) > 80) return;

    room.game.sabotages.push({ type, time: Date.now() });
    room.game.lastSabotageTime = Date.now();

    if (type === 'oxygen') {
      room.game.oxygenSabotage = true;
      room.game.oxygenTimer = 60;
    }

    io.to(room.id).emit('sabotage_start', { type });
  });

  socket.on('fix_sabotage', ({ type }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (gp.role !== 'crew' || !gp.alive || gp.ghost || gp.eliminated) return;

    const targetRoom = type === 'power' ? '电力间' : '氧气舱';
    const roomData = MAP_ROOMS.find(r => r.name === targetRoom);
    if (Math.abs(gp.x - roomData.x) > 100 || Math.abs(gp.y - roomData.y) > 80) return;

    if (type === 'oxygen') {
      room.game.oxygenSabotage = false;
      room.game.oxygenTimer = 0;
    } else if (type === 'power') {
      room.game.powerSabotage = false;
    }

    io.to(room.id).emit('sabotage_fixed', { type });
  });

  socket.on('impostor_chat', ({ text }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game || room.ended) return;
    const gp = room.game.players[socket.id];
    if (gp.role !== 'impostor' || !gp.alive || gp.ghost || gp.eliminated) return;

    Object.values(room.game.players).forEach(p => {
      if (p.role === 'impostor' && p.alive && !p.ghost && !p.eliminated) {
        io.to(p.id).emit('impostor_chat', { playerId: socket.id, playerName: gp.name, text });
      }
    });
  });

  socket.on('spectate_choice', ({ choice }) => {
    const player = players[socket.id];
    if (!player || !player.roomId) return;
    const room = rooms[player.roomId];
    if (!room || !room.game) return;
    const gp = room.game.players[socket.id];
    if (!gp || !gp.eliminated) return;

    if (choice === 'leave') {
      socket.leave(room.id);
      delete room.players[socket.id];
      delete players[socket.id];
      socket.emit('left_room');
    } else {
      gp.spectating = true;
      socket.emit('spectate_start');
    }
  });

  socket.on('disconnect', () => {
    const player = players[socket.id];
    if (player && player.roomId && rooms[player.roomId]) {
      const room = rooms[player.roomId];
      delete room.players[socket.id];
      io.to(room.id).emit('player_left', { id: socket.id });
      if (Object.keys(room.players).length === 0) {
        if (room.gameLoop) clearInterval(room.gameLoop);
        if (room.meetingTimer) clearInterval(room.meetingTimer);
        delete rooms[player.roomId];
      } else if (room.host === socket.id) {
        const remaining = Object.keys(room.players);
        if (remaining.length > 0) {
          room.host = remaining[0];
          io.to(room.id).emit('host_changed', { host: room.host });
        }
      }
    }
    delete players[socket.id];
  });
});

function handleAbility(room, playerId, ability, targetId, data) {
  const game = room.game;
  const gp = game.players[playerId];
  const target = game.players[targetId];
  const comp = COMPANIONS.find(c => c.id === gp.companion);
  if (!comp) return;

  switch (ability) {
    case 'time_stop':
      if (gp.companion === 'fengye' && gp.role === 'impostor' && room.game.phase === 'free') {
        game.timeStopOwner = playerId;
        io.to(room.id).emit('effect_trigger', { type: 'time_stop', owner: playerId });
        setTimeout(() => {
          if (game.timeStopOwner === playerId) {
            game.timeStopOwner = null;
            io.to(room.id).emit('effect_end', { type: 'time_stop' });
          }
        }, 15000);
      }
      break;
    case 'invis':
      if (gp.companion === 'hewal' && gp.role === 'impostor' && room.game.phase === 'tactical') {
        gp.invisible = true;
        io.to(room.id).emit('effect_trigger', { type: 'invis', playerId });
        setTimeout(() => {
          if (game.players[playerId]) game.players[playerId].invisible = false;
        }, 10000);
      }
      break;
    case 'disguise':
      if (gp.companion === 'yezhu' && gp.role === 'impostor' && target && room.game.phase === 'tactical') {
        gp.disguised = { name: target.name, emoji: target.emoji };
        gp.speedMod = 1;
        io.to(room.id).emit('effect_trigger', { type: 'disguise', playerId, targetId });
        setTimeout(() => {
          if (game.players[playerId]) {
            game.players[playerId].disguised = null;
            game.players[playerId].speedMod = 0.8;
          }
        }, 15000);
        setTimeout(() => {
          if (game.players[playerId]) game.players[playerId].speedMod = 1;
        }, 25000);
      }
      break;
    case 'trap':
      if (gp.companion === 'yuansheng' && gp.role === 'impostor' && room.game.phase === 'tactical') {
        game.traps.push({ x: gp.x, y: gp.y, owner: playerId, time: 10 });
        io.to(room.id).emit('effect_trigger', { type: 'trap_set', playerId, x: gp.x, y: gp.y });
      }
      break;
    case 'righteous_kill':
      if (gp.companion === 'fengye' && gp.role === 'crew' && target && room.game.phase === 'tactical') {
        if (target.role === 'impostor') {
          killPlayer(room, targetId, 'righteous', playerId);
          io.to(room.id).emit('effect_trigger', { type: 'execution', targetId });
        } else {
          gp.alive = false;
          gp.eliminated = true;
          io.to(room.id).emit('effect_trigger', { type: 'wrong_kill', playerId });
          checkWin(room);
        }
      }
      break;
    case 'resurrect':
      if (gp.companion === 'pugelisi' && target && target.ghost && !target.eliminated && room.game.phase === 'tactical') {
        target.alive = true;
        target.ghost = false;
        target.mute = true;
        io.to(room.id).emit('effect_trigger', { type: 'resurrect', playerId: targetId });
      }
      break;
    case 'control_attack':
      if (gp.companion === 'yuyu' && gp.role === 'impostor' && target && room.game.phase === 'tactical') {
        io.to(targetId).emit('controlled', { attacker: data?.targetId });
        if (data?.targetId && game.players[data.targetId]) {
          const victim = game.players[data.targetId];
          if (victim.alive && !victim.ghost && !victim.eliminated) {
            setTimeout(() => killPlayer(room, data.targetId, 'control', playerId), 500);
          }
        }
      }
      break;
    case 'vote_swap':
      if (gp.companion === 'yezhu' && gp.role === 'crew' && room.game.phase === 'tactical') {
        game.voteSwap = { from: targetId, to: data?.swapTarget };
        io.to(playerId).emit('effect_trigger', { type: 'vote_swap_ready' });
      }
      break;
    case 'charge_skill':
      if (data?.skill === 'barrier' && gp.companion === 'nightingale' && gp.charge >= 2) {
        gp.charge -= 2;
        gp.barrier = true;
        io.to(playerId).emit('charge_used', { charge: gp.charge });
        setTimeout(() => { if (game.players[playerId]) game.players[playerId].barrier = false; }, 10);
      }
      if (data?.skill === 'speed' && gp.companion === 'gouwen' && gp.charge >= 1 && room.game.phase === 'tactical') {
        gp.charge -= 1;
        gp.speedMod = 1.5;
        io.to(playerId).emit('charge_used', { charge: gp.charge });
        setTimeout(() => { if (game.players[playerId]) game.players[playerId].speedMod = 1; }, 15000);
      }
      if (data?.skill === 'check' && gp.companion === 'hewal' && gp.charge >= 3 && target && room.game.phase === 'tactical') {
        gp.charge -= 3;
        io.to(playerId).emit('charge_used', { charge: gp.charge });
        io.to(playerId).emit('check_result', { playerId: targetId, role: target.role });
      }
      break;
    case 'vent_sense':
      if (gp.companion === 'luolan') {
        const nearVent = VENTS.find(v => dist(gp, v) < 25);
        if (nearVent) {
          const inVent = Object.values(game.players).some(p => p.inVent && p.id !== playerId);
          io.to(playerId).emit('vent_sense_result', { detected: inVent, ventId: nearVent.id });
        }
      }
      break;
    case 'curse':
      if (gp.companion === 'xiu' && gp.role === 'impostor' && target && room.game.phase === 'tactical') {
        io.to(room.id).emit('effect_trigger', { type: 'curse_cast', targetId, sourceId: playerId });
        setTimeout(() => {
          if (game.players[targetId] && game.players[targetId].alive && !game.players[targetId].ghost) {
            killPlayer(room, targetId, 'curse', playerId);
          }
        }, 10000);
      }
      break;
  }
}

server.listen(3000, () => {
  console.log('Cyberpunk Among Us server running on port 3000');
});
