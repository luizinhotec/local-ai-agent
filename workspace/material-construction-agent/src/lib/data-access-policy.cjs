'use strict';

const { getDataAccessPolicy, saveDataAccessPolicy } = require('./storage.cjs');
const { normalizeText } = require('./scoring.cjs');

const DATA_ACCESS_MODES = [
  {
    key: 'manual_local',
    name: 'Manual / Local',
    description: 'Sem acesso ao banco da empresa. O agente usa WhatsApp, JSON local, cadastros proprios e aprovacao humana.',
    canReadCompanyDatabase: false,
    canWriteCompanyDatabase: false,
    canAccessFinancialSystems: false,
    commercialRisk: 'baixo',
    recommendedFor: 'primeira implantacao e prova de valor'
  },
  {
    key: 'import_export',
    name: 'Importacao / Exportacao',
    description: 'Empresa envia planilha, CSV ou exportacao periodica. O agente le dados offline, sem entrar no banco.',
    canReadCompanyDatabase: false,
    canWriteCompanyDatabase: false,
    canAccessFinancialSystems: false,
    commercialRisk: 'baixo',
    recommendedFor: 'cliente que quer melhorar precisao sem liberar sistema interno'
  },
  {
    key: 'database_readonly',
    name: 'Banco Somente Leitura',
    description: 'Agente consulta produtos, estoque, fornecedores e historico, mas nao altera nada.',
    canReadCompanyDatabase: true,
    canWriteCompanyDatabase: false,
    canAccessFinancialSystems: false,
    commercialRisk: 'medio',
    recommendedFor: 'cliente que ja confia e quer integracao com ERP ou banco'
  },
  {
    key: 'database_write',
    name: 'Banco com Escrita Controlada',
    description: 'Agente pode criar pedidos, registrar cotacoes ou atualizar status conforme escopo aprovado.',
    canReadCompanyDatabase: true,
    canWriteCompanyDatabase: true,
    canAccessFinancialSystems: false,
    commercialRisk: 'alto',
    recommendedFor: 'operacao madura com contrato, auditoria e rollback'
  },
  {
    key: 'financial_enabled',
    name: 'Financeiro Habilitado',
    description: 'Agente pode interagir com financeiro ou pagamentos dentro de limites formais.',
    canReadCompanyDatabase: true,
    canWriteCompanyDatabase: true,
    canAccessFinancialSystems: true,
    commercialRisk: 'muito_alto',
    recommendedFor: 'fase futura, com governanca forte e autorizacao explicita'
  }
];

const DEFAULT_DATA_ACCESS_POLICY = {
  currentMode: 'manual_local',
  allowDatabaseRead: false,
  allowDatabaseWrite: false,
  allowFinancialAccess: false,
  requireOwnerApprovalForModeChange: true,
  requireDevResponsibleApprovalForIntegration: true,
  auditAllExternalDataAccess: true,
  notes: 'Comecar sem banco de dados da empresa. Evoluir por confianca, prova de valor e autorizacao formal.',
  modes: DATA_ACCESS_MODES
};

function seedDataAccessPolicy() {
  saveDataAccessPolicy(DEFAULT_DATA_ACCESS_POLICY);
  return DEFAULT_DATA_ACCESS_POLICY;
}

function ensureDataAccessPolicy() {
  const policy = getDataAccessPolicy();
  if (policy && Object.keys(policy).length) {
    return policy;
  }
  return seedDataAccessPolicy();
}

function findMode(modeKey) {
  return DATA_ACCESS_MODES.find(mode => normalizeText(mode.key) === normalizeText(modeKey));
}

function setDataAccessMode(modeKey) {
  const mode = findMode(modeKey);
  if (!mode) {
    throw new Error(`Modo de acesso a dados invalido: ${modeKey}`);
  }

  const policy = ensureDataAccessPolicy();
  const nextPolicy = {
    ...policy,
    currentMode: mode.key,
    allowDatabaseRead: mode.canReadCompanyDatabase,
    allowDatabaseWrite: mode.canWriteCompanyDatabase,
    allowFinancialAccess: mode.canAccessFinancialSystems,
    updatedAt: new Date().toISOString()
  };

  saveDataAccessPolicy(nextPolicy);
  return nextPolicy;
}

module.exports = {
  DATA_ACCESS_MODES,
  DEFAULT_DATA_ACCESS_POLICY,
  seedDataAccessPolicy,
  ensureDataAccessPolicy,
  setDataAccessMode,
  findMode
};
