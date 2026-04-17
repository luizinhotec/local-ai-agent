'use strict';

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizePhone(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .trim();
}

function scoreQuote(quote, shortage) {
  const missingQuantity = Math.max(Number(shortage.needed || 0) - Number(shortage.available || 0), 0);
  const unitPrice = Number(quote.unitPrice || 0);
  const leadDays = Number(quote.leadDays || 0);
  const quantity = Number(quote.quantity || 0);

  // Score relativo: armazena os componentes brutos para normalização posterior.
  // Use rankQuotes() para comparar cotações entre si com score 0–100.
  // Este retorno bruto é mantido para compatibilidade com chamadas unitárias.
  let score = 0;

  // Penaliza prazo (peso maior para prioridade alta)
  const leadPenalty = normalizeText(shortage.priority) === 'alta' ? 5 : 3;
  score -= leadDays * leadPenalty;

  // Penaliza quantidade insuficiente
  if (quantity > 0 && quantity < missingQuantity) {
    score -= 25;
  }

  // Leve penalidade para pagamento à vista (menos flexibilidade de caixa)
  if (normalizeText(quote.payment).includes('avista')) {
    score -= 5;
  }

  // Armazena preço como campo separado para normalização relativa
  return { rawScore: Number(score.toFixed(2)), unitPrice };
}

/**
 * Rankeia um array de cotações para o mesmo item.
 * Retorna cada cotação com um campo `score` normalizado 0–100,
 * onde 100 = melhor opção (menor preço + menor prazo + quantidade suficiente).
 */
function rankQuotes(quotes, shortage) {
  if (!quotes.length) return [];

  const scored = quotes.map(quote => {
    const { rawScore, unitPrice } = scoreQuote(quote, shortage);
    return { ...quote, _rawScore: rawScore, _unitPrice: unitPrice };
  });

  const minPrice = Math.min(...scored.map(q => q._unitPrice));
  const maxPrice = Math.max(...scored.map(q => q._unitPrice));
  const priceRange = maxPrice - minPrice || 1;

  const withFinal = scored.map(q => {
    // Componente de preço: 0–70 pontos (menor preço = 70)
    const priceComponent = ((maxPrice - q._unitPrice) / priceRange) * 70;
    // Componente de outros fatores: rawScore (prazo, quantidade, pagamento)
    const otherComponent = q._rawScore;
    const score = Number((priceComponent + otherComponent).toFixed(2));
    const { _rawScore, _unitPrice, ...rest } = q;
    return { ...rest, score };
  });

  return withFinal.sort((a, b) => b.score - a.score);
}

function groupQuotesByItem(quotes) {
  const map = new Map();

  for (const quote of quotes) {
    const key = normalizeText(quote.item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(quote);
  }

  return map;
}

module.exports = {
  normalizeText,
  normalizePhone,
  scoreQuote,
  rankQuotes,
  groupQuotesByItem
};
