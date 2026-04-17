'use strict';

const fs = require('fs');
const path = require('path');
const {
  listMaterials,
  saveMaterials,
  listSupplierTypes,
  saveSupplierTypes,
  listMaterialSupplierRules,
  saveMaterialSupplierRules,
  listSuppliers
} = require('./storage.cjs');
const { normalizeText } = require('./scoring.cjs');

const DEFAULT_SUPPLIER_TYPES = [
  { key: 'cimento', name: 'Cimento' },
  { key: 'agregados', name: 'Agregados' },
  { key: 'acabamento', name: 'Acabamento' },
  { key: 'hidraulica', name: 'Hidraulica' },
  { key: 'eletrica', name: 'Eletrica' },
  { key: 'ferragens', name: 'Ferragens' },
  { key: 'madeira', name: 'Madeira' },
  { key: 'distribuidor_geral', name: 'Distribuidor Geral' }
];

const DEFAULT_MATERIALS = [
  {
    sku: 'MAT-0001',
    name: 'Cimento CP-II 50kg',
    category: 'cimento',
    unit: 'saco',
    supplierTypes: ['cimento', 'distribuidor_geral'],
    allowedBrands: ['Votoran', 'CSN'],
    preferredBrands: ['Votoran'],
    aliases: ['cimento 50kg', 'cimento cp2', 'cp-ii 50kg'],
    criticality: 'alta'
  },
  {
    sku: 'MAT-0002',
    name: 'Brita 1',
    category: 'agregados',
    unit: 'm3',
    supplierTypes: ['agregados', 'distribuidor_geral'],
    allowedBrands: [],
    preferredBrands: [],
    aliases: ['brita', 'brita numero 1', 'brita n1'],
    criticality: 'alta'
  },
  {
    sku: 'MAT-0003',
    name: 'Areia Media',
    category: 'agregados',
    unit: 'm3',
    supplierTypes: ['agregados', 'distribuidor_geral'],
    allowedBrands: [],
    preferredBrands: [],
    aliases: ['areia', 'areia media lavada'],
    criticality: 'alta'
  },
  {
    sku: 'MAT-0004',
    name: 'Cal Hidratada',
    category: 'acabamento',
    unit: 'saco',
    supplierTypes: ['acabamento', 'cimento', 'distribuidor_geral'],
    allowedBrands: [],
    preferredBrands: [],
    aliases: ['cal', 'cal saco', 'cal hidratada saco'],
    criticality: 'media'
  },
  {
    sku: 'MAT-0005',
    name: 'Tubo PVC Soldavel 25mm',
    category: 'hidraulica',
    unit: 'barra',
    supplierTypes: ['hidraulica', 'distribuidor_geral'],
    allowedBrands: [],
    preferredBrands: [],
    aliases: ['tubo pvc soldavel 25mm', 'tubo 25', 'tubo pvc 25', 'pvc soldavel 25', 'cano 25', 'cano pvc 25'],
    equivalents: [],
    criticality: 'alta',
    minStock: 20
  },
  {
    sku: 'MAT-0006',
    name: 'Tubo PVC Esgoto 40mm',
    category: 'hidraulica',
    unit: 'barra',
    supplierTypes: ['hidraulica', 'distribuidor_geral'],
    allowedBrands: [],
    preferredBrands: [],
    aliases: ['cano esgoto 40', 'tubo esgoto 40', 'pvc esgoto 40', 'tubo pvc esgoto 40mm', 'cano 40 esgoto'],
    equivalents: [],
    criticality: 'alta',
    minStock: 20
  },
  {
    sku: 'MAT-0007',
    name: 'Tubo PVC Soldavel 40mm',
    category: 'hidraulica',
    unit: 'barra',
    supplierTypes: ['hidraulica', 'distribuidor_geral'],
    allowedBrands: [],
    preferredBrands: [],
    aliases: ['cano soldavel 40', 'tubo soldavel 40', 'pvc soldavel 40', 'tubo pvc soldavel 40mm', 'cano 40 soldavel'],
    equivalents: [],
    criticality: 'media',
    minStock: 10
  }
];

const DEFAULT_MATERIAL_SUPPLIER_RULES = [
  {
    materialCategory: 'cimento',
    allowedSupplierTypes: ['cimento', 'distribuidor_geral']
  },
  {
    materialCategory: 'agregados',
    allowedSupplierTypes: ['agregados', 'distribuidor_geral']
  },
  {
    materialCategory: 'acabamento',
    allowedSupplierTypes: ['acabamento', 'distribuidor_geral', 'cimento']
  }
];

