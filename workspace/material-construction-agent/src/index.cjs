'use strict';

const path = require('path');
const {
  ensureStorage,
  getConfig,
  saveConfig,
  listRoles,
  listShortages,
  saveShortages,
  listUsers,
  saveUsers,
  listSuppliers,
  saveSuppliers,
  listQuotes,
  saveQuotes,
  listQuoteQueue,
  listQuoteBatches,
  listMaterials,
  listSupplierTypes,
  listMessages,
  listPurchaseRequests
} = require('./lib/storage.cjs');
const { buildDailyReport } = require('./lib/report.cjs');
const { normalizeText, normalizePhone } = require('./lib/scoring.cjs');
const { canonicalRoleKey } = require('./lib/role-aliases.cjs');
const { seedDefaultRoles, ensureDefaultRoles } = require('./lib/roles.cjs');
const { seedAccessMatrix, ensureAccessMatrix } = require('./lib/access-matrix.cjs');
const { seedFlowPolicies, ensureFlowPolicies } = require('./lib/flow-policies.cjs');
const { seedCommunicationPolicy, ensureCommunicationPolicy } = require('./lib/communication-policy.cjs');
const { seedDataAccessPolicy, ensureDataAccessPolicy, setDataAccessMode } = require('./lib/data-access-policy.cjs');
const {
  seedMaterialKnowledge,
  ensureMaterialKnowledge,
  addMaterial,
  addMaterialAliases,
  setMaterialSupplierTypes,
  importMaterialsFromFile,
  generateAliasesForMaterialName,
  resolveMaterial,
  filterSuppliersForMaterial
} = require('./lib/material-catalog.cjs');
const {
  buildPurchaseRequest,
  routePurchaseDecision,
  approvePurchaseRequest,
  rejectPurchaseRequest,
  registerInboundWhatsApp,
  registerInboundQuote,
  processShortagePolicy,
  processQuotePolicy
} = require('./lib/workflow.cjs');
const { enqueueShortageForQuote, buildQuoteBatch, sendQuoteBatch } = require('./lib/quote-batches.cjs');
const { seedRirroferDemo } = require('./lib/demo-rirrofer.cjs');

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = value;
    index += 1;
  }

  return args;
}

