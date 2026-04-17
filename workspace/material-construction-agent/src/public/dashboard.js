let snapshot = null;

const $ = selector => document.querySelector(selector);

function money(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || 'Erro inesperado.');
  }
  return body;
}

function renderMaterials(data) {
  $('#materialsCount').textContent = `${data.materials.length} itens`;
  $('#materialsTable').innerHTML = data.materials.map(material => `
    <tr>
      <td>${material.sku || '-'}</td>
      <td><strong>${material.name}</strong><br><small>${material.criticality || 'media'} | min ${material.minStock || 0}</small></td>
      <td>${material.category || '-'}</td>
      <td>${material.unit || '-'}</td>
      <td>${(material.supplierTypes || []).map(type => `<span class="tag">${type}</span>`).join('')}</td>
      <td>${(material.aliases || []).slice(0, 8).join(', ')}</td>
    </tr>
  `).join('');
}

function renderClientProfile(data) {
  const profile = data.clientProfile || {};
  $('#clientMaterialFocus').innerHTML = (profile.materialFocus || [])
    .map(item => `<span class="tag">${item}</span>`)
    .join('');
  $('#clientModules').innerHTML = (profile.priorityModules || []).map(module => `
    <div class="module-card">
      <div>
        <strong>${module.name}</strong>
        <span class="tag">${module.status}</span>
      </div>
      <p>${module.description}</p>
    </div>
  `).join('');

  $('#trustRoadmap').innerHTML = (profile.trustRoadmap || []).map(step => `
    <div class="trust-step">
      <span>${step.phase}</span>
      <strong>${step.title}</strong>
      <p>${step.description}</p>
    </div>
  `).join('');
}

function renderFlowFunnel(data) {
  const shortages = data.shortages || [];
  const quoteQueue = data.quoteQueue || [];
  const batches = data.quoteBatches || [];
  const quotes = data.quotes || [];
  const requests = data.purchaseRequests || [];
  const stages = [
    ['Faltas recebidas', shortages.length],
    ['Validadas', shortages.filter(item => item.status === 'validated').length],
    ['Na fila', quoteQueue.filter(item => item.status === 'ready_for_batch').length],
    ['Lotes enviados', batches.filter(batch => batch.status === 'sent').length],
    ['Cotacoes recebidas', quotes.length],
    ['Aguardando aprovacao', requests.filter(request => request.status === 'pending_approval').length]
  ];

  const html = stages.map(([label, value], index) => `
    <div class="funnel-step">
      <span>${index + 1}</span>
      <strong>${value}</strong>
      <small>${label}</small>
    </div>
  `).join('');

  $('#flowFunnel').innerHTML = html;
  $('#flowFunnelPurchases').innerHTML = html;
}

function renderUsers(data) {
  $('#usersCount').textContent = `${data.users.length} funcionarios`;
  $('#usersList').innerHTML = data.users.length ? data.users.map(user => `
    <div class="supplier">
      <strong>${user.name}</strong>
      <div>${user.phone || '-'} | setor: ${user.sector || '-'}</div>
      <div>
        <span class="tag">${user.role || 'sem cargo'}</span>
        ${user.canReportShortage ? '<span class="tag">informa falta</span>' : ''}
        ${user.canApprovePurchase ? '<span class="tag">aprova compra</span>' : ''}
        ${user.canExecutePurchase ? '<span class="tag">executa compra</span>' : ''}
      </div>
    </div>
  `).join('') : '<p>Nenhum funcionario cadastrado ainda.</p>';
}

function renderSuppliers(data) {
  $('#suppliersCount').textContent = `${data.suppliers.length} fornecedores`;
  $('#suppliersList').innerHTML = data.suppliers.map(supplier => `
    <div class="supplier">
      <strong>${supplier.name}</strong>
      <div>${supplier.contact || '-'} | ${supplier.whatsapp || supplier.phone || '-'}</div>
      <div>${(supplier.supplierTypes || []).map(type => `<span class="tag">${type}</span>`).join('') || '<span class="tag">sem tipo</span>'}</div>
    </div>
  `).join('');
}

