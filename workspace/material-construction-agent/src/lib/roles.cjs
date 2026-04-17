'use strict';

const { listRoles, saveRoles } = require('./storage.cjs');

const DEFAULT_ROLES = [
  {
    key: 'dev_responsavel',
    name: 'Dev Responsavel',
    area: 'tecnologia',
    description: 'Administra o agente, integra canais e cuida da arquitetura tecnica.',
    permissions: ['system_admin', 'manage_integrations', 'view_all', 'configure_roles', 'configure_permissions', 'view_audit']
  },
  {
    key: 'proprietario',
    name: 'Proprietario',
    area: 'diretoria',
    description: 'Define regras, aprova compras sensiveis e libera acessos maiores.',
    permissions: ['view_all', 'approve_purchase', 'approve_high_value_purchase', 'view_financial_summary', 'grant_sensitive_access']
  },
  {
    key: 'gerente_geral',
    name: 'Gerente Geral',
    area: 'gestao',
    description: 'Supervisiona a operacao inteira da loja e acompanha faltas criticas.',
    permissions: ['view_all', 'approve_purchase', 'manage_shortages', 'request_quotes', 'view_reports']
  },
  {
    key: 'gerente_comercial',
    name: 'Gerente Comercial',
    area: 'comercial',
    description: 'Acompanha demanda, giro de itens e impacto comercial das faltas.',
    permissions: ['view_sales_related_shortages', 'request_quotes', 'view_reports', 'suggest_priority']
  },
  {
    key: 'secretario',
    name: 'Secretario',
    area: 'administrativo',
    description: 'Apoia comunicacoes, cadastro e repasses operacionais.',
    permissions: ['register_messages', 'view_reports', 'update_contacts', 'create_followups']
  },
  {
    key: 'balconista',
    name: 'Balconista',
    area: 'vendas',
    description: 'Informa falta percebida no atendimento e consulta status das reposicoes.',
    permissions: ['report_shortage', 'view_own_shortages', 'check_restock_status']
  },
  {
    key: 'caixa',
    name: 'Caixa',
    area: 'financeiro_operacional',
    description: 'Acompanha divergencias simples ligadas a venda e reposicao, sem acesso financeiro sensivel.',
    permissions: ['report_shortage', 'view_basic_reports', 'flag_checkout_issues']
  },
  {
    key: 'gerente_entrega',
    name: 'Gerente da Entrega',
    area: 'logistica',
    description: 'Coordena entregas e sinaliza impacto logistico de compras e faltas.',
    permissions: ['view_delivery_related_shortages', 'view_purchase_eta', 'coordinate_delivery_queue']
  },
  {
    key: 'motorista_entrega',
    name: 'Motorista da Entrega',
    area: 'logistica',
    description: 'Recebe orientacoes operacionais e pode reportar ocorrencias de entrega.',
    permissions: ['view_assigned_delivery_updates', 'report_delivery_issue']
  },
  {
    key: 'ajudante_entrega',
    name: 'Ajudante da Entrega',
    area: 'logistica',
    description: 'Apoia a entrega e comunica problemas simples do campo.',
    permissions: ['report_delivery_issue', 'view_assigned_delivery_updates']
  },
  {
    key: 'gerente_deposito',
    name: 'Gerente do Deposito',
    area: 'estoque',
    description: 'Controla o estoque fisico, valida faltas e prioriza reposicoes.',
    permissions: ['report_shortage', 'validate_shortage', 'manage_shortages', 'request_quotes', 'view_inventory_reports']
  },
  {
    key: 'ajudante_deposito',
    name: 'Ajudante do Deposito',
    area: 'estoque',
    description: 'Reporta faltas, divergencias e apoio ao inventario.',
    permissions: ['report_shortage', 'view_own_shortages', 'report_inventory_issue']
  },
  {
    key: 'contador',
    name: 'Contador',
    area: 'contabilidade',
    description: 'Acompanha trilha documental e consistencia contabil das compras aprovadas.',
    permissions: ['view_purchase_records', 'view_reports', 'view_audit', 'export_accounting_data']
  },
  {
    key: 'comprador',
    name: 'Comprador',
    area: 'compras',
    description: 'Executa cotacoes, negocia com fornecedores e formaliza a compra aprovada.',
    permissions: ['request_quotes', 'compare_quotes', 'execute_purchase', 'view_purchase_records', 'contact_suppliers']
  },
  {
    key: 'fornecedor',
    name: 'Fornecedor',
    area: 'parceiro_externo',
    description: 'Parceiro externo que recebe pedido de cotacao, responde disponibilidade, preco e prazo.',
    permissions: ['receive_quote_request', 'send_quote', 'update_availability', 'inform_delivery_eta']
  },
  {
    key: 'financeiro',
    name: 'Financeiro',
    area: 'financeiro',
    description: 'Valida condicoes de pagamento e acompanha obrigacoes financeiras, sem liberar acesso bancario automatico por padrao.',
    permissions: ['view_payment_terms', 'view_purchase_records', 'approve_payment_schedule']
  },
  {
    key: 'auditor_interno',
    name: 'Auditor Interno',
    area: 'governanca',
    description: 'Revisa trilhas, aprovacoes e aderencia aos processos definidos.',
    permissions: ['view_audit', 'view_reports', 'view_purchase_records', 'review_permissions']
  }
];

function seedDefaultRoles() {
  saveRoles(DEFAULT_ROLES);
  return DEFAULT_ROLES;
}

function ensureDefaultRoles() {
  const roles = listRoles();
  if (roles.length) {
    return roles;
  }
  return seedDefaultRoles();
}

module.exports = {
  DEFAULT_ROLES,
  seedDefaultRoles,
  ensureDefaultRoles
};
