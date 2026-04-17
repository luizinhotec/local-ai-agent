'use strict';

const { randomUUID } = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  ensureStorage,
  getDataSnapshot,
  listUsers,
  saveUsers,
  listShortages,
  saveShortages,
  listSuppliers,
  saveSuppliers,
  listQuotes,
  saveQuotes
} = require('./lib/storage.cjs');
const {
  addMaterial,
  addMaterialAliases,
  filterSuppliersForMaterial,
  generateAliasesForMaterialName,
  importMaterialsFromFile
} = require('./lib/material-catalog.cjs');
const {
  buildQuoteBatch,
  enqueueShortageForQuote,
  sendQuoteBatch
} = require('./lib/quote-batches.cjs');
const {
  normalizeText,
  normalizePhone
} = require('./lib/scoring.cjs');
const {
  buildPurchaseRequest,
  registerInboundWhatsApp,
  routePurchaseDecision,
  processShortagePolicy
} = require('./lib/workflow.cjs');
const { canonicalRoleKey } = require('./lib/role-aliases.cjs');
const { ensureDefaultRoles } = require('./lib/roles.cjs');
const { buildDailyReport } = require('./lib/report.cjs');
const { seedRirroferDemo } = require('./lib/demo-rirrofer.cjs');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'src', 'public');
const PORT = Number(process.env.MCA_DASHBOARD_PORT || 8788);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'content-type': contentType });
  res.end(text);
}

function sendBuffer(res, statusCode, buffer, contentType = 'application/octet-stream') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': buffer.length
  });
  res.end(buffer);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload muito grande.'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('JSON invalido.'));
      }
    });
    req.on('error', reject);
  });
}

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireBodyFields(body, fields) {
  const missing = fields.filter(field => !body[field]);
  if (missing.length) {
    throw new Error(`Campos obrigatorios ausentes: ${missing.join(', ')}.`);
  }
}

