/* ============================================================
   DINOKALIPSA — serwer relay (Node.js + Express + Socket.io)
   ------------------------------------------------------------
   Ten serwer NIE zna zasad gry ani kart. Jego jedyna praca to:
   1) trzymać rejestr pokoi (roomCode -> kto jest hostem, jacy
      gracze są podłączeni i pod jakim socket.id),
   2) przekazywać wiadomości między Hostem a Klientami:
        - klient -> host   (wybór karty, karta natychmiastowa...)
        - host -> jeden konkretny gracz (spersonalizowany stan,
          żeby czyjaś ręka kart nigdy nie trafiła do innych)
        - host -> cały pokój (np. lista graczy w lobby)
   Cała logika gry (talia, punkty, dinozaury, zwycięstwo) zostaje
   w przeglądarce Hosta — dokładnie tak jak w wersji PeerJS.
   ============================================================ */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // proste ustawienie CORS, wystarczające dla Glitch
});

// Serwuje frontend (public/index.html = cała gra) jako statyczną stronę.
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Prosty endpoint diagnostyczny — przydatny do "budzenia" projektu na Glitch
// oraz do szybkiego sprawdzenia, czy serwer żyje.
app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: Object.keys(rooms).length });
});

/* rooms[roomCode] = {
     hostSocketId: string,
     players: { [playerId]: socketId }
   } */
const rooms = {};

io.on('connection', (socket) => {
  console.log('[connect]', socket.id);

  // --- Host tworzy pokój ---
  socket.on('create-room', ({ roomCode, playerId, name }) => {
    if (!roomCode || !playerId) return;
    rooms[roomCode] = {
      hostSocketId: socket.id,
      players: { [playerId]: socket.id },
    };
    socket.join(roomCode);
    socket.data = { roomCode, playerId, isHost: true };
    console.log(`[room] utworzono ${roomCode} przez "${name}" (${playerId})`);
  });

  // --- Klient dołącza do istniejącego pokoju ---
  socket.on('join-room', ({ roomCode, playerId, name }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('join-error', { message: 'Nie znaleziono pokoju o podanym kodzie. Sprawdź, czy Host ma uruchomione lobby.' });
      return;
    }
    room.players[playerId] = socket.id;
    socket.join(roomCode);
    socket.data = { roomCode, playerId, isHost: false };

    // Powiadom Hosta, że dołączył nowy gracz — Host doda go do swojego
    // stanu gry i sam roześle zaktualizowane lobby.
    io.to(room.hostSocketId).emit('player-joined', { playerId, name });
    socket.emit('join-ok', { roomCode });
    console.log(`[room] "${name}" (${playerId}) dołączył do ${roomCode}`);
  });

  // --- Klient -> Host: akcja w grze (wybór karty, karta natychmiastowa...) ---
  socket.on('to-host', ({ roomCode, msg }) => {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(room.hostSocketId).emit('host-message', { fromId: socket.data && socket.data.playerId, msg });
  });

  // --- Host -> jeden konkretny gracz: spersonalizowany stan gry ---
  socket.on('to-player', ({ roomCode, targetPlayerId, payload }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const targetSocketId = room.players[targetPlayerId];
    if (targetSocketId) io.to(targetSocketId).emit('state', payload);
  });

  // --- Host -> wszyscy w pokoju (np. aktualizacja listy graczy w lobby) ---
  socket.on('to-room', ({ roomCode, payload }) => {
    socket.to(roomCode).emit('lobby', payload);
  });

  socket.on('disconnect', () => {
    const data = socket.data;
    console.log('[disconnect]', socket.id);
    if (!data) return;
    const room = rooms[data.roomCode];
    if (!room) return;

    delete room.players[data.playerId];

    if (data.isHost) {
      // Host odpadł — pokój przestaje istnieć, informujemy resztę.
      io.to(data.roomCode).emit('host-disconnected');
      delete rooms[data.roomCode];
      console.log(`[room] ${data.roomCode} zamknięty (host rozłączony)`);
    } else {
      io.to(room.hostSocketId).emit('player-left', { playerId: data.playerId });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Dinokalipsa server działa na porcie ' + PORT);
});
