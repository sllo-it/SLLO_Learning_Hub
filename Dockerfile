# Use a lightweight Node.js environment
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app/learning-hub

# Copy package.json to install dependencies first
COPY package*.json ./
RUN npm install

# Copy all the rest of your files (including server.js and src/)
COPY . .

# Expose port 8028 to match your server.js and docker-compose settings
EXPOSE 3003

# Command to start the server
CMD ["node", "server.js"]