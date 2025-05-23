require('dotenv').config();
const fs          = require('fs');
const path        = require('path');
const http        = require('http');
const axios       = require('axios');
const TelegramBot = require('node-telegram-bot-api');

// ——— Agente IPv4-only ———
const ipv4agent = new http.Agent({ family: 4 });

// ——— Stale-lock check ———
const lockFile = path.join(__dirname, 'bot.lock');
if (fs.existsSync(lockFile)) {
  const oldPid = parseInt(fs.readFileSync(lockFile, 'utf8'), 10);
  try {
    process.kill(oldPid, 0);
    console.error(`Instancia activa (PID ${oldPid}). Abortando.`);
    process.exit(1);
  } catch {
    console.warn(`Lock huérfano (PID ${oldPid}). Eliminando lock.`);
    fs.unlinkSync(lockFile);
  }
}
fs.writeFileSync(lockFile, process.pid.toString());

// ——— Limpieza en salida ———
function cleanupAndExit(code = 0) {
  if (isPolling) bot.stopPolling();
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  process.exit(code);
}
process.on('SIGINT',  () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
process.on('exit',    () => cleanupAndExit(0));
process.on('uncaughtException', err => {
  console.error('❌ Excepción no capturada:', err);
  cleanupAndExit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ Rechazo de promesa no manejado:', reason);
  cleanupAndExit(1);
});

// ——— Token & Bot ———
const token          = process.env.BOT_TOKEN;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
let isPolling = false;

const bot = new TelegramBot(token, { polling: false });

async function startPolling() {
  if (isPolling) return;
  try {
    await bot.startPolling({ interval: 300, params: { timeout: 10 } });
    isPolling = true;
    console.log('✅ Polling iniciado');
  } catch (err) {
    console.error('❌ Error al iniciar polling:', err.message);
    isPolling = false;
  }
}

// ——— Manejo de errores de polling ———
bot.on('polling_error', error => {
  console.error('❌ Polling error:', error.message);
  isPolling = false;
  bot.stopPolling()
     .finally(() => setTimeout(startPolling, 5000));
});

// ——— Ping monitor para detectar inactividad ———
let pingFailures = 0;
const MAX_PING_FAILURES = 3;
function startPingMonitor() {
  setInterval(async () => {
    try {
      await bot.getMe();
      pingFailures = 0;
    } catch (err) {
      pingFailures++;
      console.warn(`Ping fallo ${pingFailures}/${MAX_PING_FAILURES}:`, err.message);
      if (pingFailures >= MAX_PING_FAILURES) {
        console.error('🔄 Reiniciando bot por inactividad de conexión');
        pingFailures = 0;
        isPolling = false;
        await bot.stopPolling();
        startPolling();
      }
    }
  }, 60 * 1000); // cada 60s
}

// ——— Función para enviar a n8n ———
async function sendToN8n(data) {
  try {
    console.log('→ Enviando a n8n:', data);
    const res = await axios.post(N8N_WEBHOOK_URL, data, { httpAgent: ipv4agent });
    console.log('← Respuesta n8n:', res.data);
    return res.data;
  } catch (err) {
    console.error('❌ Error n8n:', err.response?.data || err.message);
    return null;
  }
}

// ——— Comandos y mensajes ———
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id, '¡Hola! Soy tu bot de Telegram. ¿En qué puedo ayudarte?');
});

bot.on('message', async msg => {
  if (msg.text.startsWith('/')) return;
  const payload = {
    chatId:   msg.chat.id,
    message:  msg.text,
    username: msg.from.username,
    firstName: msg.from.first_name,
    lastName: msg.from.last_name,
    timestamp: new Date().toISOString(),
    type:     'message',
  };
  const reply = await sendToN8n(payload);
  if (reply) {
    const text = reply.message 
              || reply.data?.message 
              || 'Mensaje recibido';
    bot.sendMessage(msg.chat.id, text);
  }
});

// ——— Arranque ———
console.log('🚀 Iniciando bot…');
console.log('Webhook n8n:', N8N_WEBHOOK_URL);
startPolling().then(startPingMonitor);
