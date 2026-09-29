FROM apify/actor-node:22

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . ./

CMD ["node", "actor.mjs"]