function findUserByPhone(phone) {
  return listUsers().find(user => normalizePhone(user.phone) === normalizePhone(phone));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === '/' ? '/dashboard.html' : url.pathname;
  const filePath = path.join(PUBLIC_DIR, pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(filePath)) {
    sendText(res, 404, 'Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.html'
    ? 'text/html; charset=utf-8'
    : ext === '.css'
      ? 'text/css; charset=utf-8'
      : ext === '.js'
        ? 'application/javascript; charset=utf-8'
        : ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'application/octet-stream';

  const isTextFile = ['.html', '.css', '.js'].includes(ext);
  if (isTextFile) {
    sendText(res, 200, fs.readFileSync(filePath, 'utf8'), contentType);
    return;
  }

  sendBuffer(res, 200, fs.readFileSync(filePath), contentType);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/snapshot') {
    sendJson(res, 200, getDataSnapshot());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/demo/rirrofer') {
    const result = seedRirroferDemo();
    sendJson(res, 200, { ok: true, result, snapshot: getDataSnapshot() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reports/daily') {
    const report = buildDailyReport();
    sendJson(res, 201, { ok: true, report });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/materials') {
    const body = await readRequestBody(req);
    const material = addMaterial(body);
    sendJson(res, 201, { ok: true, material });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/materials/aliases') {
    const body = await readRequestBody(req);
    const material = addMaterialAliases(body.item, body.aliases);
    sendJson(res, 200, { ok: true, material });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/materials/resolve') {
    const body = await readRequestBody(req);
    const result = filterSuppliersForMaterial(body.item || '');
    sendJson(res, 200, { ok: true, result });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/materials/generate-aliases') {
    const body = await readRequestBody(req);
    sendJson(res, 200, {
      ok: true,
      aliases: generateAliasesForMaterialName(body.name || '')
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/materials/import') {
    const body = await readRequestBody(req);
    if (!body.file) {
      throw new Error('Caminho do arquivo e obrigatorio.');
    }
    const result = importMaterialsFromFile(path.resolve(ROOT, body.file));
    sendJson(res, 200, { ok: true, result });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/suppliers') {
    const body = await readRequestBody(req);
    const suppliers = listSuppliers();
    const supplier = {
      id: createId('supplier'),
      name: body.name,
      contact: body.contact || '',
      phone: body.phone || '',
      whatsapp: body.whatsapp || body.phone || '',
      city: body.city || '',
      supplierTypes: String(body.supplierTypes || '')
        .split(',')
        .map(value => normalizeText(value))
        .filter(Boolean),
      payment: body.payment || '',
      notes: body.notes || '',
      active: body.active !== false,
      createdAt: new Date().toISOString()
    };

    if (!supplier.name) {
      throw new Error('Nome do fornecedor e obrigatorio.');
    }

    suppliers.push(supplier);
    saveSuppliers(suppliers);
    sendJson(res, 201, { ok: true, supplier });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/users') {
    const body = await readRequestBody(req);
    requireBodyFields(body, ['name', 'role', 'phone']);

    const roleKey = canonicalRoleKey(body.role);
    const roles = ensureDefaultRoles();
    if (!roles.some(role => role.key === roleKey)) {
      throw new Error(`Cargo nao encontrado: ${body.role}`);
    }

    const users = listUsers();
    const user = {
      id: createId('user'),
      name: body.name,
      role: roleKey,
      phone: body.phone,
      sector: body.sector || '',
      canReportShortage: body.canReportShortage !== 'false',
      canApprovePurchase: body.canApprovePurchase === 'true',
      canExecutePurchase: body.canExecutePurchase === 'true',
      createdAt: new Date().toISOString()
    };

    users.push(user);
    saveUsers(users);
    sendJson(res, 201, { ok: true, user });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/shortages') {
    const body = await readRequestBody(req);
    requireBodyFields(body, ['item', 'needed', 'available']);

    const sender = body.phone ? findUserByPhone(body.phone) : null;
    const source = body.source || (body.phone ? 'whatsapp' : 'manual');
    const rolesThatAutoValidate = new Set(['gerente_deposito', 'gerente_geral']);
    const autoValidated = sender && rolesThatAutoValidate.has(canonicalRoleKey(sender.role));
    const status = body.status || (autoValidated ? 'validated' : 'pending_validation');
    const shortage = {
      id: createId('shortage'),
      item: body.item,
      category: body.category || 'geral',
      needed: numeric(body.needed),
      available: numeric(body.available),
      unit: body.unit || 'un',
      priority: body.priority || 'media',
      notes: body.notes || '',
      status,
      reportedBy: sender ? sender.name : body.reportedBy || '',
      source,
      createdAt: new Date().toISOString()
    };

    if (body.phone) {
      if (!sender) {
        throw new Error(`Remetente nao cadastrado: ${body.phone}`);
      }
      registerInboundWhatsApp({
        phone: body.phone,
        text: body.text || `Falta reportada: ${body.item}`,
        relatedEntityType: 'shortage',
        relatedEntityId: shortage.id
      });
    }

    const shortages = listShortages();
    shortages.push(shortage);
    saveShortages(shortages);

    const policyResult = processShortagePolicy(shortage, { skipValidationRequest: autoValidated });
    const quoteQueueEntry = status === 'validated' ? enqueueShortageForQuote(shortage) : null;

    sendJson(res, 201, {
      ok: true,
      shortage,
      policyResult,
      quoteQueueEntry
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/quotes') {
    const body = await readRequestBody(req);
    requireBodyFields(body, ['supplier', 'item', 'unitPrice', 'quantity', 'leadDays']);

    const suppliers = listSuppliers();
    const supplierExists = suppliers.some(
      supplier => normalizeText(supplier.name) === normalizeText(body.supplier)
    );
    if (!supplierExists) {
      throw new Error(`Fornecedor nao encontrado: ${body.supplier}`);
    }

    const quotes = listQuotes();
    const quote = {
      id: createId('quote'),
      supplier: body.supplier,
      item: body.item,
      unitPrice: numeric(body.unitPrice),
      quantity: numeric(body.quantity),
      leadDays: numeric(body.leadDays),
      payment: body.payment || '',
      notes: body.notes || '',
      source: body.source || 'dashboard',
      createdAt: new Date().toISOString()
    };

    quotes.push(quote);
    saveQuotes(quotes);
    sendJson(res, 201, { ok: true, quote });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/purchase/plan') {
    const body = await readRequestBody(req);
    requireBodyFields(body, ['shortageId']);

    const shortage = listShortages().find(entry => entry.id === body.shortageId);
    if (!shortage) {
      throw new Error(`Falta nao encontrada: ${body.shortageId}`);
    }

    const request = buildPurchaseRequest(shortage);
    if (!request) {
      throw new Error(`Nao existem cotacoes para o item: ${shortage.item}`);
    }

    const outcome = routePurchaseDecision(request);
    sendJson(res, 201, { ok: true, request, outcome });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/quote/build-batch') {
    const body = await readRequestBody(req);
    const batch = buildQuoteBatch({
      mode: body.mode || 'manual',
      notes: body.notes || ''
    });
    sendJson(res, 201, { ok: true, batch });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/quote/send-batch') {
    const body = await readRequestBody(req);
    if (!body.batchId) {
      throw new Error('batchId e obrigatorio.');
    }
    const batch = sendQuoteBatch(body.batchId);
    sendJson(res, 200, { ok: true, batch });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Endpoint nao encontrado.' });
}

async function handleRequest(req, res) {
  try {
    if (req.url.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
  }
}

function main() {
  ensureStorage();
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`Material Construction Agent dashboard: http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  main();
}
