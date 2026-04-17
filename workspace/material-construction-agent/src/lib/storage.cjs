'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

const FILES = {
  config: path.join(DATA_DIR, 'config.json'),
  roles: path.join(DATA_DIR, 'roles.json'),
  accessMatrix: path.join(DATA_DIR, 'access-matrix.json'),
  flowPolicies: path.join(DATA_DIR, 'flow-policies.json'),
  communicationPolicy: path.join(DATA_DIR, 'communication-policy.json'),
  dataAccessPolicy: path.join(DATA_DIR, 'data-access-policy.json'),
  materialCatalog: path.join(DATA_DIR, 'materials.json'),
  supplierTypes: path.join(DATA_DIR, 'supplier-types.json'),
  materialSupplierRules: path.join(DATA_DIR, 'material-supplier-rules.json'),
  clientProfile: path.join(DATA_DIR, 'client-profile.json'),
  shortages: path.join(DATA_DIR, 'shortages.json'),
  users: path.join(DATA_DIR, 'users.json'),
  suppliers: path.join(DATA_DIR, 'suppliers.json'),
  quotes: path.join(DATA_DIR, 'quotes.json')
  ,
  quoteQueue: path.join(DATA_DIR, 'quote-queue.json'),
  quoteBatches: path.join(DATA_DIR, 'quote-batches.json'),
  messages: path.join(DATA_DIR, 'messages.json'),
  purchaseRequests: path.join(DATA_DIR, 'purchase-requests.json')
};

function getDataSnapshot() {
  return {
    config: getConfig(),
    dataAccessPolicy: getDataAccessPolicy(),
    roles: listRoles(),
    accessMatrix: getAccessMatrix(),
    flowPolicies: getFlowPolicies(),
    communicationPolicy: getCommunicationPolicy(),
    materials: listMaterials(),
    supplierTypes: listSupplierTypes(),
    materialSupplierRules: listMaterialSupplierRules(),
    clientProfile: getClientProfile(),
    users: listUsers(),
    suppliers: listSuppliers(),
    shortages: listShortages(),
    quotes: listQuotes(),
    quoteQueue: listQuoteQueue(),
    quoteBatches: listQuoteBatches(),
    messages: listMessages(),
    purchaseRequests: listPurchaseRequests()
  };
}

const DEFAULT_CONFIG = {
  companyName: 'Loja Modelo',
  channels: {
    whatsapp: {
      enabled: false,
      provider: 'mock',
      mode: 'manual-review'
    }
  },
  permissions: {
    purchaseMode: 'quote_only',
    allowAutoPurchase: false,
    requireOwnerApproval: true,
    allowDatabaseAccess: false,
    allowFinancialAccess: false
  },
  roadmap: {
    futureDatabaseAccess: true,
    futureFinancialAccess: true,
    futureERPAccess: true
  }
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath, fallback = '[]\n') {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, fallback, 'utf8');
  }
}

