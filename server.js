const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// 직업 정의
const ROLES = {
  MAFIA_BOSS: { name: '마피아 보스', team: 'MAFIA', icon: '👑', desc: '마피아 지휘관입니다. 경찰 조사 시 시민으로 위장됩니다.' },
  MAFIA: { name: '마피아', team: 'MAFIA', icon: '🩸', desc: '밤마다 동료들과 함께 제거할 시민을 비밀 투표로 결정합니다.' },
  POLICE: { name: '경찰', team: 'CITIZEN', icon: '🔍', desc: '밤마다 플레이어 1명을 조사하여 마피아 여부를 즉시 알아냅니다.' },
  DOCTOR: { name: '의사', team: 'CITIZEN', icon: '💉', desc: '밤마다 플레이어 1명을 지목해 마피아의 습격으로부터 생명을 지킵니다.' },
  DETECTIVE: { name: '사설탐정', team: 'CITIZEN', icon: '🕵️', desc: '밤마다 1명을 감시하여 그가 밤에 누구를 방문했는지 추적합니다.' },
  CITIZEN: { name: '선량한 시민', team: 'CITIZEN', icon: '🧑‍🌾', desc: '특수 능력은 없지만 낮 토론과 투표로 마피아를 색출하는 다수파입니다.' }
};

// 5~35인 인원수별 황금 직업 밸런스 자동 산출 공식
function getAutoRoleDeck(total) {
  total = Math.max(5, Math.min(35, total));
  let mafia = 1;
  let police = 1;
  let doctor = 1;
  let detective = 0;

  if (total <= 6) {
    // 5~6인: 마피아 1 (보스 1명), 경찰 1, 의사 1, 시민 2~3
    mafia = 1; police = 1; doctor = 1; detective = 0;
  } else if (total <= 9) {
    // 7~9인: 마피아 2 (보스 1 + 마피아 1), 경찰 1, 의사 1, 시민 3~5
    mafia = 2; police = 1; doctor = 1; detective = 0;
  } else if (total <= 12) {
    // 10~12인: 마피아 3 (보스 1 + 마피아 2), 경찰 1, 의사 1, 사설탐정 1, 시민 4~6
    mafia = 3; police = 1; doctor = 1; detective = 1;
  } else if (total <= 15) {
    // 13~15인: 마피아 4, 경찰 2, 의사 1, 사설탐정 1, 시민 5~7
    mafia = 4; police = 2; doctor = 1; detective = 1;
  } else if (total <= 19) {
    // 16~19인: 마피아 4, 경찰 2, 의사 2, 사설탐정 1, 시민 7~10
    mafia = 4; police = 2; doctor = 2; detective = 1;
  } else if (total <= 23) {
    // 20~23인: 마피아 5, 경찰 2, 의사 2, 사설탐정 1, 시민 10~13
    mafia = 5; police = 2; doctor = 2; detective = 1;
  } else if (total <= 27) {
    // 24~27인: 마피아 6, 경찰 2, 의사 2, 사설탐정 1, 시민 13~16
    mafia = 6; police = 2; doctor = 2; detective = 1;
  } else if (total <= 31) {
    // 28~31인: 마피아 7, 경찰 2, 의사 2, 사설탐정 1, 시민 16~19
    mafia = 7; police = 2; doctor = 2; detective = 1;
  } else if (total <= 33) {
    // 32~33인: 마피아 8, 경찰 2, 의사 2, 사설탐정 1, 시민 19~20
    mafia = 8; police = 2; doctor = 2; detective = 1;
  } else {
    // 34~35인: 마피아 8, 경찰 3, 의사 2, 사설탐정 1, 시민 20~21
    mafia = 8; police = 3; doctor = 2; detective = 1;
  }

  const citizen = Math.max(1, total - (mafia + police + doctor + detective));
  return { mafia, police, doctor, detective, citizen };
}