function requireFields(args, fields) {
  const missing = fields.filter(field => !args[field]);
  if (missing.length) {
    throw new Error(`Campos obrigatorios ausentes: ${missing.join(', ')}`);
  }
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const { randomUUID } = require('crypto');

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function commandInit() {
  ensureStorage();
  ensureDefaultRoles();
  ensureAccessMatrix();
  ensureFlowPolicies();
  ensureCommunicationPolicy();
  ensureDataAccessPolicy();
  ensureMaterialKnowledge();
  console.log('Estrutura inicial pronta em workspace/material-construction-agent/data');
}

function commandSeedRoles() {
  const roles = seedDefaultRoles();
  console.log(`Cargos inicializados: ${roles.length}`);
}

function commandListRoles() {
  const roles = ensureDefaultRoles();

  for (const role of roles) {
    console.log(`${role.name} [${role.key}]`);
    console.log(`  area: ${role.area}`);
    console.log(`  descricao: ${role.description}`);
    console.log(`  permissoes: ${role.permissions.join(', ')}`);
  }
}

function commandSeedAccessMatrix() {
  const matrix = seedAccessMatrix();
  console.log(`Matriz de acesso inicializada: ${matrix.length}`);
}

function commandListAccessMatrix() {
  const matrix = ensureAccessMatrix();

  for (const row of matrix) {
    console.log(`${row.roleName} [${row.roleKey}]`);
    console.log(`  reporta_falta: ${row.reportsShortage}`);
    console.log(`  valida_falta: ${row.validatesShortage}`);
    console.log(`  pede_cotacao: ${row.requestsQuotes}`);
    console.log(`  responde_cotacao: ${row.respondsToQuotes}`);
    console.log(`  compara_cotacao: ${row.comparesQuotes}`);
    console.log(`  aprova_compra: ${row.approvesPurchase}`);
    console.log(`  executa_compra: ${row.executesPurchase}`);
    console.log(`  recebe_alertas: ${row.receivesOperationalAlerts}`);
    console.log(`  ve_relatorios: ${row.viewsReports}`);
    console.log(`  ve_auditoria: ${row.viewsAuditTrail}`);
    console.log(`  gerencia_usuarios_e_cargos: ${row.managesUsersAndRoles}`);
    console.log(`  acesso_banco_dados: ${row.accessesDatabase}`);
    console.log(`  acesso_financeiro: ${row.accessesFinancialSystems}`);
    console.log(`  observacao: ${row.notes}`);
  }
}

function commandSeedFlowPolicies() {
  const policies = seedFlowPolicies();
  console.log(`Politicas de fluxo inicializadas: ${policies.length}`);
}

function commandListFlowPolicies() {
  const policies = ensureFlowPolicies();

  for (const policy of policies) {
    console.log(`${policy.name} [${policy.key}]`);
    console.log(`  objetivo: ${policy.purpose}`);
    console.log(`  autonomia_do_agente: ${policy.agentAutonomy}`);
    console.log(`  gatilho: ${policy.trigger}`);
    console.log(`  papeis: ${JSON.stringify(policy.roles)}`);
    console.log('  etapas:');
    for (const step of policy.steps) {
      console.log(`    - ${step}`);
    }
    console.log('  guardrails:');
    for (const rule of policy.guardrails) {
      console.log(`    - ${rule}`);
    }
  }
}

function commandSeedCommunicationPolicy() {
  seedCommunicationPolicy();
  console.log('Politica de comunicacao inicializada.');
}

function commandListCommunicationPolicy() {
  const policy = ensureCommunicationPolicy();
  console.log(`inbound_default: ${policy.inboundDefault}`);
  console.log(`silent_ignore_rules: ${JSON.stringify(policy.silentIgnoreRules || [])}`);
  console.log(`text_reply_rules: ${JSON.stringify(policy.textReplyRules || [])}`);
}

function commandSeedDataAccessPolicy() {
  seedDataAccessPolicy();
  console.log('Politica de acesso a dados inicializada.');
}

function commandListDataAccessPolicy() {
  const policy = ensureDataAccessPolicy();
  console.log(`modo_atual: ${policy.currentMode}`);
  console.log(`le_banco_empresa: ${policy.allowDatabaseRead}`);
  console.log(`escreve_banco_empresa: ${policy.allowDatabaseWrite}`);
  console.log(`acessa_financeiro: ${policy.allowFinancialAccess}`);
  console.log(`exige_aprovacao_dono: ${policy.requireOwnerApprovalForModeChange}`);
  console.log(`exige_aprovacao_dev: ${policy.requireDevResponsibleApprovalForIntegration}`);
  console.log(`audita_acesso_externo: ${policy.auditAllExternalDataAccess}`);
  console.log(`observacao: ${policy.notes}`);
  console.log('modos_disponiveis:');
  for (const mode of policy.modes || []) {
    console.log(`  - ${mode.key}: ${mode.name} | risco=${mode.commercialRisk} | ${mode.description}`);
  }
}

function commandSetDataAccessMode(args) {
  requireFields(args, ['mode']);
  const policy = setDataAccessMode(args.mode);
  console.log(`Modo de acesso a dados atualizado: ${policy.currentMode}`);
  console.log(`le_banco_empresa: ${policy.allowDatabaseRead}`);
  console.log(`escreve_banco_empresa: ${policy.allowDatabaseWrite}`);
  console.log(`acessa_financeiro: ${policy.allowFinancialAccess}`);
}

function commandSeedMaterials() {
  const knowledge = seedMaterialKnowledge();
  console.log(`Tipos de fornecedor inicializados: ${knowledge.supplierTypes.length}`);
  console.log(`Materiais inicializados: ${knowledge.materials.length}`);
  console.log(`Regras material-fornecedor inicializadas: ${knowledge.rules.length}`);
}

function commandListMaterials() {
  const materials = ensureMaterialKnowledge().materials;
  for (const material of materials) {
    console.log(`${material.name} [${material.sku}]`);
    console.log(`  categoria: ${material.category}`);
    console.log(`  unidade: ${material.unit}`);
    console.log(`  supplier_types: ${(material.supplierTypes || []).join(', ')}`);
    console.log(`  marcas_aceitas: ${(material.allowedBrands || []).join(', ') || '-'}`);
    console.log(`  marcas_preferidas: ${(material.preferredBrands || []).join(', ') || '-'}`);
    console.log(`  aliases: ${(material.aliases || []).join(', ')}`);
    console.log(`  equivalentes: ${(material.equivalents || []).join(', ') || '-'}`);
    console.log(`  criticidade: ${material.criticality || 'media'}`);
    console.log(`  estoque_minimo: ${material.minStock || 0}`);
    console.log(`  ativo: ${material.active !== false}`);
  }
}

function commandAddMaterial(args) {
  requireFields(args, ['name', 'category', 'unit']);
  const material = addMaterial({
    sku: args.sku,
    name: args.name,
    category: args.category,
    unit: args.unit,
    supplierTypes: args.supplierTypes,
    allowedBrands: args.allowedBrands,
    preferredBrands: args.preferredBrands,
    aliases: args.aliases,
    equivalents: args.equivalents,
    criticality: args.criticality,
    minStock: args.minStock,
    notes: args.notes,
    active: args.active ? args.active === 'true' : true
  });

  console.log(`Material cadastrado: ${material.name} [${material.sku}]`);
}

function commandAddMaterialAliases(args) {
  requireFields(args, ['item', 'aliases']);
  const material = addMaterialAliases(args.item, args.aliases);
  console.log(`Aliases atualizados para ${material.name}: ${(material.aliases || []).join(', ')}`);
}

function commandGenerateMaterialAliases(args) {
  requireFields(args, ['name']);
  const aliases = generateAliasesForMaterialName(args.name);
  console.log(`Aliases gerados para ${args.name}:`);
  for (const alias of aliases) {
    console.log(`  - ${alias}`);
  }
}

function commandSetMaterialSupplierTypes(args) {
  requireFields(args, ['item', 'supplierTypes']);
  const material = setMaterialSupplierTypes(args.item, args.supplierTypes);
  console.log(`Tipos de fornecedor atualizados para ${material.name}: ${(material.supplierTypes || []).join(', ')}`);
}

function commandImportMaterials(args) {
  requireFields(args, ['file']);
  const result = importMaterialsFromFile(args.file);
  console.log(`Arquivo importado: ${result.filePath}`);
  console.log(`Materiais processados: ${result.imported}`);
  console.log(`Criados: ${result.created}`);
  console.log(`Atualizados: ${result.updated}`);
}

function commandResolveMaterial(args) {
  requireFields(args, ['item']);
  const resolution = resolveMaterial(args.item);
  const result = filterSuppliersForMaterial(args.item);
  console.log(`status: ${resolution.status}`);
  console.log(`confianca: ${resolution.confidence}`);
  console.log(`motivo_resolucao: ${resolution.reason}`);
  console.log('candidatos:');
  for (const candidate of resolution.candidates) {
    console.log(`  - ${candidate.name} [${candidate.sku}] score=${candidate.score} reason=${candidate.reason}`);
  }
  console.log(`motivo: ${result.reason}`);
  console.log(`material: ${result.material ? result.material.name : 'nao encontrado'}`);
  console.log(`fornecedores_compativeis: ${result.suppliers.map(supplier => supplier.name).join(', ') || 'nenhum'}`);
}

function commandSetPermissions(args) {
  const config = getConfig();

  if (args.purchaseMode) {
    config.permissions.purchaseMode = args.purchaseMode;
  }
  if (args.allowAutoPurchase) {
    config.permissions.allowAutoPurchase = args.allowAutoPurchase === 'true';
  }
  if (args.requireOwnerApproval) {
    config.permissions.requireOwnerApproval = args.requireOwnerApproval === 'true';
  }
  if (args.allowDatabaseAccess) {
    config.permissions.allowDatabaseAccess = args.allowDatabaseAccess === 'true';
  }
  if (args.allowFinancialAccess) {
    config.permissions.allowFinancialAccess = args.allowFinancialAccess === 'true';
  }

  saveConfig(config);
  console.log('Permissoes atualizadas.');
}

function commandAddUser(args) {
  requireFields(args, ['name', 'role', 'phone']);

  const roles = ensureDefaultRoles();
  const roleExists = roles.some(role => normalizeText(role.key) === canonicalRoleKey(args.role));
  if (!roleExists) {
    throw new Error(`Cargo nao encontrado: ${args.role}`);
  }

  const users = listUsers();
  const entry = {
    id: createId('user'),
    name: args.name,
    role: canonicalRoleKey(args.role),
    phone: args.phone,
    sector: args.sector || '',
    canReportShortage: args.canReportShortage ? args.canReportShortage === 'true' : true,
    canApprovePurchase: args.canApprovePurchase === 'true',
    canExecutePurchase: args.canExecutePurchase === 'true',
    createdAt: new Date().toISOString()
  };

  users.push(entry);
  saveUsers(users);

  console.log(`Usuario cadastrado: ${entry.name} (${entry.role})`);
}

function commandListShortages() {
  const shortages = listShortages();
  if (!shortages.length) {
    console.log('Nenhuma falta registrada.');
    return;
  }
  for (const shortage of shortages) {
    console.log(`${shortage.id} | ${shortage.status} | ${shortage.item} | falta=${Math.max(Number(shortage.needed || 0) - Number(shortage.available || 0), 0)} ${shortage.unit || 'un'} | prioridade=${shortage.priority || 'media'} | por=${shortage.reportedBy || '-'}`);
  }
}

function commandListUsers() {
  const users = listUsers();
  if (!users.length) {
    console.log('Nenhum usuario cadastrado.');
    return;
  }
  for (const user of users) {
    console.log(`${user.id} | ${user.name} | cargo=${user.role} | fone=${user.phone} | aprova=${user.canApprovePurchase} | executa=${user.canExecutePurchase}`);
  }
}

function commandListSuppliers() {
  const suppliers = listSuppliers();
  if (!suppliers.length) {
    console.log('Nenhum fornecedor cadastrado.');
    return;
  }
  for (const supplier of suppliers) {
    console.log(`${supplier.id} | ${supplier.name} | fone=${supplier.phone} | tipos=${(supplier.supplierTypes || []).join(', ') || '-'} | ativo=${supplier.active !== false}`);
  }
}

function commandListQuotes() {
  const quotes = listQuotes();
  if (!quotes.length) {
    console.log('Nenhuma cotacao registrada.');
    return;
  }
  for (const quote of quotes) {
    console.log(`${quote.id} | ${quote.item} | ${quote.supplier} | R$${quote.unitPrice}/un | prazo=${quote.leadDays}d | qtd=${quote.quantity}`);
  }
}

function commandValidateShortage(args) {
  requireFields(args, ['shortageId']);

  const shortages = listShortages();
  const shortage = shortages.find(entry => entry.id === args.shortageId);
  if (!shortage) {
    throw new Error(`Falta nao encontrada: ${args.shortageId}`);
  }

  if (shortage.status === 'validated') {
    console.log(`Falta ja validada: ${shortage.item}`);
    return;
  }

  shortage.status = 'validated';
  shortage.validatedBy = args.validatedBy || 'manual';
  shortage.validatedAt = new Date().toISOString();
  saveShortages(shortages);

  const queueEntry = enqueueShortageForQuote(shortage);
  console.log(`Falta validada: ${shortage.item}`);
  console.log(`Entrada na fila de cotacao: ${queueEntry.id}`);
}

function commandAddShortage(args) {
  requireFields(args, ['item', 'needed', 'available']);

  const shortages = listShortages();
  const entry = {
    id: createId('shortage'),
    item: args.item,
    category: args.category || 'geral',
    needed: numeric(args.needed),
    available: numeric(args.available),
    unit: args.unit || 'un',
    priority: args.priority || 'media',
    notes: args.notes || '',
    status: args.status || 'open',
    reportedBy: args.reportedBy || '',
    source: args.source || 'manual',
    createdAt: new Date().toISOString()
  };

  shortages.push(entry);
  saveShortages(shortages);

  console.log(`Falta registrada: ${entry.item}`);
}

function commandAddSupplier(args) {
  requireFields(args, ['name']);

  const suppliers = listSuppliers();
  const entry = {
    id: createId('supplier'),
    name: args.name,
    contact: args.contact || '',
    phone: args.phone || '',
    city: args.city || '',
    whatsapp: args.whatsapp || args.phone || '',
    supplierTypes: String(args.supplierTypes || '')
      .split(',')
      .map(value => normalizeText(value))
      .filter(Boolean),
    payment: args.payment || '',
    notes: args.notes || '',
    active: args.active ? args.active === 'true' : true,
    createdAt: new Date().toISOString()
  };

  suppliers.push(entry);
  saveSuppliers(suppliers);

  console.log(`Fornecedor cadastrado: ${entry.name}`);
}

function commandAddQuote(args) {
  requireFields(args, ['supplier', 'item', 'unitPrice', 'quantity', 'leadDays']);

  const suppliers = listSuppliers();
  const supplierExists = suppliers.some(
    supplier => normalizeText(supplier.name) === normalizeText(args.supplier)
  );

  if (!supplierExists) {
    throw new Error(`Fornecedor nao encontrado: ${args.supplier}`);
  }

  const quotes = listQuotes();
  const entry = {
    id: createId('quote'),
    supplier: args.supplier,
    item: args.item,
    unitPrice: numeric(args.unitPrice),
    quantity: numeric(args.quantity),
    leadDays: numeric(args.leadDays),
    payment: args.payment || '',
    notes: args.notes || '',
    source: args.source || 'manual',
    createdAt: new Date().toISOString()
  };

  quotes.push(entry);
  saveQuotes(quotes);

  console.log(`Cotacao registrada para ${entry.item} com ${entry.supplier}`);
}

function commandReceiveWhatsAppShortage(args) {
  requireFields(args, ['phone', 'item', 'needed', 'available']);

  const users = listUsers();
  const sender = users.find(user => normalizePhone(user.phone) === normalizePhone(args.phone));
  if (!sender) {
    throw new Error(`Remetente nao cadastrado: ${args.phone}`);
  }

  registerInboundWhatsApp({
    phone: args.phone,
    text: args.text || `Falta reportada: ${args.item}`,
    relatedEntityType: 'shortage',
    relatedEntityId: ''
  });

  const shortages = listShortages();
  const rolesThatAutoValidate = new Set(['gerente_deposito', 'gerente_geral']);
  const autoValidated = rolesThatAutoValidate.has(canonicalRoleKey(sender.role));
  const entry = {
    id: createId('shortage'),
    item: args.item,
    category: args.category || 'geral',
    needed: numeric(args.needed),
    available: numeric(args.available),
    unit: args.unit || 'un',
    priority: args.priority || 'media',
    notes: args.notes || '',
    status: autoValidated ? 'validated' : 'pending_validation',
    reportedBy: sender.name,
    source: 'whatsapp',
    createdAt: new Date().toISOString()
  };

  shortages.push(entry);
  saveShortages(shortages);

  const shortagePolicyResult = processShortagePolicy(entry, { skipValidationRequest: autoValidated });
  const quoteQueueEntry = autoValidated ? enqueueShortageForQuote(entry) : null;

  console.log(`Falta recebida via WhatsApp de ${sender.name}: ${entry.item}`);
  console.log(`Status inicial: ${entry.status}`);
  console.log(`Notificacoes de falta: ${(shortagePolicyResult.notified || []).length}`);
  if (autoValidated) {
    console.log(`Fila de cotacao: ${quoteQueueEntry.status}`);
  }
}

function commandReceiveWhatsAppQuote(args) {
  requireFields(args, ['phone', 'item', 'unitPrice', 'quantity', 'leadDays']);

  const entry = registerInboundQuote({
    phone: args.phone,
    item: args.item,
    unitPrice: numeric(args.unitPrice),
    quantity: numeric(args.quantity),
    leadDays: numeric(args.leadDays),
    payment: args.payment || '',
    notes: args.notes || ''
  });

  console.log(`Cotacao registrada via WhatsApp: ${entry.id}`);
  console.log(`Fornecedor: ${entry.supplier}`);
  console.log(`Item: ${entry.item} | R$${entry.unitPrice}/un | prazo=${entry.leadDays}d`);
}

function commandQuoteQueueList() {
  const queue = listQuoteQueue();
  for (const item of queue) {
    console.log(`${item.id} | ${item.status} | ${item.item} -> ${item.materialName || 'sem material'} | fornecedores=${(item.supplierCandidates || []).length}`);
  }
}

function commandQuoteBuildBatch(args) {
  const batch = buildQuoteBatch({ mode: args.mode || 'manual', notes: args.notes || '' });
  console.log(`Lote criado: ${batch.id}`);
  console.log(`Itens: ${batch.itemCount}`);
  console.log(`Fornecedores: ${batch.supplierCount}`);
  for (const group of batch.groups || []) {
    console.log(`Fornecedor: ${group.supplier.name}`);
    console.log(group.message);
  }
}

function commandQuoteSendBatch(args) {
  requireFields(args, ['batchId']);
  const batch = sendQuoteBatch(args.batchId);
  console.log(`Lote enviado: ${batch.id}`);
  console.log(`Fornecedores: ${batch.supplierCount}`);
}

function commandQuoteBatchesList() {
  const batches = listQuoteBatches();
  for (const batch of batches) {
    console.log(`${batch.id} | ${batch.status} | itens=${batch.itemCount} | fornecedores=${batch.supplierCount}`);
  }
}

function commandPurchasePlan(args) {
  requireFields(args, ['shortageId']);

  const shortages = listShortages();
  const shortage = shortages.find(entry => entry.id === args.shortageId);
  if (!shortage) {
    throw new Error(`Falta nao encontrada: ${args.shortageId}`);
  }

  const request = buildPurchaseRequest(shortage);
  if (!request) {
    throw new Error(`Nao existem cotacoes para o item: ${shortage.item}`);
  }

  const outcome = routePurchaseDecision(request);
  console.log(`Solicitacao criada: ${request.id}`);
  console.log(`Destino do fluxo: ${outcome}`);
}

function commandPurchaseApprove(args) {
  requireFields(args, ['requestId', 'approver']);
  const request = approvePurchaseRequest({
    requestId: args.requestId,
    approverName: args.approver,
    notes: args.notes || ''
  });
  console.log(`Solicitacao aprovada: ${request.id}`);
}

function commandPurchaseReject(args) {
  requireFields(args, ['requestId', 'rejector']);
  const request = rejectPurchaseRequest({
    requestId: args.requestId,
    rejectorName: args.rejector,
    notes: args.notes || ''
  });
  console.log(`Solicitacao rejeitada: ${request.id}`);
  console.log(`Rejeitada por: ${request.rejectedBy}`);
}

function commandStatus() {
  const config = getConfig();
  const dataAccessPolicy = ensureDataAccessPolicy();
  const roles = ensureDefaultRoles();
  const shortages = listShortages();
  const users = listUsers();
  const suppliers = listSuppliers();
  const quotes = listQuotes();
  const messages = listMessages();
  const purchaseRequests = listPurchaseRequests();

  console.log(`Modo de compra: ${config.permissions.purchaseMode}`);
  console.log(`Modo de dados: ${dataAccessPolicy.currentMode}`);
  console.log(`Aprovacao do dono: ${config.permissions.requireOwnerApproval}`);
  console.log(`Le banco da empresa: ${dataAccessPolicy.allowDatabaseRead}`);
  console.log(`Escreve banco da empresa: ${dataAccessPolicy.allowDatabaseWrite}`);
  console.log(`Acesso financeiro: ${dataAccessPolicy.allowFinancialAccess}`);
  console.log(`Cargos catalogados: ${roles.length}`);
  console.log(`Faltas: ${shortages.length}`);
  console.log(`Usuarios: ${users.length}`);
  console.log(`Fornecedores: ${suppliers.length}`);
  console.log(`Cotacoes: ${quotes.length}`);
  console.log(`Mensagens WhatsApp: ${messages.length}`);
  console.log(`Solicitacoes de compra: ${purchaseRequests.length}`);
}

function commandDailyReport() {
  const report = buildDailyReport();
  console.log(`Relatorio gerado: ${path.normalize(report.reportPath)}`);
}

function commandDemoRirrofer() {
  const result = seedRirroferDemo();
  console.log('Demo Rirrofer preparada.');
  console.log(`Funcionarios: ${result.users}`);
  console.log(`Materiais: ${result.materials}`);
  console.log(`Fornecedores: ${result.suppliers}`);
  console.log(`Faltas: ${result.shortages}`);
  console.log(`Cotacoes: ${result.quotes}`);
  console.log(`Lote enviado: ${result.quoteBatchId}`);
  console.log(`Solicitacao de compra: ${result.purchaseRequestId}`);
}

function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  ensureStorage();

  switch (command) {
    case 'init':
      commandInit();
      break;
    case 'roles:seed':
      commandSeedRoles();
      break;
    case 'roles:list':
      commandListRoles();
      break;
    case 'access:seed':
      commandSeedAccessMatrix();
      break;
    case 'access:list':
      commandListAccessMatrix();
      break;
    case 'flows:seed':
      commandSeedFlowPolicies();
      break;
    case 'flows:list':
      commandListFlowPolicies();
      break;
    case 'comm:seed':
      commandSeedCommunicationPolicy();
      break;
    case 'comm:list':
      commandListCommunicationPolicy();
      break;
    case 'data-access:seed':
      commandSeedDataAccessPolicy();
      break;
    case 'data-access:list':
      commandListDataAccessPolicy();
      break;
    case 'data-access:set':
      commandSetDataAccessMode(args);
      break;
    case 'materials:seed':
      commandSeedMaterials();
      break;
    case 'materials:list':
      commandListMaterials();
      break;
    case 'materials:add':
      commandAddMaterial(args);
      break;
    case 'materials:add-aliases':
      commandAddMaterialAliases(args);
      break;
    case 'materials:generate-aliases':
      commandGenerateMaterialAliases(args);
      break;
    case 'materials:set-supplier-types':
      commandSetMaterialSupplierTypes(args);
      break;
    case 'materials:import':
      commandImportMaterials(args);
      break;
    case 'materials:resolve':
      commandResolveMaterial(args);
      break;
    case 'config:set-permissions':
      commandSetPermissions(args);
      break;
    case 'user:add':
      commandAddUser(args);
      break;
    case 'user:list':
      commandListUsers();
      break;
    case 'shortage:add':
      commandAddShortage(args);
      break;
    case 'shortage:list':
      commandListShortages();
      break;
    case 'shortage:validate':
      commandValidateShortage(args);
      break;
    case 'whatsapp:receive-shortage':
      commandReceiveWhatsAppShortage(args);
      break;
    case 'whatsapp:receive-quote':
      commandReceiveWhatsAppQuote(args);
      break;
    case 'supplier:add':
      commandAddSupplier(args);
      break;
    case 'supplier:list':
      commandListSuppliers();
      break;
    case 'quote:add':
      commandAddQuote(args);
      break;
    case 'quote:list':
      commandListQuotes();
      break;
    case 'quote:queue':
      commandQuoteQueueList();
      break;
    case 'quote:build-batch':
      commandQuoteBuildBatch(args);
      break;
    case 'quote:send-batch':
      commandQuoteSendBatch(args);
      break;
    case 'quote:batches':
      commandQuoteBatchesList();
      break;
    case 'purchase:plan':
      commandPurchasePlan(args);
      break;
    case 'purchase:approve':
      commandPurchaseApprove(args);
      break;
    case 'purchase:reject':
      commandPurchaseReject(args);
      break;
    case 'report:daily':
      commandDailyReport();
      break;
    case 'demo:rirrofer':
      commandDemoRirrofer();
      break;
    case 'status':
      commandStatus();
      break;
    default:
      console.log('Comandos disponiveis: init, roles:seed, roles:list, access:seed, access:list, flows:seed, flows:list, comm:seed, comm:list, data-access:seed, data-access:list, data-access:set, materials:seed, materials:list, materials:add, materials:add-aliases, materials:generate-aliases, materials:set-supplier-types, materials:import, materials:resolve, config:set-permissions, user:add, user:list, shortage:add, shortage:list, shortage:validate, whatsapp:receive-shortage, whatsapp:receive-quote, supplier:add, supplier:list, quote:add, quote:list, quote:queue, quote:build-batch, quote:send-batch, quote:batches, purchase:plan, purchase:approve, purchase:reject, report:daily, demo:rirrofer, status');
      process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
}
