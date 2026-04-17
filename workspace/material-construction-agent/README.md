# Material Construction Agent

Trilha separada para um agente local de apoio operacional em loja ou deposito de material de construcao.

O objetivo deste prototipo e:

- registrar faltas de itens
- receber faltas vindas de funcionarios por WhatsApp
- manter cadastro simples de fornecedores
- mandar mensagens para fornecedores por WhatsApp
- salvar cotacoes e orcamentos recebidos
- comparar preco, prazo e quantidade disponivel
- encaminhar compra para aprovacao ou execucao, conforme permissao
- gerar relatorio diario em Markdown

## Visao de arquitetura

O agente foi desenhado para crescer em camadas:

- fase 1: operacao leve, com WhatsApp, JSON local e aprovacao humana
- fase 2: integracao com banco de dados ou ERP, se o cliente quiser
- fase 3: integracao financeira e compras automáticas, somente com confianca e governanca maduras

No estado atual, a arquitetura ja separa:

- papeis da loja: dono, comprador, balconista, deposito
- permissoes operacionais: somente cotar, pedir aprovacao, liberar compra
- canais: WhatsApp hoje como mock, pronto para trocar por API real depois
- persistencia: JSON local agora, adaptavel para banco depois

## Papeis sugeridos

- `owner`: dono, aprova ou amplia permissoes
- `buyer`: responsavel pela compra
- `clerk`: balconista que informa falta de item
- `warehouse`: responsavel pelo deposito
- `agent`: papel logico do sistema

## Catalogo inicial de cargos

Os cargos base agora ficam em `data/roles.json` e incluem:

- `dev_responsavel`
- `proprietario`
- `gerente_geral`
- `gerente_comercial`
- `secretario`
- `balconista`
- `caixa`
- `gerente_entrega`
- `motorista_entrega`
- `ajudante_entrega`
- `gerente_deposito`
- `ajudante_deposito`
- `contador`
- `comprador`
- `fornecedor`
- `financeiro`
- `auditor_interno`

Acrescentei estes tres papeis porque costumam fazer falta cedo:

- `comprador`: separa quem negocia e executa compra
- `financeiro`: acompanha condicao de pagamento sem abrir acesso bancario automatico
- `auditor_interno`: ajuda a revisar trilha, aprovacoes e governanca

## Matriz de acesso por cargo

A matriz operacional agora fica em `data/access-matrix.json`.

Ela separa, por cargo:

- quem pode reportar falta
- quem pode validar falta
- quem pode pedir cotacao
- quem pode responder cotacao
- quem pode comparar cotacoes
- quem pode aprovar compra
- quem pode executar compra
- quem recebe alertas
- quem ve relatorios e trilha de auditoria
- quem poderia, no futuro, receber acesso a banco ou financeiro

Regra recomendada:

- quase todo mundo comeca sem acesso a banco de dados
- quase todo mundo comeca sem acesso financeiro
- compra executada so depois de aprovacao, salvo politica muito madura
- `fornecedor` e papel externo, nunca com acesso interno da loja

## Politicas operacionais por fluxo

As politicas praticas agora ficam em `data/flow-policies.json`.

Fluxos base:

- `shortage_reporting`: como a falta nasce e quem valida
- `quote_collection`: como o agente fala com fornecedores e consolida cotacoes
- `purchase_approval`: quem aprova antes da compra seguir
- `purchase_execution`: quem executa a compra aprovada
- `future_auto_purchase`: politica futura, bloqueada por padrao

Leitura pratica:

- faltas podem nascer no balcao, caixa ou deposito
- cotacao pode ser automatizada pelo agente com fornecedores
- aprovacao continua humana no modo seguro
- execucao da compra fica com o comprador
- automacao total fica so como arquitetura futura, nao como padrao inicial

## Politica de comunicacao

A politica de comunicacao inbound agora fica em `data/communication-policy.json`.

Regra atual:

- padrao: `blue_ticks_only`
- excecoes pontuais: `silent_ignore`
- resposta textual: so para cargos e intencoes muito especificos

Traducao pratica:

- a maioria das mensagens sera apenas lida
- o agente nao fica respondendo texto para todo mundo
- fornecedor fora do fluxo pode ficar sem resposta automatica
- respostas textuais automaticas ficam restritas a casos sensiveis e definidos

## Conhecimento de materiais

O agente agora tem uma camada de conhecimento em:

- `data/materials.json`
- `data/supplier-types.json`
- `data/material-supplier-rules.json`

Essa camada permite:

- cadastrar material mestre com aliases
- associar material a tipos de fornecedor
- classificar fornecedor por especialidade
- filtrar automaticamente quem deve receber cotacao

Exemplo:

- `Brita 1` -> tipos aceitos: `agregados`, `distribuidor_geral`
- fornecedor de `acabamento` nao entra nessa cotacao
- fornecedor de `agregados` entra

## Modos de acesso a dados

A politica de acesso a dados fica em `data/data-access-policy.json`.

Modos:

- `manual_local`: sem acesso ao banco da empresa
- `import_export`: uso de planilha, CSV ou exportacao periodica
- `database_readonly`: banco ou ERP somente leitura
- `database_write`: escrita controlada no banco ou ERP
- `financial_enabled`: financeiro habilitado, apenas no futuro

