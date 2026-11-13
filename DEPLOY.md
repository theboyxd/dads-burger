# Como colocar o Dad's Burger no ar (de verdade)

O site completo (painel do restaurante, fotos, pedidos e pagamentos) precisa do **servidor** (`server.js`, Node) ligado
24 horas, com um **disco que não apaga**. O GitHub Pages não serve para isso: ele só entrega arquivos e não roda servidor
(por isso lá o painel abre só como prévia, sem gravar nada, e não existe envio de fotos nem pedidos). Este guia vale para qualquer hospedagem que ofereça disco persistente.

## O que só você pode fazer

1. Criar a conta na hospedagem e escolher o tipo: **A** (plataforma com volume) ou **B** (VPS com Docker), abaixo.
2. Criar um **disco persistente** e conectá-lo no caminho `/data`.
3. Preencher as variáveis de ambiente (tabela abaixo).
4. Apontar o domínio para a hospedagem, com https.
5. No Mercado Pago, na aplicação "Dads Burger": ativar as **credenciais de produção**; cadastrar o webhook
   `APP_URL/api/mercadopago/webhook` (evento Pagamentos) e copiar o segredo dele para `MERCADOPAGO_WEBHOOK_SECRET`;
   cadastrar uma **chave Pix** na conta.
6. Fazer **um pagamento real pequeno** e conferir no painel do restaurante e no Mercado Pago.

## Variáveis de ambiente

| Variável | Precisa? | Para quê |
|---|---|---|
| `ADMIN_PASSWORD` | **obrigatória** | Senha do painel `/admin`. Sem ela (ou com `dads123`) o servidor se recusa a iniciar. Use uma senha própria e longa. |
| `SESSION_SECRET` | recomendada | Texto longo e secreto. Sem ele, quem entrou no painel precisa entrar de novo a cada reinício. |
| `APP_URL` | **obrigatória** para pagar online | Endereço https público, sem barra no fim (ex.: `https://pedidos.seudominio.com.br`). O Mercado Pago avisa os pagamentos aí. |
| `MERCADOPAGO_ACCESS_TOKEN` | **obrigatória** para pagar online | Chave secreta de **produção** da aplicação. |
| `MERCADOPAGO_PUBLIC_KEY` | **obrigatória** para pagar online | Chave pública de **produção**. |
| `MERCADOPAGO_WEBHOOK_SECRET` | recomendada | Segredo do webhook: confere a assinatura dos avisos. |
| `DATA_DIR` | **obrigatória** na hospedagem | Pasta do disco persistente: `/data`. (A imagem Docker já vem com isso.) |
| `HOST` | já vem | `0.0.0.0` (a imagem Docker já vem). |
| `PORT` | já vem | `3000`. Se a hospedagem definir a própria porta, ela vale. |
| `REQUIRE_VOLUME` | já vem | `1`: sem disco conectado em `/data` o servidor se recusa a iniciar (não grava pedidos no disco temporário). |

Nenhuma chave vai para o git nem para a imagem: ficam só nas variáveis da hospedagem (ou num arquivo fora do repositório).

## Opção A: plataforma com volume

- **Código:** o `Dockerfile` deste repositório (ou `npm ci --omit=dev` e `npm start`, com Node 24).
- **Disco:** volume conectado em `/data`; `DATA_DIR=/data`.
- **Porta:** a que a hospedagem indicar (`PORT`). **Verificação de saúde:** `GET /healthz` (responde `ok`).
- **Uma instância só.** Os dados são arquivos: duas instâncias gravariam por cima uma da outra.
- Os nomes dos campos mudam de uma hospedagem para outra: confira a documentação atual dela.

## Opção B: VPS com Docker e proxy https

```bash
docker build -t dads-burger .
docker run -d --name dads --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v /srv/dads-data:/data \
  --env-file /srv/dads.env \
  dads-burger
```

- `/srv/dads.env` guarda as variáveis (uma por linha, `NOME=valor`), fora do git e só legível por você (`chmod 600`).
- **https:** um proxy reverso na frente (Caddy, nginx...) com certificado, repassando `X-Forwarded-Proto`. Exemplo com Caddy:
  `pedidos.seudominio.com.br { reverse_proxy 127.0.0.1:3000 }`
- **Atualizar:** `docker build` de novo, `docker rm -f dads`, o mesmo `docker run`. Os dados ficam em `/srv/dads-data`.
- **Saúde:** `docker inspect --format '{{.State.Health.Status}}' dads` (deve dar `healthy`).

## Os dados e as cópias de segurança

- O disco guarda os **pedidos** (nome, CPF, telefone, endereço) e as **fotos**: são dados pessoais de clientes (LGPD).
  Nunca vão para o git nem para a imagem.
- Faça **cópia (snapshot) do disco** com frequência e teste restaurar uma vez. A cópia também é dado pessoal: guarde com cuidado.
- **Primeira partida:** numa pasta vazia, o servidor copia o cardápio e as configurações que vêm com o programa
  (`products.json`, `settings.json`) e cria `orders.json` vazio e `uploads/`. **Depois disso nada é sobrescrito**, nem em
  reinício nem em versão nova: o que o dono muda no painel fica no disco.
- **Levar os dados de hoje:** com o servidor parado, copie `products.json`, `settings.json` e a pasta `uploads/` do computador
  para `/data` (e `orders.json`, só se quiser levar o histórico de pedidos).
- Se o servidor **não iniciar**, a mensagem diz o motivo: disco não conectado em `/data`, sem permissão de gravar,
  `ADMIN_PASSWORD` faltando ou porta em uso.

## Depois de ir ao ar

1. Abra `https://seu-endereço/healthz` (deve mostrar `ok`) e entre em `/admin` com a `ADMIN_PASSWORD`.
2. Faça o pedido-teste real pequeno (item 6 acima) e acompanhe pelo link "Acompanhar meu pedido".
3. **GitHub Pages:** mostra só uma prévia (o painel avisa que está sem servidor e não grava nada) e não aceita pedidos nem pagamentos. Desligue-o
   (no GitHub: Settings > Pages) ou troque por uma página que leve ao endereço novo, para ninguém usar o antigo.
