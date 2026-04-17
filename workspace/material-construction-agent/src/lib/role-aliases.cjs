'use strict';

const { normalizeText } = require('./scoring.cjs');

const ROLE_ALIASES = {
  owner: 'proprietario',
  buyer: 'comprador',
  warehouse: 'gerente_deposito',
  clerk: 'balconista'
};

function canonicalRoleKey(role) {
  const normalized = normalizeText(role);
  return ROLE_ALIASES[normalized] || normalized;
}

module.exports = {
  canonicalRoleKey
};
