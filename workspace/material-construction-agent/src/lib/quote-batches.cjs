'use strict';

const { randomUUID } = require('crypto');

const {
  listQuoteQueue,
  saveQuoteQueue,
  listQuoteBatches,
  saveQuoteBatches,
  listSuppliers,
  listMessages,
  saveMessages
} = require('./storage.cjs');
const { filterSuppliersForMaterial } = require('./material-catalog.cjs');
const { normalizeText } = require('./scoring.cjs');

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function enqueueShortageForQuote(shortage) {
  const queue = listQuoteQueue();
  const existing = queue.find(item => item.shortageId === shortage.id);
  if (existing) {
    return existing;
  }

  const missingQuantity = Math.max(Number(shortage.needed || 0) - Number(shortage.available || 0), 0);
  const selection = filterSuppliersForMaterial(shortage.item);
  const entry = {
    id: createId('quote-queue'),
    shortageId: shortage.id,
    item: shortage.item,
    unit: shortage.unit || 'un',
    missingQuantity,
    priority: shortage.priority || 'media',
    status: selection.material ? 'ready_for_batch' : 'needs_material_validation',
    materialSku: selection.material ? selection.material.sku : null,
    materialName: selection.material ? selection.material.name : null,
    resolutionStatus: selection.resolution ? selection.resolution.status : 'unknown',
    supplierCandidates: (selection.suppliers || []).map(supplier => ({
      supplierId: supplier.id,
      name: supplier.name,
      phone: supplier.whatsapp || supplier.phone,
      supplierTypes: supplier.supplierTypes || []
    })),
    createdAt: new Date().toISOString()
  };

  queue.push(entry);
  saveQuoteQueue(queue);
  return entry;
}

function groupQueueItemsBySupplier(queueItems) {
  const groups = new Map();

  for (const item of queueItems) {
    for (const supplier of item.supplierCandidates || []) {
      if (!supplier.phone) {
        continue;
      }

      const key = supplier.supplierId || normalizeText(supplier.name);
      if (!groups.has(key)) {
        groups.set(key, {
          supplier,
          items: []
        });
      }
      groups.get(key).items.push(item);
    }
  }

  return [...groups.values()];
}

function consolidateGroupItems(items) {
  const map = new Map();

  for (const item of items) {
    const key = `${normalizeText(item.materialName || item.item)}|${normalizeText(item.unit)}`;
    if (!map.has(key)) {
      map.set(key, {
        ...item,
        sourceQueueIds: [item.id]
      });
      continue;
    }

    const current = map.get(key);
    current.missingQuantity += Number(item.missingQuantity || 0);
    current.sourceQueueIds.push(item.id);
  }

  return [...map.values()];
}

function buildSupplierMessage(group) {
  const items = consolidateGroupItems(group.items);
  const lines = [
    'Bom dia, poderia cotar estes itens?',
    '',
    ...items.map((item, index) =>
      `${index + 1}. ${item.materialName || item.item} - ${item.missingQuantity} ${item.unit}`
    ),
    '',
    'Favor informar:',
    '- preco unitario',
    '- disponibilidade',
    '- prazo de entrega',
    '- condicao de pagamento'
  ];

  return lines.join('\n');
}

function buildQuoteBatch({ mode = 'manual', notes = '' } = {}) {
  const queue = listQuoteQueue();
  const readyItems = queue.filter(item => item.status === 'ready_for_batch');
  const grouped = groupQueueItemsBySupplier(readyItems);

  const batch = {
    id: createId('quote-batch'),
    mode,
    status: 'draft',
    notes,
    itemCount: readyItems.length,
    supplierCount: grouped.length,
    groups: grouped.map(group => ({
      supplier: group.supplier,
      items: consolidateGroupItems(group.items),
      message: buildSupplierMessage(group)
    })),
    createdAt: new Date().toISOString(),
    sentAt: null
  };

  const batches = listQuoteBatches();
  batches.push(batch);
  saveQuoteBatches(batches);
  return batch;
}

function sendQuoteBatch(batchId) {
  const batches = listQuoteBatches();
  const batch = batches.find(entry => entry.id === batchId);

  if (!batch) {
    throw new Error(`Lote de cotacao nao encontrado: ${batchId}`);
  }

  if (batch.status === 'sent') {
    return batch;
  }

  const messages = listMessages();
  for (const group of batch.groups || []) {
    messages.push({
      id: createId('message'),
      channel: 'whatsapp',
      provider: 'mock',
      direction: 'outbound',
      toName: group.supplier.name,
      toPhone: group.supplier.phone,
      role: 'fornecedor',
      text: group.message,
      relatedEntityType: 'quote_batch',
      relatedEntityId: batch.id,
      createdAt: new Date().toISOString()
    });
  }
  saveMessages(messages);

  batch.status = 'sent';
  batch.sentAt = new Date().toISOString();
  saveQuoteBatches(batches);

  const queue = listQuoteQueue();
  const sentQueueIds = new Set((batch.groups || []).flatMap(group =>
    group.items.flatMap(item => item.sourceQueueIds || [item.id])
  ));
  for (const item of queue) {
    if (sentQueueIds.has(item.id)) {
      item.status = 'batch_sent';
      item.batchId = batch.id;
      item.updatedAt = new Date().toISOString();
    }
  }
  saveQuoteQueue(queue);

  return batch;
}

module.exports = {
  enqueueShortageForQuote,
  buildQuoteBatch,
  sendQuoteBatch
};
