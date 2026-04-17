'use strict';

const {
  getConfig,
  saveConfig,
  saveUsers,
  saveSuppliers,
  saveMaterials,
  saveSupplierTypes,
  saveMaterialSupplierRules,
  saveShortages,
  saveQuotes,
  saveQuoteQueue,
  saveQuoteBatches,
  saveMessages,
  savePurchaseRequests,
  saveClientProfile
} = require('./storage.cjs');
const { buildQuoteBatch, sendQuoteBatch } = require('./quote-batches.cjs');
const { buildPurchaseRequest, routePurchaseDecision } = require('./workflow.cjs');

function nowIso(offsetMinutes = 0) {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

const clientProfile = {
  id: 'rirrofer',
  name: 'RIRROFER Materiais de Construcao',
  instagram: 'https://www.instagram.com/rirrofer_/',
  city: 'Carmo',
  state: 'RJ',
  segment: 'Loja de materiais de construcao',
  status: 'cliente_potencial',
  positioning: 'Demo personalizada para mostrar como o agente recebe faltas pelo WhatsApp, consolida cotacoes por fornecedor e entrega uma recomendacao de compra sem pedir acesso inicial ao banco da loja.',
  assumptions: [
    'Operacao com balcao, deposito, entrega e compra com fornecedores.',
    'Inicio seguro sem acesso ao banco, ERP ou financeiro.',
    'Funcionarios informam faltas pelo WhatsApp e o agente consolida listas antes de cotar.'
  ],
  priorityModules: [
    {
      name: 'Faltas por WhatsApp',
      status: 'pronto_para_demo',
      description: 'Balconistas e deposito informam material, necessidade e saldo disponivel.'
    },
    {
      name: 'Cadastro por lista',
      status: 'pronto_para_demo',
      description: 'Entrada por CSV/JSON para montar o catalogo sem conectar no banco da loja.'
    },
    {
      name: 'Cotacao em lote',
      status: 'pronto_para_demo',
      description: 'O agente segura faltas em fila e manda listas consolidadas para fornecedores.'
    },
    {
      name: 'Aprovacao humana',
      status: 'modo_seguro',
      description: 'O agente recomenda a compra, mas comprador/proprietario decidem.'
    },
    {
      name: 'ERP no futuro',
      status: 'futuro',
      description: 'Arquitetura preparada para leitura ou escrita controlada quando houver confianca.'
    }
  ],
  materialFocus: [
    'materiais de construcao',
    'tintas',
    'eletrica',
    'hidraulica',
    'ferragens e ferramentas'
  ],
  trustRoadmap: [
    {
      phase: 'Fase 1',
      title: 'Sem banco da loja',
      description: 'WhatsApp, cadastro local, planilha importada e aprovacao humana.'
    },
    {
      phase: 'Fase 2',
      title: 'Planilha/ERP exportado',
      description: 'A loja exporta lista de materiais e estoque quando quiser.'
    },
    {
      phase: 'Fase 3',
      title: 'Leitura controlada',
      description: 'Acesso somente leitura ao ERP para sugerir compras com mais precisao.'
    },
    {
      phase: 'Fase 4',
      title: 'Automacao madura',
      description: 'Compra ou financeiro apenas com contrato, logs e limites claros.'
    }
  ],
  demoChecklist: [
    'Mostrar que o dashboard ja nasce com a identidade da Rirrofer.',
    'Simular uma falta informada por balconista ou deposito.',
    'Mostrar a fila segurando itens para cotacao em lote.',
    'Enviar lote mock para fornecedores certos.',
    'Registrar respostas e gerar recomendacao de compra.',
    'Reforcar que banco, ERP e financeiro ficam bloqueados na fase inicial.'
  ],
  sourceNotes: [
    'Instagram informado pelo usuario: https://www.instagram.com/rirrofer_/',
    'Perfil comercial usado apenas para demonstracao local.'
  ]
};

const supplierTypes = [
  { key: 'cimento', name: 'Cimento e argamassa' },
  { key: 'agregados', name: 'Areia, brita e agregados' },
  { key: 'hidraulica', name: 'Hidraulica' },
  { key: 'eletrica', name: 'Eletrica' },
  { key: 'tintas', name: 'Tintas e pintura' },
  { key: 'ferragens', name: 'Ferragens e ferramentas' },
  { key: 'seguranca', name: 'EPI e seguranca' },
  { key: 'distribuidor_geral', name: 'Distribuidor geral' }
];

const materials = [
  {
    sku: 'RIR-0001',
    name: 'Cimento CP-II 50kg',
    category: 'cimento',
    unit: 'saco',
    supplierTypes: ['cimento', 'distribuidor_geral'],
    aliases: ['cimento', 'cimento 50', 'cimento 50kg', 'cimento cp2', 'cp ii 50'],
    criticality: 'alta',
    minStock: 80,
    active: true
  },
  {
    sku: 'RIR-0002',
    name: 'Argamassa AC-II 20kg',
    category: 'cimento',
    unit: 'saco',
    supplierTypes: ['cimento', 'acabamento', 'distribuidor_geral'],
    aliases: ['argamassa ac2', 'ac ii 20kg', 'argamassa 20'],
    criticality: 'alta',
    minStock: 60,
    active: true
  },
  {
    sku: 'RIR-0003',
    name: 'Tubo PVC Esgoto 40mm',
    category: 'hidraulica',
    unit: 'barra',
    supplierTypes: ['hidraulica', 'distribuidor_geral'],
    aliases: ['cano esgoto 40', 'tubo esgoto 40', 'pvc esgoto 40', 'cano 40 esgoto'],
    criticality: 'alta',
    minStock: 25,
    active: true
  },
  {
    sku: 'RIR-0004',
    name: 'Tubo PVC Soldavel 25mm',
    category: 'hidraulica',
    unit: 'barra',
    supplierTypes: ['hidraulica', 'distribuidor_geral'],
    aliases: ['cano pvc 25', 'cano 25', 'tubo 25', 'pvc soldavel 25'],
    criticality: 'media',
    minStock: 20,
    active: true
  },
  {
    sku: 'RIR-0005',
    name: 'Cabo Flexivel 2,5mm 750V',
    category: 'eletrica',
    unit: 'rolo',
    supplierTypes: ['eletrica', 'distribuidor_geral'],
    aliases: ['fio 2.5', 'cabo 2.5', 'fio flex 2.5', 'cabo flexivel 2,5'],
    criticality: 'alta',
    minStock: 12,
    active: true
  },
  {
    sku: 'RIR-0006',
    name: 'Disjuntor DIN 20A',
    category: 'eletrica',
    unit: 'un',
    supplierTypes: ['eletrica', 'distribuidor_geral'],
    aliases: ['disjuntor 20', 'disjuntor 20a', 'din 20a'],
    criticality: 'media',
    minStock: 18,
    active: true
  },
  {
    sku: 'RIR-0007',
    name: 'Tinta Acrilica Branco 18L',
    category: 'tintas',
    unit: 'lata',
    supplierTypes: ['tintas', 'acabamento', 'distribuidor_geral'],
    aliases: ['tinta branca 18l', 'tinta acrilica 18', 'branco 18 litros'],
    criticality: 'alta',
    minStock: 10,
    active: true
  },
  {
    sku: 'RIR-0008',
    name: 'Rolo de Pintura La 23cm',
    category: 'tintas',
    unit: 'un',
    supplierTypes: ['tintas', 'ferragens', 'distribuidor_geral'],
    aliases: ['rolo 23', 'rolo pintura 23', 'rolo la 23cm'],
    criticality: 'media',
    minStock: 24,
    active: true
  },
  {
    sku: 'RIR-0009',
    name: 'Parafuso Sextavado 5/16',
    category: 'ferragens',
    unit: 'cento',
    supplierTypes: ['ferragens', 'distribuidor_geral'],
    aliases: ['parafuso 5/16', 'sextavado 5/16', 'parafuso sextavado'],
    criticality: 'media',
    minStock: 8,
    active: true
  },
  {
    sku: 'RIR-0010',
    name: 'Luva de Seguranca Raspa',
    category: 'seguranca',
    unit: 'par',
    supplierTypes: ['seguranca', 'ferragens', 'distribuidor_geral'],
    aliases: ['luva raspa', 'luva seguranca', 'luva epi'],
    criticality: 'media',
    minStock: 30,
    active: true
  }
];

const suppliers = [
  {
    id: 'supplier-rir-001',
    name: 'Distribuidora Serra Norte',
    contact: 'Paula',
    phone: '5522999101001',
    whatsapp: '5522999101001',
    city: 'Nova Friburgo',
    supplierTypes: ['cimento', 'agregados', 'distribuidor_geral'],
    payment: 'boleto 21 dias',
    active: true,
    createdAt: nowIso(-220)
  },
  {
    id: 'supplier-rir-002',
    name: 'HidraVale Atacado',
    contact: 'Renato',
    phone: '5522999101002',
    whatsapp: '5522999101002',
    city: 'Cordeiro',
    supplierTypes: ['hidraulica', 'distribuidor_geral'],
    payment: 'pix ou boleto 14 dias',
    active: true,
    createdAt: nowIso(-210)
  },
  {
    id: 'supplier-rir-003',
    name: 'Eletro Rio Interior',
    contact: 'Bianca',
    phone: '5522999101003',
    whatsapp: '5522999101003',
    city: 'Teresopolis',
    supplierTypes: ['eletrica'],
    payment: 'boleto 28 dias',
    active: true,
    createdAt: nowIso(-200)
  },
  {
    id: 'supplier-rir-004',
    name: 'Tintas Forte Atacado',
    contact: 'Davi',
    phone: '5522999101004',
    whatsapp: '5522999101004',
    city: 'Cantagalo',
    supplierTypes: ['tintas', 'acabamento'],
    payment: 'boleto 21/35 dias',
    active: true,
    createdAt: nowIso(-190)
  },
  {
    id: 'supplier-rir-005',
    name: 'FerroMais Ferragens',
    contact: 'Nadia',
    phone: '5522999101005',
    whatsapp: '5522999101005',
    city: 'Carmo',
    supplierTypes: ['ferragens', 'seguranca', 'distribuidor_geral'],
    payment: 'pix com 3% desconto',
    active: true,
    createdAt: nowIso(-180)
  }
];

const users = [
  {
    id: 'user-rir-001',
    name: 'Carlos Rirrofer',
    role: 'proprietario',
    phone: '5522999000001',
    sector: 'direcao',
    canReportShortage: true,
    canApprovePurchase: true,
    canExecutePurchase: false,
    createdAt: nowIso(-180)
  },
  {
    id: 'user-rir-002',
    name: 'Marcos Compras',
    role: 'comprador',
    phone: '5522999000002',
    sector: 'compras',
    canReportShortage: true,
    canApprovePurchase: false,
    canExecutePurchase: true,
    createdAt: nowIso(-170)
  },
  {
    id: 'user-rir-003',
    name: 'Rita Deposito',
    role: 'gerente_deposito',
    phone: '5522999000003',
    sector: 'deposito',
    canReportShortage: true,
    canApprovePurchase: false,
    canExecutePurchase: false,
    createdAt: nowIso(-160)
  },
  {
    id: 'user-rir-004',
    name: 'Joao Balcao',
    role: 'balconista',
    phone: '5522999000004',
    sector: 'balcao',
    canReportShortage: true,
    canApprovePurchase: false,
    canExecutePurchase: false,
    createdAt: nowIso(-150)
  },
  {
    id: 'user-rir-005',
    name: 'Ana Caixa',
    role: 'caixa',
    phone: '5522999000005',
    sector: 'caixa',
    canReportShortage: true,
    canApprovePurchase: false,
    canExecutePurchase: false,
    createdAt: nowIso(-140)
  }
];

const shortages = [
  {
    id: 'shortage-rir-001',
    item: 'Cimento CP-II 50kg',
    category: 'cimento',
    needed: 120,
    available: 32,
    unit: 'saco',
    priority: 'alta',
    notes: 'Giro alto no balcao e entrega programada para obra.',
    status: 'validated',
    reportedBy: 'Rita Deposito',
    source: 'whatsapp',
    createdAt: nowIso(-95)
  },
  {
    id: 'shortage-rir-002',
    item: 'Tubo PVC Esgoto 40mm',
    category: 'hidraulica',
    needed: 40,
    available: 8,
    unit: 'barra',
    priority: 'alta',
    notes: 'Cliente pediu separacao para obra rural.',
    status: 'validated',
    reportedBy: 'Joao Balcao',
    source: 'whatsapp',
    createdAt: nowIso(-80)
  },
  {
    id: 'shortage-rir-003',
    item: 'Tinta Acrilica Branco 18L',
    category: 'tintas',
    needed: 18,
    available: 4,
    unit: 'lata',
    priority: 'media',
    notes: 'Reposicao para fim de semana.',
    status: 'validated',
    reportedBy: 'Joao Balcao',
    source: 'whatsapp',
    createdAt: nowIso(-70)
  },
  {
    id: 'shortage-rir-004',
    item: 'Cabo Flexivel 2,5mm 750V',
    category: 'eletrica',
    needed: 15,
    available: 3,
    unit: 'rolo',
    priority: 'media',
    notes: 'Entrada frequente em orcamentos de eletrica.',
    status: 'validated',
    reportedBy: 'Rita Deposito',
    source: 'whatsapp',
    createdAt: nowIso(-65)
  }
];

const quotes = [
  {
    id: 'quote-rir-001',
    supplier: 'Distribuidora Serra Norte',
    item: 'Cimento CP-II 50kg',
    unitPrice: 34.9,
    quantity: 100,
    leadDays: 2,
    payment: 'boleto 21 dias',
    source: 'whatsapp',
    createdAt: nowIso(-45)
  },
  {
    id: 'quote-rir-002',
    supplier: 'FerroMais Ferragens',
    item: 'Cimento CP-II 50kg',
    unitPrice: 35.8,
    quantity: 80,
    leadDays: 1,
    payment: 'pix com 3% desconto',
    source: 'whatsapp',
    createdAt: nowIso(-40)
  },
  {
    id: 'quote-rir-003',
    supplier: 'HidraVale Atacado',
    item: 'Tubo PVC Esgoto 40mm',
    unitPrice: 17.4,
    quantity: 50,
    leadDays: 3,
    payment: 'boleto 14 dias',
    source: 'whatsapp',
    createdAt: nowIso(-35)
  },
  {
    id: 'quote-rir-004',
    supplier: 'FerroMais Ferragens',
    item: 'Tubo PVC Esgoto 40mm',
    unitPrice: 18.2,
    quantity: 30,
    leadDays: 1,
    payment: 'pix com 3% desconto',
    source: 'whatsapp',
    createdAt: nowIso(-34)
  },
  {
    id: 'quote-rir-005',
    supplier: 'Tintas Forte Atacado',
    item: 'Tinta Acrilica Branco 18L',
    unitPrice: 189.9,
    quantity: 20,
    leadDays: 2,
    payment: 'boleto 21/35 dias',
    source: 'whatsapp',
    createdAt: nowIso(-30)
  }
];

const materialSupplierRules = [
  { materialCategory: 'cimento', allowedSupplierTypes: ['cimento', 'distribuidor_geral'] },
  { materialCategory: 'hidraulica', allowedSupplierTypes: ['hidraulica', 'distribuidor_geral'] },
  { materialCategory: 'eletrica', allowedSupplierTypes: ['eletrica', 'distribuidor_geral'] },
  { materialCategory: 'tintas', allowedSupplierTypes: ['tintas', 'acabamento', 'distribuidor_geral'] },
  { materialCategory: 'ferragens', allowedSupplierTypes: ['ferragens', 'distribuidor_geral'] },
  { materialCategory: 'seguranca', allowedSupplierTypes: ['seguranca', 'ferragens', 'distribuidor_geral'] }
];

function buildInitialMessages() {
  return [
    {
      id: 'message-rir-001',
      channel: 'whatsapp',
      provider: 'mock',
      direction: 'inbound',
      fromName: 'Rita Deposito',
      fromPhone: '5522999000003',
      role: 'gerente_deposito',
      text: 'Falta cimento CP-II 50kg. Precisa 120, tem 32 no deposito.',
      relatedEntityType: 'shortage',
      relatedEntityId: 'shortage-rir-001',
      readState: 'blue_ticks_only',
      createdAt: nowIso(-96)
    },
    {
      id: 'message-rir-002',
      channel: 'whatsapp',
      provider: 'mock',
      direction: 'inbound',
      fromName: 'Joao Balcao',
      fromPhone: '5522999000004',
      role: 'balconista',
      text: 'Cano esgoto 40 esta acabando. Cliente pediu 40 barras, tem 8.',
      relatedEntityType: 'shortage',
      relatedEntityId: 'shortage-rir-002',
      readState: 'blue_ticks_only',
      createdAt: nowIso(-81)
    }
  ];
}

function seedRirroferDemo() {
  const config = getConfig();
  config.companyName = 'RIRROFER Materiais de Construcao';
  config.permissions.purchaseMode = 'approval_required';
  config.permissions.allowAutoPurchase = false;
  config.permissions.requireOwnerApproval = true;
  config.permissions.allowDatabaseAccess = false;
  config.permissions.allowFinancialAccess = false;
  saveConfig(config);

  saveClientProfile(clientProfile);
  saveSupplierTypes(supplierTypes);
  saveMaterialSupplierRules(materialSupplierRules);
  saveMaterials(materials);
  saveUsers(users);
  saveSuppliers(suppliers);
  saveShortages(shortages);
  saveQuotes(quotes);
  saveQuoteQueue([]);
  saveQuoteBatches([]);
  saveMessages(buildInitialMessages());
  savePurchaseRequests([]);

  for (const shortage of shortages) {
    const { enqueueShortageForQuote } = require('./quote-batches.cjs');
    enqueueShortageForQuote(shortage);
  }

  const batch = buildQuoteBatch({ mode: 'demo', notes: 'Demo Rirrofer: cotacao consolidada por fornecedor.' });
  const sentBatch = sendQuoteBatch(batch.id);
  const purchaseRequest = buildPurchaseRequest(shortages[0]);
  const outcome = purchaseRequest ? routePurchaseDecision(purchaseRequest) : null;

  return {
    ok: true,
    companyName: config.companyName,
    users: users.length,
    materials: materials.length,
    suppliers: suppliers.length,
    shortages: shortages.length,
    quotes: quotes.length,
    quoteBatchId: sentBatch.id,
    purchaseRequestId: purchaseRequest ? purchaseRequest.id : null,
    purchaseOutcome: outcome
  };
}

module.exports = {
  seedRirroferDemo
};