function renderQueue(data) {
  const pending = data.quoteQueue.filter(item => item.status !== 'batch_sent');
  $('#quoteQueue').innerHTML = pending.length ? pending.map(item => `
    <div class="queue-item">
      <strong>${item.materialName || item.item}</strong>
      <div><small>${item.id}</small></div>
      <div>${item.missingQuantity} ${item.unit} | ${item.status}</div>
      <div>${(item.supplierCandidates || []).length} fornecedor(es) compativeis</div>
    </div>
  `).join('') : '<p>Nenhum item pendente na fila.</p>';
}

function renderBatches(data) {
  const batches = [...data.quoteBatches].reverse().slice(0, 8);
  $('#quoteBatches').innerHTML = batches.length ? batches.map(batch => `
    <div class="batch-item">
      <strong>${batch.id}</strong>
      <div>${batch.status} | itens=${batch.itemCount} | fornecedores=${batch.supplierCount}</div>
      <div>${batch.notes || ''}</div>
      <div class="batch-actions">
        ${batch.status !== 'sent' ? `<button class="button-secondary" data-send-batch="${batch.id}" type="button">Enviar lote</button>` : ''}
      </div>
    </div>
  `).join('') : '<p>Nenhum lote criado ainda.</p>';

  document.querySelectorAll('[data-send-batch]').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await api('/api/quote/send-batch', {
          method: 'POST',
          body: JSON.stringify({ batchId: button.dataset.sendBatch })
        });
        toast('Lote enviado.');
        await refresh();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function renderShortages(data) {
  const shortages = [...data.shortages].reverse().slice(0, 10);
  $('#shortagesCount').textContent = `${data.shortages.length} faltas`;
  $('#shortagesList').innerHTML = shortages.length ? shortages.map(shortage => {
    const missing = Math.max(Number(shortage.needed || 0) - Number(shortage.available || 0), 0);
    return `
      <div class="queue-item">
        <strong>${shortage.item}</strong>
        <div><small>${shortage.id}</small></div>
        <div>Falta ${missing} ${shortage.unit || 'un'} | ${shortage.status}</div>
        <div>${shortage.reportedBy || 'sem responsavel'} | ${shortage.source || 'manual'}</div>
      </div>
    `;
  }).join('') : '<p>Nenhuma falta registrada ainda.</p>';
}

function renderQuotes(data) {
  const quotes = [...data.quotes].reverse().slice(0, 10);
  $('#quotesCount').textContent = `${data.quotes.length} cotacoes`;
  $('#quotesList').innerHTML = quotes.length ? quotes.map(quote => `
    <div class="queue-item">
      <strong>${quote.item}</strong>
      <div>${quote.supplier} | R$ ${Number(quote.unitPrice || 0).toFixed(2)}</div>
      <div>${quote.quantity} disponivel | prazo ${quote.leadDays} dia(s)</div>
      <div>${quote.payment || ''}</div>
    </div>
  `).join('') : '<p>Nenhuma cotacao registrada ainda.</p>';
}

function renderMessages(data) {
  const messages = [...data.messages].reverse().slice(0, 12);
  $('#messagesCount').textContent = `${data.messages.length} mensagens`;
  $('#messagesList').innerHTML = messages.length ? messages.map(message => {
    const isOutbound = message.direction === 'outbound';
    const name = isOutbound ? message.toName : message.fromName;
    const phone = isOutbound ? message.toPhone : message.fromPhone;
    return `
      <div class="message ${isOutbound ? 'outbound' : 'inbound'}">
        <div><strong>${isOutbound ? 'Enviado' : 'Recebido'}</strong> ${name || phone || ''}</div>
        <p>${message.text || ''}</p>
        <small>${message.role || '-'} | ${message.relatedEntityType || 'geral'}</small>
      </div>
    `;
  }).join('') : '<p>Nenhuma mensagem registrada ainda.</p>';
}

function renderCommercialPurchasePlan(body) {
  const request = body.request;
  const best = request.quotes?.[0] || {};
  const second = request.quotes?.[1] || null;
  const missingQuantity = Number(request.missingQuantity || 0);
  const total = missingQuantity * Number(request.bestUnitPrice || 0);
  const economy = second
    ? (Number(second.unitPrice || 0) - Number(request.bestUnitPrice || 0)) * missingQuantity
    : 0;

  return `
    <div class="purchase-highlight">
      <span>Recomendacao</span>
      <strong>Comprar com ${request.bestSupplier}</strong>
      <p>${request.item} | ${missingQuantity} ${request.unit}</p>
    </div>
    <div class="purchase-grid">
      <div><small>Preco unitario</small><strong>${money(request.bestUnitPrice)}</strong></div>
      <div><small>Total estimado</small><strong>${money(total)}</strong></div>
      <div><small>Prazo</small><strong>${request.bestLeadDays} dia(s)</strong></div>
      <div><small>Economia vs. 2a opcao</small><strong>${money(Math.max(economy, 0))}</strong></div>
    </div>
    <p><strong>Status:</strong> ${request.status}. <strong>Fluxo:</strong> ${body.outcome}.</p>
    <p><strong>Pagamento:</strong> ${request.bestPayment || 'nao informado'}.</p>
  `;
}

function render(data) {
  renderClientProfile(data);
  renderFlowFunnel(data);
  renderUsers(data);
  renderMaterials(data);
  renderSuppliers(data);
  renderQueue(data);
  renderBatches(data);
  renderShortages(data);
  renderQuotes(data);
  renderMessages(data);
}

async function refresh() {
  snapshot = await api('/api/snapshot');
  render(snapshot);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function submitForm(form, path) {
  const payload = formData(form);
  await api(path, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  form.reset();
  toast('Salvo com sucesso.');
  await refresh();
}

$('#refreshButton').addEventListener('click', refresh);

document.querySelectorAll('[data-tab-target]').forEach(button => {
  button.addEventListener('click', () => {
    const target = button.dataset.tabTarget;
    document.querySelectorAll('[data-tab-target]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tabTarget === target);
    });
    document.querySelectorAll('[data-tab-panel]').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.tabPanel === target);
    });
  });
});