function seedMaterialKnowledge() {
  saveSupplierTypes(DEFAULT_SUPPLIER_TYPES);
  saveMaterials(DEFAULT_MATERIALS);
  saveMaterialSupplierRules(DEFAULT_MATERIAL_SUPPLIER_RULES);
  return {
    supplierTypes: DEFAULT_SUPPLIER_TYPES,
    materials: DEFAULT_MATERIALS,
    rules: DEFAULT_MATERIAL_SUPPLIER_RULES
  };
}

function ensureMaterialKnowledge() {
  const materials = listMaterials();
  const supplierTypes = listSupplierTypes();
  const rules = listMaterialSupplierRules();
  if (materials.length && supplierTypes.length && rules.length) {
    return { materials, supplierTypes, rules };
  }
  return seedMaterialKnowledge();
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map(item => normalizeText(item))
    .filter(Boolean);
}

function splitCsvLine(line) {
  const columns = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      columns.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  columns.push(current.trim());
  return columns;
}

function parseCsv(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map(header => normalizeText(header));
  return lines.slice(1).map(line => {
    const columns = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = columns[index] || '';
    });
    return row;
  });
}

function materialInputFromRow(row) {
  return {
    sku: row.sku,
    name: row.name || row.nome,
    category: row.category || row.categoria,
    unit: row.unit || row.unidade,
    supplierTypes: row.supplier_types || row.supplierTypes || row.tipos_fornecedor,
    allowedBrands: row.allowed_brands || row.allowedBrands || row.marcas_aceitas,
    preferredBrands: row.preferred_brands || row.preferredBrands || row.marcas_preferidas,
    aliases: row.aliases || row.apelidos,
    equivalents: row.equivalents || row.equivalentes,
    criticality: row.criticality || row.criticidade,
    minStock: row.min_stock || row.minStock || row.estoque_minimo,
    notes: row.notes || row.observacoes
  };
}

function tokenize(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(token => token.length > 1);
}

function extractMeasurements(value) {
  const normalized = normalizeText(value);
  const matches = normalized.match(/\d+(?:[,.]\d+)?/g) || [];
  return matches.map(match => match.replace(',', '.'));
}

function addIfPresent(set, value) {
  const normalized = normalizeText(value);
  if (normalized) {
    set.add(normalized);
  }
}

