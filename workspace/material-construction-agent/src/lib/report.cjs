'use strict';

const path = require('path');
const {
  getConfig,
  listShortages,
  listSuppliers,
  listQuotes,
  listMessages,
  listPurchaseRequests,
  writeReport
} = require('./storage.cjs');
const { normalizeText, scoreQuote, groupQuotesByItem } = require('./scoring.cjs');

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
}

function formatDate(value) {
  return new Date(value).toLocaleString('pt-BR', { hour12: false });
}

function formatLocalDateKey(value) {
  return new Intl.DateTimeFormat('sv-SE').format(new Date(value));
}

function buildDailyReport() {
  const config = getConfig();
  const shortages = listShortages();
  const suppliers = listSuppliers();
  const quotes = listQuotes();
  const messages = listMessages();
  const purchaseRequests = listPurchaseRequests();
  const quotesByItem = groupQuotesByItem(quotes);

  const now = new Date();
  const reportLines = [];

  reportLines.push('# Relatorio Diario - Material Construction Agent');
  reportLines.push('');
  reportLines.push(`Gerado em: ${formatDate(now.toISOString())}`);
  reportLines.push(`Empresa: ${config.companyName || 'Loja sem nome'}`);
  reportLines.push(`Modo de compra: ${config.permissions.purchaseMode}`);
  reportLines.push(`Aprovacao do dono: ${config.permissions.requireOwnerApproval ? 'sim' : 'nao'}`);
  reportLines.push(`Acesso a banco de dados: ${config.permissions.allowDatabaseAccess ? 'liberado' : 'bloqueado'}`);
  reportLines.push(`Acesso financeiro: ${config.permissions.allowFinancialAccess ? 'liberado' : 'bloqueado'}`);
  reportLines.push(`Faltas abertas: ${shortages.filter(item => item.status !== 'resolved').length}`);
  reportLines.push(`Fornecedores cadastrados: ${suppliers.length}`);
  reportLines.push(`Cotacoes registradas: ${quotes.length}`);
  reportLines.push(`Mensagens WhatsApp registradas: ${messages.length}`);
  reportLines.push(`Solicitacoes de compra: ${purchaseRequests.length}`);
  reportLines.push('');

  if (!shortages.length) {
    reportLines.push('Nenhuma falta registrada no momento.');
  } else {
    reportLines.push('## Faltas e recomendacoes');
    reportLines.push('');

    for (const shortage of shortages) {
      const itemKey = normalizeText(shortage.item);
      const matchingQuotes = quotesByItem.get(itemKey) || [];
      const rankedQuotes = matchingQuotes
        .map(quote => ({ ...quote, score: scoreQuote(quote, shortage) }))
        .sort((left, right) => right.score - left.score);

      const missingQuantity = Math.max(Number(shortage.needed || 0) - Number(shortage.available || 0), 0);

      reportLines.push(`### ${shortage.item}`);
      reportLines.push(`- categoria: ${shortage.category || 'nao informada'}`);
      reportLines.push(`- prioridade: ${shortage.priority || 'media'}`);
      reportLines.push(`- estoque atual: ${shortage.available || 0} ${shortage.unit || 'un'}`);
      reportLines.push(`- necessidade total: ${shortage.needed || 0} ${shortage.unit || 'un'}`);
      reportLines.push(`- falta estimada: ${missingQuantity} ${shortage.unit || 'un'}`);
      reportLines.push(`- observacao: ${shortage.notes || 'sem observacoes'}`);
      reportLines.push(`- reportado por: ${shortage.reportedBy || 'nao informado'}`);
      reportLines.push(`- origem: ${shortage.source || 'manual'}`);
      reportLines.push('');

      if (!rankedQuotes.length) {
        reportLines.push('Sem cotacoes registradas para este item.');
        reportLines.push('');
        continue;
      }

      const best = rankedQuotes[0];
      reportLines.push(`Recomendacao: comprar com ${best.supplier} por ${formatCurrency(best.unitPrice)} / ${shortage.unit || 'un'} com prazo de ${best.leadDays} dia(s).`);
      reportLines.push('');
      reportLines.push('| Fornecedor | Preco unitario | Quantidade | Prazo | Pagamento | Score |');
      reportLines.push('|---|---:|---:|---:|---|---:|');

      for (const quote of rankedQuotes) {
        reportLines.push(`| ${quote.supplier} | ${formatCurrency(quote.unitPrice)} | ${quote.quantity || 0} | ${quote.leadDays || 0} | ${quote.payment || '-'} | ${quote.score.toFixed(2)} |`);
      }

      reportLines.push('');
    }
  }

  if (purchaseRequests.length) {
    reportLines.push('## Solicitacoes de compra');
    reportLines.push('');
    reportLines.push('| ID | Item | Melhor fornecedor | Status | Aprovado por |');
    reportLines.push('|---|---|---|---|---|');

    for (const request of purchaseRequests) {
      reportLines.push(`| ${request.id} | ${request.item} | ${request.bestSupplier} | ${request.status} | ${request.approvedBy || '-'} |`);
    }

    reportLines.push('');
  }

  const fileName = `daily-report-${formatLocalDateKey(now)}.md`;
  const reportPath = writeReport(fileName, `${reportLines.join('\n')}\n`);

  return {
    fileName,
    reportPath,
    markdown: `${reportLines.join('\n')}\n`,
    relativePath: path.relative(process.cwd(), reportPath)
  };
}

module.exports = {
  buildDailyReport
};
