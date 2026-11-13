#!/bin/sh
# Entrada do container do Dad's Burger.
#
# A hospedagem conecta o disco persistente como "root", mas o servidor roda como o usuário "node" (sem poderes de
# administrador). Aqui, ainda como root, a pasta de dados passa a pertencer ao "node"; depois o servidor é iniciado já
# como "node". Se o container já nasce sem ser root (a hospedagem pode pedir isso), só inicia o servidor: nesse caso o
# disco precisa já aceitar gravação por esse usuário, e o servidor avisa com clareza se não aceitar.
set -eu

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Só mexe quando a pasta ainda não é do "node" (disco recém-conectado): não percorre milhares de fotos a cada reinício.
  if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u node)" ]; then
    chown -R node:node "$DATA_DIR" || echo "Aviso: não consegui ajustar o dono de $DATA_DIR. Se o servidor não conseguir gravar, ajuste a permissão do disco." >&2
  fi
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
