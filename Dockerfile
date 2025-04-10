FROM node:18-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto si es necesario (aunque el bot no usa un puerto específico)
EXPOSE 3000

# Comando para iniciar el bot
CMD ["npm", "start"] 