$('#demoButton').addEventListener('click', async () => {
  try {
    const body = await api('/api/demo/rirrofer', {
      method: 'POST',
      body: JSON.stringify({})
    });
    snapshot = body.snapshot;
    render(snapshot);
    toast('Demo Rirrofer preparada.');
  } catch (error) {
    toast(error.message);
  }
});

$('#dailyReportButton').addEventListener('click', async () => {
  try {
    const body = await api('/api/reports/daily', {
      method: 'POST',
      body: JSON.stringify({})
    });
    $('#dailyReportResult').innerHTML = `
      <strong>Relatorio gerado:</strong>
      <div>${body.report.fileName}</div>
      <pre>${body.report.markdown.split('\n').slice(0, 28).join('\n')}</pre>
    `;
    toast('Relatorio diario gerado.');
  } catch (error) {
    toast(error.message);
  }
});

$('#userForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitForm(event.currentTarget, '/api/users');
  } catch (error) {
    toast(error.message);
  }
});

$('#shortageForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitForm(event.currentTarget, '/api/shortages');
  } catch (error) {
    toast(error.message);
  }
});

$('#materialForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitForm(event.currentTarget, '/api/materials');
  } catch (error) {
    toast(error.message);
  }
});

$('#supplierForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitForm(event.currentTarget, '/api/suppliers');
  } catch (error) {
    toast(error.message);
  }
});

$('#importForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitForm(event.currentTarget, '/api/materials/import');
  } catch (error) {
    toast(error.message);
  }
});

$('#batchForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitForm(event.currentTarget, '/api/quote/build-batch');
  } catch (error) {
    toast(error.message);
  }
});

$('#quoteForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await submitForm(event.currentTarget, '/api/quotes');
  } catch (error) {
    toast(error.message);
  }
});

$('#purchasePlanForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const payload = formData(event.currentTarget);
    const body = await api('/api/purchase/plan', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    $('#purchasePlanResult').innerHTML = renderCommercialPurchasePlan(body);
    toast('Plano de compra criado.');
    await refresh();
  } catch (error) {
    toast(error.message);
  }
});

$('#resolveForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const payload = formData(event.currentTarget);
    const body = await api('/api/materials/resolve', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    $('#resolveResult').textContent = JSON.stringify(body.result.resolution, null, 2);
  } catch (error) {
    toast(error.message);
  }
});

refresh().catch(error => toast(error.message));
