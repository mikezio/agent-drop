FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_BASE_PATH=""
ARG NEXT_PUBLIC_AGENT_DROP_DIR="/data/agent-drop"
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_AGENT_DROP_DIR=${NEXT_PUBLIC_AGENT_DROP_DIR}

RUN npm run build

CMD ["npm", "run", "start"]