Regra comercial:

- comecar em `manual_local`
- provar valor com WhatsApp, cotacao e relatorio
- evoluir para `import_export` ou `database_readonly`
- deixar escrita e financeiro para fases maduras
- toda mudanca de modo sensivel exige aprovacao formal

## Modos de permissao

- `quote_only`: o agente apenas cota e envia ao comprador
- `approval_required`: o agente cota e pede aprovacao antes de comprar
- `auto_purchase`: o agente pode seguir para compra apenas se isso estiver liberado

Mesmo no modo `auto_purchase`, a recomendacao e manter isso desligado no inicio.

## Fluxo inicial

1. funcionario do deposito ou balconista informa falta via WhatsApp
2. agente registra a falta e abre uma solicitacao
3. agente coloca a falta validada em uma fila de cotacao
4. comprador ou rotina agendada monta um lote consolidado
5. agente envia uma lista por fornecedor compativel
6. agente registra as cotacoes recebidas
7. agente escolhe a melhor opcao por preco, prazo e quantidade
8. agente envia para comprador ou dono, conforme a permissao ativa
9. agente gera relatorio diario com tudo rastreado

## Estrutura

```text
workspace/material-construction-agent/
|-- package.json
|-- README.md
|-- data/
|   |-- config.json
|   |-- roles.json
|   |-- users.json
|   |-- shortages.json
|   |-- suppliers.json
|   |-- quotes.json
|   |-- messages.json
|   |-- purchase-requests.json
|   `-- reports/
`-- src/
    |-- index.cjs
    `-- lib/
        |-- report.cjs
        |-- scoring.cjs
        |-- storage.cjs
        `-- workflow.cjs
```

## Comandos

```bash
cd workspace/material-construction-agent

npm run init

npm run dashboard

# abrir no navegador:
# http://localhost:8788

# preparar apresentacao personalizada da Rirrofer:
npm run demo:rirrofer

# pelo dashboard ja da para:
# - preparar a demo Rirrofer com um clique
# - cadastrar funcionario/cargo
# - cadastrar material e fornecedor
# - importar lista CSV/JSON de materiais
# - simular falta recebida por WhatsApp
# - montar e enviar lote consolidado de cotacao
# - registrar cotacao recebida do fornecedor
# - gerar plano de compra com melhor cotacao
# - visualizar funil operacional
# - gerar relatorio diario para o dono
# - demonstrar mensagens WhatsApp mock

npm run roles:list

npm run access:list

npm run flows:list

npm run comm:list

npm run data-access:list

npm run materials:list

node src/index.cjs materials:add --name "Tubo PVC Soldavel 25mm" --category hidraulica --unit barra --supplierTypes "hidraulica,distribuidor_geral" --aliases "tubo 25,tubo pvc 25,pvc soldavel 25" --criticality alta --minStock 20

node src/index.cjs materials:generate-aliases --name "Tubo PVC Esgoto 50mm"

node src/index.cjs materials:add-aliases --item "Tubo PVC Soldavel 25mm" --aliases "cano 25,cano pvc 25"

node src/index.cjs materials:set-supplier-types --item "Tubo PVC Soldavel 25mm" --supplierTypes "hidraulica,distribuidor_geral"

node src/index.cjs materials:import --file data/materials-import-example.csv

node src/index.cjs materials:resolve --item "Brita 1"

node src/index.cjs config:set-permissions --purchaseMode approval_required --requireOwnerApproval true

node src/index.cjs data-access:set --mode manual_local

node src/index.cjs user:add --name "Carlos Dono" --role proprietario --phone 5511990000001 --canApprovePurchase true

node src/index.cjs user:add --name "Marcos Compras" --role comprador --phone 5511990000002 --canExecutePurchase true

node src/index.cjs user:add --name "Rita Deposito" --role gerente_deposito --phone 5511990000003 --canReportShortage true

node src/index.cjs whatsapp:receive-shortage --phone 5511990000003 --item "Cimento CP-II 50kg" --needed 100 --available 12 --unit saco --category cimento --priority alta

node src/index.cjs supplier:add --name "Fornecedor Alfa" --contact "Joao" --phone "11999999999" --city "Sao Paulo" --payment "28 dias"

node src/index.cjs quote:add --supplier "Fornecedor Alfa" --item "Cimento CP-II 50kg" --unitPrice 37.9 --quantity 120 --leadDays 2 --payment "28 dias" --notes "Entrega em ate 48h"

node src/index.cjs quote:queue

node src/index.cjs quote:build-batch --mode manual

node src/index.cjs quote:send-batch --batchId "quote-batch-..."

node src/index.cjs purchase:plan --shortageId "shortage-..."

node src/index.cjs purchase:approve --requestId "purchase-request-..." --approver "Carlos Dono"

node src/index.cjs report:daily
```

## Observacoes

- armazenamento local em JSON
- WhatsApp ainda em modo `mock`, mas com trilha de mensagens pronta
- banco de dados e financeiro seguem bloqueados por padrao
- a arquitetura ja considera evolucao futura para banco, ERP e pagamento
- o caminho certo para vender isso e comecar por confianca operacional, nao por acesso total logo de inicio