function ensureStorage() {
  ensureDir(DATA_DIR);
  ensureDir(REPORTS_DIR);
  ensureFile(FILES.config, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  ensureFile(FILES.roles);
  ensureFile(FILES.accessMatrix);
  ensureFile(FILES.flowPolicies);
  ensureFile(FILES.communicationPolicy);
  ensureFile(FILES.dataAccessPolicy);
  ensureFile(FILES.materialCatalog);
  ensureFile(FILES.supplierTypes);
  ensureFile(FILES.materialSupplierRules);
  ensureFile(FILES.clientProfile, '{}\n');
  ensureFile(FILES.shortages);
  ensureFile(FILES.users);
  ensureFile(FILES.suppliers);
  ensureFile(FILES.quotes);
  ensureFile(FILES.quoteQueue);
  ensureFile(FILES.quoteBatches);
  ensureFile(FILES.messages);
  ensureFile(FILES.purchaseRequests);
}

function readJson(filePath, fallback = []) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function listShortages() {
  return readJson(FILES.shortages, []);
}

function saveShortages(items) {
  writeJson(FILES.shortages, items);
}

function listRoles() {
  return readJson(FILES.roles, []);
}

function saveRoles(items) {
  writeJson(FILES.roles, items);
}

function getAccessMatrix() {
  return readJson(FILES.accessMatrix, []);
}

function saveAccessMatrix(items) {
  writeJson(FILES.accessMatrix, items);
}

function getFlowPolicies() {
  return readJson(FILES.flowPolicies, []);
}

function saveFlowPolicies(items) {
  writeJson(FILES.flowPolicies, items);
}

function getCommunicationPolicy() {
  return readJson(FILES.communicationPolicy, {});
}

function saveCommunicationPolicy(items) {
  writeJson(FILES.communicationPolicy, items);
}

function getDataAccessPolicy() {
  return readJson(FILES.dataAccessPolicy, {});
}

function saveDataAccessPolicy(items) {
  writeJson(FILES.dataAccessPolicy, items);
}

function listMaterials() {
  return readJson(FILES.materialCatalog, []);
}

function saveMaterials(items) {
  writeJson(FILES.materialCatalog, items);
}

function listSupplierTypes() {
  return readJson(FILES.supplierTypes, []);
}

function saveSupplierTypes(items) {
  writeJson(FILES.supplierTypes, items);
}

function listMaterialSupplierRules() {
  return readJson(FILES.materialSupplierRules, []);
}

function saveMaterialSupplierRules(items) {
  writeJson(FILES.materialSupplierRules, items);
}

function getClientProfile() {
  return readJson(FILES.clientProfile, {});
}

function saveClientProfile(profile) {
  writeJson(FILES.clientProfile, profile);
}

function getConfig() {
  return readJson(FILES.config, DEFAULT_CONFIG);
}

function saveConfig(config) {
  writeJson(FILES.config, config);
}

function listUsers() {
  return readJson(FILES.users, []);
}

function saveUsers(items) {
  writeJson(FILES.users, items);
}

function listSuppliers() {
  return readJson(FILES.suppliers, []);
}

function saveSuppliers(items) {
  writeJson(FILES.suppliers, items);
}

function listQuotes() {
  return readJson(FILES.quotes, []);
}

function saveQuotes(items) {
  writeJson(FILES.quotes, items);
}

function listQuoteQueue() {
  return readJson(FILES.quoteQueue, []);
}

function saveQuoteQueue(items) {
  writeJson(FILES.quoteQueue, items);
}

function listQuoteBatches() {
  return readJson(FILES.quoteBatches, []);
}

function saveQuoteBatches(items) {
  writeJson(FILES.quoteBatches, items);
}

function listMessages() {
  return readJson(FILES.messages, []);
}

function saveMessages(items) {
  writeJson(FILES.messages, items);
}

function listPurchaseRequests() {
  return readJson(FILES.purchaseRequests, []);
}

function savePurchaseRequests(items) {
  writeJson(FILES.purchaseRequests, items);
}

function writeReport(fileName, content) {
  ensureStorage();
  const reportPath = path.join(REPORTS_DIR, fileName);
  fs.writeFileSync(reportPath, content, 'utf8');
  return reportPath;
}

module.exports = {
  DATA_DIR,
  REPORTS_DIR,
  ensureStorage,
  getDataSnapshot,
  getConfig,
  saveConfig,
  listRoles,
  saveRoles,
  getAccessMatrix,
  saveAccessMatrix,
  getFlowPolicies,
  saveFlowPolicies,
  getCommunicationPolicy,
  saveCommunicationPolicy,
  getDataAccessPolicy,
  saveDataAccessPolicy,
  listMaterials,
  saveMaterials,
  listSupplierTypes,
  saveSupplierTypes,
  listMaterialSupplierRules,
  saveMaterialSupplierRules,
  getClientProfile,
  saveClientProfile,
  listShortages,
  saveShortages,
  listUsers,
  saveUsers,
  listSuppliers,
  saveSuppliers,
  listQuotes,
  saveQuotes,
  listQuoteQueue,
  saveQuoteQueue,
  listQuoteBatches,
  saveQuoteBatches,
  listMessages,
  saveMessages,
  listPurchaseRequests,
  savePurchaseRequests,
  writeReport
};
