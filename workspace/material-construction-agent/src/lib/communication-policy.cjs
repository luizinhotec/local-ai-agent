'use strict';

const { getCommunicationPolicy, saveCommunicationPolicy } = require('./storage.cjs');
const { normalizeText } = require('./scoring.cjs');
const { canonicalRoleKey } = require('./role-aliases.cjs');

const DEFAULT_COMMUNICATION_POLICY = {
  inboundDefault: 'blue_ticks_only',
  silentIgnoreRules: [
    {
      roles: ['fornecedor'],
      intents: ['marketing', 'generic_followup'],
      reason: 'Fornecedor nao recebe resposta automatica para mensagens fora do fluxo.'
    }
  ],
  textReplyRules: [
    {
      roles: ['proprietario', 'gerente_geral'],
      intents: ['approval', 'critical_override', 'access_change'],
      template: 'Mensagem sensivel recebida e encaminhada para tratamento prioritario.'
    },
    {
      roles: ['comprador'],
      intents: ['purchase_confirmation'],
      template: 'Confirmacao recebida. O fluxo de compra sera atualizado.'
    }
  ]
};

function seedCommunicationPolicy() {
  saveCommunicationPolicy(DEFAULT_COMMUNICATION_POLICY);
  return DEFAULT_COMMUNICATION_POLICY;
}

function ensureCommunicationPolicy() {
  const policy = getCommunicationPolicy();
  if (policy && Object.keys(policy).length) {
    return policy;
  }
  return seedCommunicationPolicy();
}

function classifyIntent(text) {
  const normalized = normalizeText(text);

  if (normalized.includes('aprovo') || normalized.includes('aprovado') || normalized.includes('autoriza')) {
    return 'approval';
  }
  if (normalized.includes('confirmo compra') || normalized.includes('compra confirmada')) {
    return 'purchase_confirmation';
  }
  if (normalized.includes('acesso') || normalized.includes('libera acesso')) {
    return 'access_change';
  }
  if (normalized.includes('urgente') || normalized.includes('critico') || normalized.includes('crítico')) {
    return 'critical_override';
  }
  if (normalized.includes('promo') || normalized.includes('catalogo') || normalized.includes('catálogo')) {
    return 'marketing';
  }
  if (normalized.includes('oi') || normalized.includes('bom dia') || normalized.includes('boa tarde')) {
    return 'generic_followup';
  }

  return 'operational';
}

function includesRole(ruleRoles, role) {
  const canonicalRole = canonicalRoleKey(role);
  return (ruleRoles || []).map(canonicalRoleKey).includes(canonicalRole);
}

function decideInboundBehavior({ role, text }) {
  const policy = ensureCommunicationPolicy();
  const intent = classifyIntent(text);

  const silentRule = (policy.silentIgnoreRules || []).find(rule =>
    includesRole(rule.roles, role) && (rule.intents || []).includes(intent)
  );
  if (silentRule) {
    return {
      mode: 'silent_ignore',
      intent,
      reason: silentRule.reason || 'silent_ignore_rule'
    };
  }

  const textReplyRule = (policy.textReplyRules || []).find(rule =>
    includesRole(rule.roles, role) && (rule.intents || []).includes(intent)
  );
  if (textReplyRule) {
    return {
      mode: 'text_reply',
      intent,
      replyText: textReplyRule.template
    };
  }

  return {
    mode: policy.inboundDefault || 'blue_ticks_only',
    intent,
    reason: 'default_policy'
  };
}

module.exports = {
  DEFAULT_COMMUNICATION_POLICY,
  seedCommunicationPolicy,
  ensureCommunicationPolicy,
  classifyIntent,
  decideInboundBehavior
};
