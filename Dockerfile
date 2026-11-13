# Dad's Burger: servidor Express (site, painel, pedidos e pagamentos). Passo a passo em DEPLOY.md.
#
# Node 24 Debian "slim": a mesma versão principal usada no desenvolvimento. O sharp (fotos do painel) traz binários prontos
# para ela, em x64 e arm64, então não precisa de compilador na imagem.
FROM node:24-bookworm-slim

# HOST=0.0.0.0: dentro do container o servidor precisa escutar em todas as portas internas (quem decide o que fica
#   aberto para a internet é a hospedagem). Por isso ele só inicia com ADMIN_PASSWORD definida.
# DATA_DIR=/data: o disco persistente da hospedagem é conectado nesse caminho.
# REQUIRE_VOLUME=1: sem disco conectado em /data o servidor se recusa a iniciar, em vez de gravar pedidos e fotos
#   no disco temporário do container (que some na próxima troca). Para um teste rápido sem disco: -e REQUIRE_VOLUME=0
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    REQUIRE_VOLUME=1

WORKDIR /app

# Dependências primeiro: esta camada é reaproveitada enquanto package.json e package-lock.json não mudarem
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Só o que o servidor usa. Nada de .env, pedidos, fotos, testes nem rascunhos entra na imagem (veja .dockerignore):
# products.json e settings.json vão como ponto de partida, copiados para /data só na primeira vez.
COPY server.js accounts.js index.html admin.html logo.png products.json settings.json ./
COPY assets ./assets
COPY vendor ./vendor
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# O servidor roda como o usuário "node" (sem poderes de administrador) e só grava em /data.
# A hospedagem conecta o disco como root: o entrypoint ajusta o dono de /data e então passa para o usuário "node".
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data

EXPOSE 3000

# Saúde: o servidor responde "ok" em /healthz enquanto a pasta de dados aceita gravação
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
