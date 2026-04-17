'use strict';

const { randomUUID } = require('crypto');

const {
  getConfig,
  listUsers,
  listSuppliers,
  listQuotes,
  listShortages,
  saveMessages,
  listMessages,
  listPurchaseRequests,
  savePurchaseRequests
} = require('./storage.cjs');
const { ensureFlowPolicies } = require('./flow-policies.cjs');
const { decideInboundBehavior } = require('./communication-policy.cjs');
const { filterSuppliersForMaterial } = require('./material-catalog.cjs');
const { normalizeText, normalizePhone, rankQuotes } = require('./scoring.cjs');
const { canonicalRoleKey } = require('./role-aliases.cjs');

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function findUserByName(name) {
  const users = listUsers();
  return users.find(user => normalizeText(user.name) === normalizeText(name));
}

function findUserByPhone(phone) {
  const users = listUsers();
  return users.find(user => normalizePhone(user.phone) === normalizePhone(phone));
}

function findSupplierByPhone(phone) {
  const suppliers = listSuppliers();
  return suppliers.find(supplier => {
    const supplierPhones = [supplier.phone, supplier.whatsapp].filter(Boolean);
    return supplierPhones.some(value => normalizePhone(value) === normalizePhone(phone));
  });
}

function findUsersByRoleKeys(roleKeys) {
  const wanted = new Set((roleKeys || []).map(role => canonicalRoleKey(role)));
  return listUsers().filter(user => wanted.has(canonicalRoleKey(user.role)));
}

function getPolicy(policyKey) {
  return ensureFlowPolicies().find(policy => normalizeText(policy.key) === normalizeText(policyKey));
}

function appendMessage(message) {
  const messages = listMessages();
  messages.push(message);
  saveMessages(messages);
  return message;
}

function sendWhatsAppMessage({ toName, toPhone, role, direction, text, relatedEntityType, relatedEntityId }) {
  return appendMessage({
    id: createId('message'),
    channel: 'whatsapp',
    provider: 'mock',
    direction,
    toName: toName || '',
    toPhone: toPhone || '',
    role: role || '',
    text,
    relatedEntityType: relatedEntityType || '',
    relatedEntityId: relatedEntityId || '',
    createdAt: new Date().toISOString()
  });
}

function notifyUsersByRoles({ roleKeys, text, relatedEntityType, relatedEntityId }) {
  const recipients = findUsersByRoleKeys(roleKeys);
  const sent = [];

  for (const recipient of recipients) {
    sent.push(sendWhatsAppMessage({
      toName: recipient.name,
      toPhone: recipient.phone,
      role: recipient.role,
      direction: 'outbound',
      text,
      relatedEntityType,
      relatedEntityId
    }));
  }

  return sent;
}

function buildPurchaseRequest(shortage) {
  const config = getConfig();
  const quotes = rankQuotes(
    listQuotes().filter(quote => normalizeText(quote.item) === normalizeText(shortage.item)),
    shortage
  );

  if (!quotes.length) {
    return null;
  }

  const bestQuote = quotes[0];
  const missingQuantity = Math.max(Number(shortage.needed || 0) - Number(shortage.available || 0), 0);

  const request = {
    id: createId('purchase-request'),
    shortageId: shortage.id,
    item: shortage.item,
    unit: shortage.unit || 'un',
    missingQuantity,
    bestSupplier: bestQuote.supplier,
    bestUnitPrice: Number(bestQuote.unitPrice || 0),
    bestLeadDays: Number(bestQuote.leadDays || 0),
    bestPayment: bestQuote.payment || '',
    quotes,
    status: config.permissions.purchaseMode === 'auto_purchase' && config.permissions.allowAutoPurchase
      ? 'approved_for_purchase'
      : 'pending_approval',
    purchaseModeSnapshot: config.permissions.purchaseMode,
    requireOwnerApproval: Boolean(config.permissions.requireOwnerApproval),
    createdAt: new Date().toISOString(),
    approvedAt: null,
    approvedBy: null,
    notes: ''
  };

  const purchaseRequests = listPurchaseRequests();
  purchaseRequests.push(request);
  savePurchaseRequests(purchaseRequests);

  return request;
}