function generateAliasesForMaterialName(name) {
  const normalized = normalizeText(name)
    .replace(/\bmm\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = tokenize(name);
  const measurements = extractMeasurements(name);
  const aliases = new Set();

  addIfPresent(aliases, name);
  addIfPresent(aliases, normalized);

  for (const measurement of measurements) {
    const size = measurement.replace(/\.0$/, '');

    if (tokens.includes('tubo') || tokens.includes('cano') || tokens.includes('pvc')) {
      if (tokens.includes('esgoto')) {
        addIfPresent(aliases, `tubo esgoto ${size}`);
        addIfPresent(aliases, `cano esgoto ${size}`);
        addIfPresent(aliases, `pvc esgoto ${size}`);
        addIfPresent(aliases, `tubo pvc esgoto ${size}`);
        addIfPresent(aliases, `cano ${size} esgoto`);
      }

      if (tokens.includes('soldavel') || tokens.includes('soldável')) {
        addIfPresent(aliases, `tubo soldavel ${size}`);
        addIfPresent(aliases, `cano soldavel ${size}`);
        addIfPresent(aliases, `pvc soldavel ${size}`);
        addIfPresent(aliases, `tubo pvc soldavel ${size}`);
        addIfPresent(aliases, `cano ${size} soldavel`);
      }

      addIfPresent(aliases, `tubo ${size}`);
      addIfPresent(aliases, `cano ${size}`);
      addIfPresent(aliases, `tubo pvc ${size}`);
      addIfPresent(aliases, `cano pvc ${size}`);
    }

    if (tokens.includes('fio') || tokens.includes('cabo')) {
      addIfPresent(aliases, `fio ${size}`);
      addIfPresent(aliases, `cabo ${size}`);
      addIfPresent(aliases, `fio flexivel ${size}`);
      addIfPresent(aliases, `cabo flexivel ${size}`);
      addIfPresent(aliases, `fio flex ${size}`);
      addIfPresent(aliases, `cabo flex ${size}`);
    }

    if (tokens.includes('cimento')) {
      addIfPresent(aliases, `cimento ${size}kg`);
      addIfPresent(aliases, `cimento ${size}`);
    }

    if (tokens.includes('registro')) {
      addIfPresent(aliases, `registro ${size}`);
      addIfPresent(aliases, `registro esfera ${size}`);
    }
  }

  return [...aliases];
}

function generateNextSku(materials) {
  const maxNumber = materials.reduce((max, material) => {
    const match = String(material.sku || '').match(/^MAT-(\d+)$/);
    if (!match) {
      return max;
    }
    return Math.max(max, Number(match[1]));
  }, 0);

  return `MAT-${String(maxNumber + 1).padStart(4, '0')}`;
}

function addMaterial(input) {
  const materials = listMaterials();
  const name = String(input.name || '').trim();

  if (!name) {
    throw new Error('Nome do material e obrigatorio.');
  }

  const existing = materials.find(material => normalizeText(material.name) === normalizeText(name));
  if (existing) {
    throw new Error(`Material ja cadastrado: ${existing.name}`);
  }

  const autoAliases = generateAliasesForMaterialName(name);
  const material = {
    sku: input.sku || generateNextSku(materials),
    name,
    category: normalizeText(input.category || 'geral'),
    unit: normalizeText(input.unit || 'un'),
    supplierTypes: splitList(input.supplierTypes),
    allowedBrands: splitList(input.allowedBrands),
    preferredBrands: splitList(input.preferredBrands),
    aliases: [...new Set([...autoAliases, ...splitList(input.aliases)])],
    equivalents: splitList(input.equivalents),
    criticality: normalizeText(input.criticality || 'media'),
    minStock: Number(input.minStock || 0),
    notes: input.notes || '',
    active: input.active !== false,
    createdAt: new Date().toISOString()
  };

  materials.push(material);
  saveMaterials(materials);
  return material;
}

function upsertMaterial(input) {
  const materials = listMaterials();
  const name = String(input.name || '').trim();

  if (!name) {
    throw new Error('Nome do material e obrigatorio.');
  }

  const existingIndex = materials.findIndex(material =>
    normalizeText(material.sku) === normalizeText(input.sku) ||
    normalizeText(material.name) === normalizeText(name)
  );

  if (existingIndex < 0) {
    return { action: 'created', material: addMaterial(input) };
  }

  const existing = materials[existingIndex];
  const merged = {
    ...existing,
    sku: input.sku || existing.sku,
    name,
    category: normalizeText(input.category || existing.category || 'geral'),
    unit: normalizeText(input.unit || existing.unit || 'un'),
    supplierTypes: splitList(input.supplierTypes || existing.supplierTypes?.join(',')),
    allowedBrands: splitList(input.allowedBrands || existing.allowedBrands?.join(',')),
    preferredBrands: splitList(input.preferredBrands || existing.preferredBrands?.join(',')),
    aliases: [...new Set([
      ...(existing.aliases || []).map(normalizeText),
      ...generateAliasesForMaterialName(name),
      ...splitList(input.aliases),
      normalizeText(name)
    ])],
    equivalents: [...new Set([
      ...(existing.equivalents || []).map(normalizeText),
      ...splitList(input.equivalents)
    ])],
    criticality: normalizeText(input.criticality || existing.criticality || 'media'),
    minStock: Number(input.minStock || existing.minStock || 0),
    notes: input.notes || existing.notes || '',
    active: input.active !== false,
    updatedAt: new Date().toISOString()
  };

  materials[existingIndex] = merged;
  saveMaterials(materials);
  return { action: 'updated', material: merged };
}

function importMaterialsFromFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const extension = path.extname(absolutePath).toLowerCase();
  const rows = extension === '.json'
    ? JSON.parse(raw)
    : parseCsv(raw);

  if (!Array.isArray(rows)) {
    throw new Error('Arquivo de materiais deve conter uma lista.');
  }

  const results = [];
  for (const row of rows) {
    const input = materialInputFromRow(row);
    results.push(upsertMaterial(input));
  }

  return {
    filePath: absolutePath,
    imported: results.length,
    created: results.filter(result => result.action === 'created').length,
    updated: results.filter(result => result.action === 'updated').length,
    results
  };
}

function findMaterialIndex(materials, identifier) {
  const normalized = normalizeText(identifier);
  return materials.findIndex(material =>
    normalizeText(material.sku) === normalized ||
    normalizeText(material.name) === normalized ||
    (material.aliases || []).some(alias => normalizeText(alias) === normalized)
  );
}

