import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import {createClient} from '@libsql/client';

import { Server } from 'socket.io';
import { createServer } from 'node:http';

dotenv.config();

const port = process.env.PORT ?? 3000;

const app = express();
const server= createServer(app);

const io = new Server(server, {
    connectionStateRecovery:{

    }

});

const db = createClient({
    url: 'libsql://teaching-atlas-diadre.aws-eu-west-1.turso.io',
    authToken: process.env.DB_TOKEN
})

await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    user TEXT,
    from_user TEXT,
    to_user TEXT,
    timestamp INTEGER
    )
`);



    io.on('connection', async (socket) => {
    console.log('Un usuario se ha conectado');

    //const username = socket.handshake.auth.username;
    const userId = socket.handshake.auth.userId;

    if (userId) {
        socket.join(userId); // Permite que cada usuario se una a su propia "sala"
      }

    socket.on('disconnect', () => {
        console.log('Un usuario se ha desconectado');
    })

    socket.on('chat message', async (msg) => {
        console.log('Mensaje recibido del cliente:', msg);
        let username = msg.username || socket.handshake.auth.username || 'anonymous';

        console.log(`[Servidor] Recibido mensaje: "${msg.message}" de ${username} (${msg.from}) para ${msg.to}`);
        
        try {
            const result = await db.execute({
              sql: "INSERT INTO messages (content, user, from_user, to_user, timestamp) VALUES (?, ?, ?, ?, ?)",
              args: [msg.message, username, msg.from, msg.to, Date.now()],
            });
    
            const fullMessage = {
              message: msg.message,
              from: msg.from,
              to: msg.to,
              username: username,
            };
    
            if (msg.to && msg.from) {
              io.to(msg.from).emit("chat message", fullMessage, result.lastInsertRowid.toString(), username);
              io.to(msg.to).emit("chat message", fullMessage, result.lastInsertRowid.toString(), username);
            } else {
              io.emit("chat message", fullMessage, result.lastInsertRowid.toString(), username);
            }
        } catch (e) {
            console.error('Error saving message:', e);
            return;
        }
    });

    
    //Permite cargar historial al conectar
  if (!socket.recovered && userId && socket.handshake.auth.otherUserId) {
    try {
        const otherUserId = socket.handshake.auth.otherUserId;
    
        const results = await db.execute({
          sql: `
            SELECT * FROM messages 
            WHERE (from_user = ? AND to_user = ?)
               OR (from_user = ? AND to_user = ?)
            ORDER BY id ASC`,
          args: [userId, otherUserId, otherUserId, userId],
        });
    
        for (const row of results.rows) {
          socket.emit("chat message", {
            message: row.content,
            from: row.from_user,
            to: row.to_user,
            username: row.user,
            timestamp: row.timestamp,
          }, row.id.toString(), row.user);
        }
      } catch (e) {
        console.error('Error recovering messages:', e);
      }
    }
});

app.use(logger('dev'));

app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '/client/index.html')
})

server.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`)
})