function routePurchaseDecision(request) {
  const config = getConfig();
  const users = listUsers();
  const owner = users.find(user => canonicalRoleKey(user.role) === 'proprietario');
  const buyer = users.find(user => canonicalRoleKey(user.role) === 'comprador');

  if (config.permissions.purchaseMode === 'quote_only') {
    if (buyer) {
      sendWhatsAppMessage({
        toName: buyer.name,
        toPhone: buyer.phone,
        role: buyer.role,
        direction: 'outbound',
        text: `Cotacao pronta para ${request.item}. Melhor opcao: ${request.bestSupplier} por ${request.bestUnitPrice}. Aguardando sua decisao.`,
        relatedEntityType: 'purchase_request',
        relatedEntityId: request.id
      });
    }
    return 'quoted_to_buyer';
  }

  if (config.permissions.requireOwnerApproval && owner) {
    sendWhatsAppMessage({
      toName: owner.name,
      toPhone: owner.phone,
      role: owner.role,
      direction: 'outbound',
      text: `Aprovacao solicitada para compra de ${request.item}. Melhor fornecedor: ${request.bestSupplier}. Quantidade faltante: ${request.missingQuantity} ${request.unit}.`,
      relatedEntityType: 'purchase_request',
      relatedEntityId: request.id
    });
    return 'sent_for_owner_approval';
  }

  if (buyer) {
    sendWhatsAppMessage({
      toName: buyer.name,
      toPhone: buyer.phone,
      role: buyer.role,
      direction: 'outbound',
      text: `Compra liberada para ${request.item} com ${request.bestSupplier}.`,
      relatedEntityType: 'purchase_request',
      relatedEntityId: request.id
    });
  }

  return 'sent_to_buyer_for_execution';
}

function approvePurchaseRequest({ requestId, approverName, notes }) {
  const purchaseRequests = listPurchaseRequests();
  const request = purchaseRequests.find(entry => entry.id === requestId);

  if (!request) {
    throw new Error(`Solicitacao de compra nao encontrada: ${requestId}`);
  }

  const approver = findUserByName(approverName);
  if (!approver) {
    throw new Error(`Aprovador nao encontrado: ${approverName}`);
  }

  request.status = 'approved_for_purchase';
  request.approvedAt = new Date().toISOString();
  request.approvedBy = approver.name;
  request.notes = notes || request.notes || '';
  savePurchaseRequests(purchaseRequests);

  const normalizedBuyer = listUsers().find(user => canonicalRoleKey(user.role) === 'comprador');
  if (normalizedBuyer) {
    sendWhatsAppMessage({
      toName: normalizedBuyer.name,
      toPhone: normalizedBuyer.phone,
      role: normalizedBuyer.role,
      direction: 'outbound',
      text: `Compra aprovada por ${approver.name}: ${request.item} com ${request.bestSupplier}.`,
      relatedEntityType: 'purchase_request',
      relatedEntityId: request.id
    });
  }

  return request;
}

function registerInboundWhatsApp({ phone, text, relatedEntityType, relatedEntityId }) {
  const sender = findUserByPhone(phone);
  const supplier = sender ? null : findSupplierByPhone(phone);
  const role = sender ? sender.role : supplier ? 'fornecedor' : '';
  const inboundPolicy = decideInboundBehavior({ role, text });

  return appendMessage({
    id: createId('message'),
    channel: 'whatsapp',
    provider: 'mock',
    direction: 'inbound',
    fromName: sender ? sender.name : supplier ? supplier.name : '',
    fromPhone: phone,
    role,
    text,
    relatedEntityType: relatedEntityType || '',
    relatedEntityId: relatedEntityId || '',
    readState: inboundPolicy.mode === 'silent_ignore' ? 'delivered_only' : 'blue_ticks_only',
    inboundHandling: inboundPolicy,
    createdAt: new Date().toISOString()
  });
}

function processShortagePolicy(shortage, options = {}) {
  const policy = getPolicy('shortage_reporting');
  if (!policy) {
    return { notified: [], policyFound: false };
  }

  const missingQuantity = Math.max(Number(shortage.needed || 0) - Number(shortage.available || 0), 0);
  const notifyText = `Nova falta registrada: ${shortage.item}. Falta estimada: ${missingQuantity} ${shortage.unit || 'un'}. Prioridade: ${shortage.priority || 'media'}.`;
  const notified = notifyUsersByRoles({
    roleKeys: policy.roles.notified,
    text: notifyText,
    relatedEntityType: 'shortage',
    relatedEntityId: shortage.id
  });

  const validators = findUsersByRoleKeys(policy.roles.mustValidate);
  if (!options.skipValidationRequest && validators.length) {
    notifyUsersByRoles({
      roleKeys: policy.roles.mustValidate,
      text: `Validacao solicitada para falta de ${shortage.item}. Origem: ${shortage.source || 'manual'}.`,
      relatedEntityType: 'shortage_validation',
      relatedEntityId: shortage.id
    });
  }

  return {
    policyFound: true,
    notified
  };
}