function addMaterialAliases(identifier, aliases) {
  const materials = listMaterials();
  const index = findMaterialIndex(materials, identifier);
  if (index < 0) {
    throw new Error(`Material nao encontrado: ${identifier}`);
  }

  const current = new Set((materials[index].aliases || []).map(normalizeText));
  for (const alias of splitList(aliases)) {
    current.add(alias);
  }

  materials[index].aliases = [...current];
  materials[index].updatedAt = new Date().toISOString();
  saveMaterials(materials);
  return materials[index];
}

function setMaterialSupplierTypes(identifier, supplierTypes) {
  const materials = listMaterials();
  const index = findMaterialIndex(materials, identifier);
  if (index < 0) {
    throw new Error(`Material nao encontrado: ${identifier}`);
  }

  materials[index].supplierTypes = splitList(supplierTypes);
  materials[index].updatedAt = new Date().toISOString();
  saveMaterials(materials);
  return materials[index];
}

function matchMaterialByName(name) {
  return resolveMaterial(name).bestMatch;
}

function resolveMaterial(name) {
  const materials = listMaterials();
  const normalizedName = normalizeText(name);
  const inputTokens = new Set(tokenize(name));
  const inputMeasurements = new Set(extractMeasurements(name));

  const candidates = materials.map(material => {
    const names = [
      material.name,
      ...(material.aliases || []),
      ...(material.equivalents || [])
    ];

    let score = 0;
    let reason = 'token_match';

    if (names.some(candidate => normalizeText(candidate) === normalizedName)) {
      score += 100;
      reason = 'exact_alias';
    }

    const materialTokens = new Set(names.flatMap(tokenize));
    for (const token of inputTokens) {
      if (materialTokens.has(token)) {
        score += 8;
      }
    }

    const materialMeasurements = new Set(names.flatMap(extractMeasurements));
    for (const measurement of inputMeasurements) {
      if (materialMeasurements.has(measurement)) {
        score += 20;
      }
    }

    if (normalizeText(material.category) && inputTokens.has(normalizeText(material.category))) {
      score += 10;
    }

    return {
      material,
      score,
      reason
    };
  }).filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const top = candidates[0] || null;
  const second = candidates[1] || null;
  const ambiguous = Boolean(top && second && top.score - second.score < 15);
  const confident = Boolean(top && top.score >= 35 && !ambiguous);

  return {
    query: name,
    bestMatch: confident ? top.material : null,
    status: !top ? 'not_found' : ambiguous ? 'ambiguous' : confident ? 'matched' : 'low_confidence',
    confidence: top ? top.score : 0,
    reason: top ? top.reason : 'no_candidate',
    candidates: candidates.slice(0, 5).map(candidate => ({
      sku: candidate.material.sku,
      name: candidate.material.name,
      category: candidate.material.category,
      score: candidate.score,
      reason: candidate.reason
    }))
  };
}

function inferSupplierTypesForMaterial(material) {
  const rules = listMaterialSupplierRules();
  const directTypes = new Set(material.supplierTypes || []);

  for (const rule of rules) {
    if (normalizeText(rule.materialCategory) === normalizeText(material.category)) {
      for (const type of rule.allowedSupplierTypes || []) {
        directTypes.add(type);
      }
    }
  }

  return [...directTypes];
}

function filterSuppliersForMaterial(materialName) {
  const resolution = resolveMaterial(materialName);
  const material = resolution.bestMatch;
  if (!material) {
    return {
      material: null,
      suppliers: resolution.status === 'not_found'
        ? listSuppliers().filter(supplier => supplier.active !== false)
        : [],
      reason: `${resolution.status}_fallback`,
      resolution
    };
  }

  const acceptedTypes = new Set(inferSupplierTypesForMaterial(material).map(normalizeText));
  const suppliers = listSuppliers().filter(supplier => {
    if (supplier.active === false) {
      return false;
    }

    const supplierTypes = (supplier.supplierTypes || []).map(normalizeText);
    return supplierTypes.some(type => acceptedTypes.has(type));
  });

  return {
    material,
    suppliers,
    reason: 'matched_material',
    resolution
  };
}

module.exports = {
  DEFAULT_SUPPLIER_TYPES,
  DEFAULT_MATERIALS,
  DEFAULT_MATERIAL_SUPPLIER_RULES,
  seedMaterialKnowledge,
  ensureMaterialKnowledge,
  addMaterial,
  addMaterialAliases,
  setMaterialSupplierTypes,
  importMaterialsFromFile,
  generateAliasesForMaterialName,
  matchMaterialByName,
  resolveMaterial,
  inferSupplierTypesForMaterial,
  filterSuppliersForMaterial
};