// 게임 전역 상태
const gameState = {
  roomCode: 'MAFIA30',
  phase: 'LOBBY',
  round: 1,
  players: [], // { socketId, id, number, name, role, isAlive, deathReason }
  roleDeckConfig: getAutoRoleDeck(10),
  timerSeconds: 0,
  timerInterval: null,
  nominationVotes: {},
  trialCandidate: null,
  verdictVotes: { guilty: 0, innocent: 0, votedSockets: new Set() },
  nightActions: {
    mafiaVotes: {},
    doctorTarget: null,
    policeTarget: null
  },
  lastNightReport: null,
  winner: null
};

function broadcastState() {
  const currentCount = gameState.players.length;
  gameState.roleDeckConfig = getAutoRoleDeck(currentCount >= 5 ? currentCount : 10);

  io.emit('state:update', {
    phase: gameState.phase,
    round: gameState.round,
    playerCount: currentCount,
    roleDeckConfig: gameState.roleDeckConfig,
    timerSeconds: gameState.timerSeconds,
    players: gameState.players.map(p => ({
      id: p.id,
      number: p.number,
      name: p.name,
      isAlive: p.isAlive,
      deathReason: p.deathReason,
      role: !p.isAlive || gameState.phase === 'GAME_OVER' ? p.role : null
    })),
    trialCandidate: gameState.trialCandidate,
    nominationVotes: gameState.nominationVotes,
    verdictVotes: {
      guilty: gameState.verdictVotes.guilty,
      innocent: gameState.verdictVotes.innocent
    },
    lastNightReport: gameState.lastNightReport,
    winner: gameState.winner
  });
}

function startTimer(seconds, onComplete) {
  clearInterval(gameState.timerInterval);
  gameState.timerSeconds = seconds;
  io.emit('timer:tick', gameState.timerSeconds);

  gameState.timerInterval = setInterval(() => {
    gameState.timerSeconds--;
    io.emit('timer:tick', gameState.timerSeconds);

    if (gameState.timerSeconds <= 0) {
      clearInterval(gameState.timerInterval);
      if (onComplete) onComplete();
    }
  }, 1000);
}

function checkVictory() {
  const alivePlayers = gameState.players.filter(p => p.isAlive);
  const aliveMafia = alivePlayers.filter(p => p.role && ROLES[p.role]?.team === 'MAFIA');
  const aliveCitizens = alivePlayers.filter(p => p.role && ROLES[p.role]?.team === 'CITIZEN');

  if (aliveMafia.length === 0) return 'CITIZEN';
  if (aliveMafia.length >= aliveCitizens.length) return 'MAFIA';
  return null;
}

// 개별 플레이어에게 비밀 직업 정보 발송
function sendSecretRolesToPlayers() {
  gameState.players.forEach(p => {
    if (!p.socketId) return;
    const roleObj = ROLES[p.role] || ROLES.CITIZEN;
    let teammates = [];
    if (roleObj.team === 'MAFIA') {
      teammates = gameState.players
        .filter(tm => tm.id !== p.id && ROLES[tm.role]?.team === 'MAFIA')
        .map(tm => ({ number: tm.number, name: tm.name }));
    }

    io.to(p.socketId).emit('player:secret_role', {
      role: p.role,
      roleName: roleObj.name,
      team: roleObj.team,
      icon: roleObj.icon,
      desc: roleObj.desc,
      teammates: teammates
    });
  });
}

