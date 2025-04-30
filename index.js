require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Verificar si ya hay una instancia corriendo
const lockFile = path.join(__dirname, 'bot.lock');
if (fs.existsSync(lockFile)) {
    console.error('Ya hay una instancia del bot corriendo. Si estás seguro de que no es así, elimina el archivo bot.lock');
    process.exit(1);
}

// Crear archivo de bloqueo
fs.writeFileSync(lockFile, process.pid.toString());

// Limpiar el archivo de bloqueo al salir
process.on('exit', () => {
    if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
    }
});

// Reemplaza 'TU_TOKEN' con el token que te dio BotFather
const token = process.env.BOT_TOKEN;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

let isPolling = false;

// Crear una nueva instancia del bot con opciones mejoradas
const bot = new TelegramBot(token, {
    polling: false // Inicialmente desactivamos el polling
});

// Función para iniciar el polling de manera segura
async function startPolling() {
    if (isPolling) return;
    
    try {
        await bot.startPolling({
            interval: 300,
            params: {
                timeout: 10
            }
        });
        isPolling = true;
        console.log('Polling iniciado correctamente');
    } catch (error) {
        console.error('Error al iniciar polling:', error.message);
        isPolling = false;
    }
}

// Manejar errores de polling
bot.on('polling_error', (error) => {
    console.error('Error de polling:', error.message);
    if (error.code === 'ETELEGRAM') {
        console.log('Reiniciando el bot...');
        isPolling = false;
        bot.stopPolling().then(() => {
            setTimeout(startPolling, 5000);
        });
    }
});

// Función para enviar datos a n8n
async function sendToN8n(data) {
    try {
        console.log('Enviando datos a n8n:', data);
        const response = await axios.post(N8N_WEBHOOK_URL, data);
        console.log('Respuesta de n8n:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error al enviar datos a n8n:', error);
        if (error.response) {
            console.error('Detalles del error:', error.response);
        }
        return null;
    }
}

// Manejar el comando /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '¡Hola! Soy tu bot de Telegram. ¿En qué puedo ayudarte?');
});

// Manejar mensajes de texto
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Si el mensaje no es un comando
    if (!msg.text.startsWith('/')) {
        // Preparar datos para enviar a n8n
        const messageData = {
            chatId: msg.chat.id,
            message: msg.text,
            username: msg.from.username,
            firstName: msg.from.first_name,
            lastName: msg.from.last_name,
            timestamp: new Date().toISOString(),
            type: 'message'
        };

        // Enviar datos a n8n
        const n8nResponse = await sendToN8n(messageData);
        
        // Si n8n responde con un mensaje, enviarlo de vuelta al usuario
        if (n8nResponse) {
            // Manejar diferentes formatos de respuesta
            const responseMessage = n8nResponse.message || 
                                  n8nResponse.data?.message || 
                                  n8nResponse.response?.message ||
                                  'Mensaje recibido';
            
            bot.sendMessage(chatId, responseMessage);
        }
    }
});

// Manejar el cierre graceful
process.on('SIGINT', async () => {
    console.log('Deteniendo el bot...');
    if (isPolling) {
        await bot.stopPolling();
    }
    if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
    }
    console.log('Bot detenido correctamente');
    process.exit(0);
});

// Iniciar el bot
console.log('Iniciando el bot...');
console.log('Webhook URL:', N8N_WEBHOOK_URL);
startPolling(); 