function processQuotePolicy(shortage) {
  const policy = getPolicy('quote_collection');
  if (!policy) {
    return { policyFound: false, supplierMessages: [] };
  }

  const supplierSelection = filterSuppliersForMaterial(shortage.item);
  const suppliers = supplierSelection.suppliers;
  const missingQuantity = Math.max(Number(shortage.needed || 0) - Number(shortage.available || 0), 0);
  const messages = [];

  if (!supplierSelection.material && supplierSelection.resolution?.status !== 'not_found') {
    const candidates = (supplierSelection.resolution?.candidates || [])
      .map(candidate => candidate.name)
      .join(', ') || 'sem candidatos';

    notifyUsersByRoles({
      roleKeys: ['gerente_deposito', 'comprador'],
      text: `Material ambiguo para cotacao: ${shortage.item}. Candidatos: ${candidates}. Validacao humana necessaria.`,
      relatedEntityType: 'material_resolution',
      relatedEntityId: shortage.id
    });

    return {
      policyFound: true,
      supplierMessages: [],
      materialMatch: null,
      selectionReason: supplierSelection.reason
    };
  }

  for (const supplier of suppliers) {
    messages.push(sendWhatsAppMessage({
      toName: supplier.name,
      toPhone: supplier.whatsapp || supplier.phone,
      role: 'fornecedor',
      direction: 'outbound',
      text: `Pedido de cotacao: ${shortage.item}, quantidade ${missingQuantity} ${shortage.unit || 'un'}, prioridade ${shortage.priority || 'media'}.`,
      relatedEntityType: 'quote_request',
      relatedEntityId: shortage.id
    }));
  }

  notifyUsersByRoles({
    roleKeys: policy.roles.notified,
    text: `Cotacao iniciada para ${shortage.item} com ${suppliers.length} fornecedor(es). Base: ${supplierSelection.reason}.`,
    relatedEntityType: 'quote_request',
    relatedEntityId: shortage.id
  });

  return {
    policyFound: true,
    supplierMessages: messages,
    materialMatch: supplierSelection.material,
    selectionReason: supplierSelection.reason
  };
}

function rejectPurchaseRequest({ requestId, rejectorName, notes }) {
  const purchaseRequests = listPurchaseRequests();
  const request = purchaseRequests.find(entry => entry.id === requestId);

  if (!request) {
    throw new Error(`Solicitacao de compra nao encontrada: ${requestId}`);
  }

  if (request.status === 'approved_for_purchase') {
    throw new Error(`Solicitacao ja aprovada, nao pode ser rejeitada: ${requestId}`);
  }

  const rejector = findUserByName(rejectorName);
  if (!rejector) {
    throw new Error(`Usuario nao encontrado: ${rejectorName}`);
  }

  request.status = 'rejected';
  request.rejectedAt = new Date().toISOString();
  request.rejectedBy = rejector.name;
  request.notes = notes || request.notes || '';
  savePurchaseRequests(purchaseRequests);

  const buyer = listUsers().find(user => canonicalRoleKey(user.role) === 'comprador');
  if (buyer) {
    sendWhatsAppMessage({
      toName: buyer.name,
      toPhone: buyer.phone,
      role: buyer.role,
      direction: 'outbound',
      text: `Compra rejeitada por ${rejector.name}: ${request.item}. Motivo: ${notes || 'nao informado'}.`,
      relatedEntityType: 'purchase_request',
      relatedEntityId: request.id
    });
  }

  return request;
}

function registerInboundQuote({ phone, item, unitPrice, quantity, leadDays, payment, notes }) {
  const supplier = findSupplierByPhone(phone);
  if (!supplier) {
    throw new Error(`Fornecedor nao encontrado para o numero: ${phone}`);
  }

  const text = `Cotacao recebida: ${item} | R$${unitPrice}/un | qtd=${quantity} | prazo=${leadDays}d | pgto=${payment || '-'}`;

  registerInboundWhatsApp({
    phone,
    text,
    relatedEntityType: 'quote_response',
    relatedEntityId: ''
  });

  const { listQuotes, saveQuotes } = require('./storage.cjs');
  const quotes = listQuotes();
  const entry = {
    id: createId('quote'),
    supplier: supplier.name,
    item,
    unitPrice: Number(unitPrice || 0),
    quantity: Number(quantity || 0),
    leadDays: Number(leadDays || 0),
    payment: payment || '',
    notes: notes || '',
    source: 'whatsapp',
    createdAt: new Date().toISOString()
  };

  quotes.push(entry);
  saveQuotes(quotes);

  notifyUsersByRoles({
    roleKeys: ['comprador', 'gerente_comercial'],
    text: `Nova cotacao de ${supplier.name}: ${item} a R$${unitPrice}/un, prazo ${leadDays} dia(s).`,
    relatedEntityType: 'quote_response',
    relatedEntityId: entry.id
  });

  return entry;
}

module.exports = {
  buildPurchaseRequest,
  routePurchaseDecision,
  approvePurchaseRequest,
  rejectPurchaseRequest,
  registerInboundWhatsApp,
  registerInboundQuote,
  sendWhatsAppMessage,
  findUserByName,
  processShortagePolicy,
  processQuotePolicy
};