io.on('connection', (socket) => {
  console.log(`클라이언트 접속: ${socket.id}`);

  // 1. 방 초기화 및 현재 상태 전송
  socket.emit('init', {
    phase: gameState.phase,
    round: gameState.round,
    roleDeckConfig: gameState.roleDeckConfig
  });
  broadcastState();

  // 2. 플레이어 참가 (닉네임 등록)
  socket.on('player:join', ({ name }) => {
    let cleanName = (name || '').trim();
    if (!cleanName) cleanName = `참가자 ${gameState.players.length + 1}`;

    // 기존 소켓 재접속 확인
    let existingPlayer = gameState.players.find(p => p.socketId === socket.id || p.name === cleanName);
    if (existingPlayer) {
      existingPlayer.socketId = socket.id;
      socket.emit('player:joined_success', {
        id: existingPlayer.id,
        number: existingPlayer.number,
        name: existingPlayer.name
      });
      if (existingPlayer.role) {
        sendSecretRolesToPlayers();
      }
      broadcastState();
      return;
    }

    if (gameState.phase !== 'LOBBY') {
      socket.emit('error_message', '이미 게임이 진행 중입니다. 관전 모드로 접속합니다.');
      return;
    }

    if (gameState.players.length >= 35) {
      socket.emit('error_message', '최대 인원(35명)이 꽉 찼습니다.');
      return;
    }

    const assignedNumber = gameState.players.length + 1;
    const newPlayer = {
      socketId: socket.id,
      id: assignedNumber,
      number: assignedNumber,
      name: cleanName,
      role: null,
      isAlive: true,
      deathReason: null,
      votedFor: null
    };

    gameState.players.push(newPlayer);
    socket.emit('player:joined_success', {
      id: newPlayer.id,
      number: newPlayer.number,
      name: newPlayer.name
    });

    console.log(`플레이어 등록: [${newPlayer.number}번] ${newPlayer.name} (현재 총 ${gameState.players.length}명)`);
    broadcastState();
  });

  // 3. 호스트: 게임 시작 (정확한 인원수 자동 밸런스 적용)
  socket.on('host:start_game', () => {
    if (gameState.phase !== 'LOBBY') return;
    const total = gameState.players.length;
    if (total < 5) {
      socket.emit('error_message', '원활한 진행을 위해 최소 5명 이상 접속해야 합니다.');
      return;
    }

    gameState.roleDeckConfig = getAutoRoleDeck(total);
    const cfg = gameState.roleDeckConfig;

    // 직업 덱 생성
    const deck = [];
    if (cfg.mafia > 0) {
      deck.push('MAFIA_BOSS'); // 마피아 첫 번째는 보스
      for (let i = 0; i < cfg.mafia - 1; i++) deck.push('MAFIA');
    }
    for (let i = 0; i < cfg.police; i++) deck.push('POLICE');
    for (let i = 0; i < cfg.doctor; i++) deck.push('DOCTOR');
    for (let i = 0; i < cfg.detective; i++) deck.push('DETECTIVE');
    while (deck.length < total) deck.push('CITIZEN');

    // 셔플
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    gameState.players.forEach((p, idx) => {
      p.role = deck[idx] || 'CITIZEN';
      p.isAlive = true;
      p.deathReason = null;
    });

    console.log(`게임 시작 (${total}인 배분): 마피아 ${cfg.mafia}, 경찰 ${cfg.police}, 의사 ${cfg.doctor}, 탐정 ${cfg.detective}, 시민 ${cfg.citizen}`);

    sendSecretRolesToPlayers();

    gameState.phase = 'FIRST_NIGHT';
    gameState.round = 1;
    broadcastState();

    startTimer(45, () => {
      startDayDiscuss();
    });
  });

  // 낮 토론 시작
  function startDayDiscuss() {
    gameState.phase = 'DAY_DISCUSS';
    broadcastState();
    startTimer(120, () => {
      startNomination();
    });
  }

  // 후보 지목 시작
  function startNomination() {
    gameState.phase = 'DAY_NOMINATE';
    gameState.nominationVotes = {};
    broadcastState();
    startTimer(30, () => {
      resolveNomination();
    });
  }

  // 플레이어: 후보 지목 투표
  socket.on('player:nominate', ({ targetId }) => {
    const voter = gameState.players.find(p => p.socketId === socket.id);
    if (!voter || !voter.isAlive || gameState.phase !== 'DAY_NOMINATE') return;

    gameState.nominationVotes[targetId] = (gameState.nominationVotes[targetId] || 0) + 1;
    broadcastState();
  });

  function resolveNomination() {
    let topId = null;
    let maxV = -1;
    Object.entries(gameState.nominationVotes).forEach(([id, cnt]) => {
      if (cnt > maxV) {
        maxV = cnt;
        topId = parseInt(id);
      }
    });

    const alive = gameState.players.filter(p => p.isAlive);
    gameState.trialCandidate = alive.find(p => p.id === topId) || alive[0];

    gameState.phase = 'DAY_TRIAL';
    broadcastState();
    startTimer(30, () => {
      startVerdict();
    });
  }

  function startVerdict() {
    gameState.phase = 'DAY_VERDICT';
    gameState.verdictVotes = { guilty: 0, innocent: 0, votedSockets: new Set() };
    broadcastState();
    startTimer(15, () => {
      resolveVerdict();
    });
  }

  // 플레이어: 유죄/무죄 투표
  socket.on('player:verdict', ({ vote }) => {
    const voter = gameState.players.find(p => p.socketId === socket.id);
    if (!voter || !voter.isAlive || gameState.phase !== 'DAY_VERDICT') return;
    if (gameState.verdictVotes.votedSockets.has(socket.id)) return;

    gameState.verdictVotes.votedSockets.add(socket.id);
    if (vote === 'guilty') gameState.verdictVotes.guilty++;
    else if (vote === 'innocent') gameState.verdictVotes.innocent++;

    broadcastState();
  });

  function resolveVerdict() {
    const aliveCount = gameState.players.filter(p => p.isAlive).length;
    const isGuilty = gameState.verdictVotes.guilty > gameState.verdictVotes.innocent && gameState.verdictVotes.guilty >= Math.floor(aliveCount / 2);

    if (isGuilty && gameState.trialCandidate) {
      gameState.trialCandidate.isAlive = false;
      gameState.trialCandidate.deathReason = '투표로 처형됨';
    }

    broadcastState();

    setTimeout(() => {
      const victory = checkVictory();
      if (victory) {
        gameState.phase = 'GAME_OVER';
        gameState.winner = victory;
        broadcastState();
      } else {
        startNight();
      }
    }, 4000);
  }

  function startNight() {
    gameState.phase = 'NIGHT';
    gameState.nightActions = {
      mafiaVotes: {},
      doctorTarget: null,
      policeTarget: null
    };
    broadcastState();
    startTimer(40, () => {
      resolveNight();
    });
  }

  // 플레이어: 밤 행동 제출
  socket.on('player:night_action', ({ action, targetId }) => {
    const player = gameState.players.find(p => p.socketId === socket.id);
    if (!player || !player.isAlive || gameState.phase !== 'NIGHT') return;

    const tid = parseInt(targetId);
    if (action === 'mafia_kill' && ROLES[player.role]?.team === 'MAFIA') {
      gameState.nightActions.mafiaVotes[tid] = (gameState.nightActions.mafiaVotes[tid] || 0) + 1;
      const mafiaSockets = gameState.players.filter(p => ROLES[p.role]?.team === 'MAFIA' && p.isAlive).map(p => p.socketId);
      mafiaSockets.forEach(sId => {
        io.to(sId).emit('mafia:sync_target', gameState.nightActions.mafiaVotes);
      });
    } else if (action === 'doctor_heal' && player.role === 'DOCTOR') {
      gameState.nightActions.doctorTarget = tid;
      socket.emit('action_confirmed', '치료 대상이 설정되었습니다.');
    } else if (action === 'police_check' && player.role === 'POLICE') {
      const target = gameState.players.find(p => p.id === tid);
      const isMafia = target && ROLES[target.role]?.team === 'MAFIA' && target.role !== 'MAFIA_BOSS';
      socket.emit('police:result', {
        targetNumber: target ? target.number : 0,
        targetName: target ? target.name : '알 수 없음',
        isMafia: isMafia
      });
    }
  });

  function resolveNight() {
    let mafiaTargetId = null;
    let maxV = -1;
    Object.entries(gameState.nightActions.mafiaVotes).forEach(([id, cnt]) => {
      if (cnt > maxV) {
        maxV = cnt;
        mafiaTargetId = parseInt(id);
      }
    });

    const doctorSaved = gameState.nightActions.doctorTarget === mafiaTargetId;
    let victim = null;

    if (mafiaTargetId && !doctorSaved) {
      victim = gameState.players.find(p => p.id === mafiaTargetId);
      if (victim) {
        victim.isAlive = false;
        victim.deathReason = '마피아의 습격으로 사망';
      }
    }

    gameState.lastNightReport = { victim, doctorSaved };
    gameState.round++;
    gameState.phase = 'MORNING_REPORT';
    broadcastState();

    const victory = checkVictory();
    if (victory) {
      setTimeout(() => {
        gameState.phase = 'GAME_OVER';
        gameState.winner = victory;
        broadcastState();
      }, 5000);
    }
  }

  // 호스트: 수동 단계 진행
  socket.on('host:next_phase', () => {
    clearInterval(gameState.timerInterval);
    if (gameState.phase === 'FIRST_NIGHT') startDayDiscuss();
    else if (gameState.phase === 'DAY_DISCUSS') startNomination();
    else if (gameState.phase === 'DAY_NOMINATE') resolveNomination();
    else if (gameState.phase === 'DAY_TRIAL') startVerdict();
    else if (gameState.phase === 'DAY_VERDICT') resolveVerdict();
    else if (gameState.phase === 'NIGHT') resolveNight();
    else if (gameState.phase === 'MORNING_REPORT') startDayDiscuss();
  });

  // 호스트: 다음 라운드 준비 (접속된 참가자는 유지하고 직업/투표만 초기화)
  socket.on('host:reset_game', () => {
    clearInterval(gameState.timerInterval);
    gameState.phase = 'LOBBY';
    gameState.round = 1;
    
    // 현재 접속 중인 플레이어들의 상태만 리셋 (재접속 필요 없음!)
    gameState.players.forEach(p => {
      p.role = null;
      p.isAlive = true;
      p.deathReason = null;
      p.votedFor = null;
    });

    gameState.trialCandidate = null;
    gameState.nominationVotes = {};
    gameState.verdictVotes = { guilty: 0, innocent: 0, votedSockets: new Set() };
    gameState.nightActions = { mafiaVotes: {}, doctorTarget: null, policeTarget: null };
    gameState.lastNightReport = null;
    gameState.winner = null;

    // 현재 인원수에 맞춰 정확하게 직업 밸런스 재계산
    gameState.roleDeckConfig = getAutoRoleDeck(gameState.players.length || 10);

    // 모바일 클라이언트에게도 로비 초기화 신호 전송
    io.emit('player:reset_to_lobby');
    broadcastState();
    console.log(`방 초기화 완료: 현재 접속 인원 ${gameState.players.length}명 유지`);
  });

  // 호스트: 완전 초기화 (참가자 전원 방 퇴장)
  socket.on('host:kick_all', () => {
    clearInterval(gameState.timerInterval);
    gameState.phase = 'LOBBY';
    gameState.round = 1;
    gameState.players = [];
    gameState.trialCandidate = null;
    gameState.nominationVotes = {};
    gameState.verdictVotes = { guilty: 0, innocent: 0, votedSockets: new Set() };
    gameState.nightActions = { mafiaVotes: {}, doctorTarget: null, policeTarget: null };
    gameState.lastNightReport = null;
    gameState.winner = null;
    gameState.roleDeckConfig = getAutoRoleDeck(10);

    io.emit('player:force_kick');
    broadcastState();
  });

  // 연결 종료 시: 로비 상태면 명단에서 제거하여 정확한 인원수 유지
  socket.on('disconnect', () => {
    if (gameState.phase === 'LOBBY') {
      const idx = gameState.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        const removed = gameState.players.splice(idx, 1)[0];
        console.log(`로비 퇴장: [${removed.number}번] ${removed.name} (남은 인원: ${gameState.players.length}명)`);
        // 번호 재정렬
        gameState.players.forEach((p, i) => {
          p.id = i + 1;
          p.number = i + 1;
        });
        broadcastState();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🎲 5~35인 마피아 스마트 서버가 시작되었습니다!`);
  console.log(`📺 빔프로젝터(호스트) 화면: http://localhost:${PORT}/host`);
  console.log(`📱 스마트폰 참가자 화면:     http://localhost:${PORT}`);
  console.log(`=================================================`);
});
