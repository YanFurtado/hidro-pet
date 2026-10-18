(function () {
  'use strict';
  const C = window.HidroCore;
  const $ = (s) => document.querySelector(s);
  const view = $('#view'), nav = $('#nav'), modal = $('#modal'), whoSel = $('#who');
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignora */ } },
  };

  // ---------- utilidades ----------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const addDays = (d, n) => C.fmt(new Date(C.parse(d).getTime() + n * 864e5));
  const longDate = (d) => C.parse(d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' });
  const shortDate = (d) => C.parse(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const monthLabel = (m) => C.parse(m).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayName = (d) => C.parse(d).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  const monthStart = (d) => d.slice(0, 7) + '-01';
  const monthEnd = (d) => { const x = C.parse(monthStart(d)); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return C.fmt(x); };
  const shiftMonth = (m, n) => { const x = C.parse(m); x.setUTCMonth(x.getUTCMonth() + n); return C.fmt(x); };
  const STATUS = { presente: 'Presente', ausente: 'Ausente', justificado: 'Justificada', nao_marcado: 'Não marcado' };
  const TAB_HASH = { agenda: 'Agenda', chamada: 'Chamada', alunos: 'Alunos', relatorios: 'Relatórios', equipe: 'Equipe' };

  let toastT;
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 3200);
  }

  // ---------- estado e persistência ----------
  let S = C.emptyState();
  let mode = 'local';
  const ui = {
    tab: 'Agenda', month: monthStart(todayStr()), selected: todayStr(), filter: 'all',
    callDate: null, callGroup: 1, callSearch: '',
    stuSearch: '', stuGroup: 'all', stuInactive: false,
    repFrom: monthStart(todayStr()), repTo: todayStr(), repGroup: 'all',
    who: store.get('hidro_who', ''),
  };

  let authRequired = false;
  async function load() {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.status === 401 || r.status === 503) { mode = 'server'; return { blocked: await r.json().catch(() => ({})) }; }
      if (!r.ok) throw new Error();
      const j = await r.json();
      S = Object.assign(C.emptyState(), j.state); authRequired = !!j.authRequired; mode = 'server';
    } catch (e) {
      try { S = Object.assign(C.emptyState(), JSON.parse(store.get('hidro_state', 'null')) || {}); } catch (e2) { S = C.emptyState(); }
      mode = 'local';
    }
    $('#sync').textContent = mode === 'server' ? '· dados compartilhados' : '· modo local: dados só neste aparelho';
  }

  async function act(action, payload) {
    if (mode === 'server') {
      const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) });
      const j = await r.json();
      if (r.status === 401) { showLogin(); throw new Error('Sessão expirada. Digite o código de acesso.'); }
      if (!r.ok) throw new Error(j.error || 'Erro ao salvar.');
      S = Object.assign(C.emptyState(), j.state); return j.extra || {};
    }
    const r = C.apply(S, action, payload); S = r.state;
    store.set('hidro_state', JSON.stringify(S)); return r.extra || {};
  }
  // executa uma ação mostrando erro em aviso
  async function run(action, payload, okMsg) {
    try { const x = await act(action, payload); if (okMsg) toast(okMsg); render(); return x; }
    catch (e) { toast(e.message.replace(/^DUP:/, ''), true); return null; }
  }

  // ---------- consultas ----------
  const teacher = (id) => S.teachers.find((t) => t.id === id);
  const tName = (id) => (teacher(id) || {}).name || '—';
  const activeTeachers = () => S.teachers.filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const callOf = (d, g) => S.calls[C.callKey(d, g)];
  const groupDone = (d, g) => { const c = callOf(d, g); return (c && c.state === 'finalizada') || C.roster(S, d, g).length === 0; };
  const dayDone = (d) => groupDone(d, 1) && groupDone(d, 2);
  function dayStatus(d) {
    if (!C.isClassDay(d)) return null;
    const x = S.days[d], t = todayStr();
    if (x && x.status === 'cancelada') return { k: 'cancelada', label: 'Cancelada', cls: 'neutral', sub: x.reason || 'Sem aula' };
    if (!x || !x.responsible_id) return { k: 'semprof', label: 'Sem professor', cls: 'warning', sub: 'Definir escala' };
    if (d <= t && dayDone(d)) return { k: 'concluido', label: 'Concluído', cls: 'success', sub: tName(x.responsible_id) };
    if (d <= t) return { k: 'pendente', label: 'Chamada pendente', cls: 'warning', sub: tName(x.responsible_id) };
    return { k: 'agendada', label: 'Agendada', cls: 'teal', sub: tName(x.responsible_id) };
  }
  function firstDate() {
    const ds = [...Object.keys(S.days), ...S.students.map((s) => s.start_date)].filter(Boolean).sort();
    return ds[0] || null;
  }
  function pendingDays() {
    const f = firstDate(), t = todayStr(), out = [];
    if (!f) return out;
    for (let d = f; d <= t; d = addDays(d, 1)) {
      if (!C.isClassDay(d)) continue;
      const x = S.days[d];
      if (x && x.status === 'cancelada') continue;
      if (!dayDone(d)) out.push(d);
    }
    return out;
  }

  // ---------- modal ----------
  function ask(title, sub, fields, submitLabel, handler) {
    modal.innerHTML = `<form method="dialog" id="mform"><h2>${esc(title)}</h2><p class="sub">${esc(sub || '')}</p>${fields}
      <p class="error" id="merr" hidden></p>
      <div class="foot"><button type="button" class="btn" data-act="closeModal">Cancelar</button><button class="btn primary" id="msubmit">${esc(submitLabel)}</button></div></form>`;
    if (!modal.open) modal.showModal();
    $('#mform').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const btn = $('#msubmit'); btn.disabled = true;
      try { await handler(fd); modal.close(); render(); }
      catch (err) {
        const el = $('#merr'); el.hidden = false;
        if (String(err.message).startsWith('DUP:')) {
          el.textContent = err.message.slice(4);
          if (!$('#dupchk')) el.insertAdjacentHTML('afterend', '<label class="field"><span><input type="checkbox" id="dupchk" name="confirmDuplicate" value="1"> Confirmo que é outra pessoa com o mesmo nome.</span></label>');
        } else el.textContent = err.message;
        btn.disabled = false;
      }
    };
  }
  const teacherOptions = (sel) => activeTeachers().map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

  // ---------- telas ----------
  function render() {
    renderWho();
    const tabs = [['Agenda', '📅'], ['Chamada', '✅'], ['Alunos', '👥'], ['Relatórios', '📊'], ['Equipe', '⚙️']];
    nav.innerHTML = tabs.map(([n, i]) => `<button data-act="tab" data-tab="${n}" ${ui.tab === n ? 'aria-current="page"' : ''}><span class="ico">${i}</span><span>${n}</span></button>`).join('');
    const fn = { Agenda: vAgenda, Chamada: vChamada, Alunos: vAlunos, 'Relatórios': vRelatorios, Equipe: vEquipe }[ui.tab];
    view.innerHTML = fn();
    if (ui.tab === 'Chamada') bindCallSearch();
    if (ui.tab === 'Alunos') bindStuSearch();
    if (ui.tab === 'Equipe') loadSnaps();
  }
  function renderWho() {
    const opts = ['<option value="">Coordenação / não informado</option>'].concat(activeTeachers().map((t) => `<option value="${t.id}" ${ui.who === t.id ? 'selected' : ''}>${esc(t.name)}</option>`));
    whoSel.innerHTML = opts.join('');
  }

  function vAgenda() {
    const t = todayStr();
    const semProf = (() => { let n = 0; for (let d = t; d <= monthEnd(t); d = addDays(d, 1)) { const s = dayStatus(d); if (s && s.k === 'semprof') n++; } return n; })();
    const pend = pendingDays();
    const reqs = S.requests.filter((r) => r.status === 'pendente');
    const grid = [];
    const first = C.parse(ui.month), lead = first.getUTCDay(), end = monthEnd(ui.month);
    for (let i = 0; i < lead; i++) grid.push('<div></div>');
    for (let d = ui.month; d <= end; d = addDays(d, 1)) {
      const s = dayStatus(d), n = Number(d.slice(8));
      const dim = s && ui.filter !== 'all' && s.k !== ui.filter ? 'style="opacity:.3"' : '';
      if (!s) { grid.push(`<button class="calendar-day ${d === t ? 'today' : ''}" disabled aria-label="${longDate(d)}, sem aula"><span class="day-number">${n}</span></button>`); continue; }
      grid.push(`<button class="calendar-day class-day ${d === ui.selected ? 'selected' : ''} ${d === t ? 'today' : ''}" ${dim} data-act="pickDay" data-date="${d}" aria-label="${longDate(d)}, ${s.label}">
        <span class="day-number">${n}</span><span class="calendar-status ${s.cls}">${s.label}</span><small>${esc(s.sub)}</small><span class="calendar-times">16h e 17h</span></button>`);
    }
    const upcoming = [];
    for (let d = t, i = 0; i < 90 && upcoming.length < 4; d = addDays(d, 1), i++) { const s = dayStatus(d); if (s && s.k !== 'cancelada') upcoming.push([d, s]); }
    return `
      <div class="page-heading"><div><span class="eyebrow">VISÃO DA COORDENAÇÃO</span><h1>Agenda</h1><p>Uma equipe organizada, duas turmas bem acompanhadas.</p></div>
        <div class="actions no-print"><button class="icon-button" data-act="refresh" aria-label="Atualizar dados">⟳</button></div></div>
      <div class="metrics">
        <div class="metric warning"><span class="metric-label">Dias sem professor</span><b>${semProf}</b><small>No restante deste mês</small></div>
        <div class="metric"><span class="metric-label">Pedidos de substituição</span><b>${reqs.length}</b><small>Aguardando decisão</small></div>
        <div class="metric"><span class="metric-label">Dias com chamada pendente</span><b>${pend.length}</b><small>Até hoje · duas turmas por dia</small></div>
      </div>
      <div class="agenda-layout">
        <section class="panel">
          <div class="panel-heading"><div class="month-heading"><button class="icon-button" data-act="month" data-n="-1" aria-label="Mês anterior">‹</button><h2>${monthLabel(ui.month)}</h2><button class="icon-button" data-act="month" data-n="1" aria-label="Próximo mês">›</button></div>
            <button class="btn small" data-act="today">Hoje</button></div>
          <div class="calendar-toolbar no-print">
            <select id="calFilter" aria-label="Filtrar agenda" style="width:auto">
              ${[['all', 'Todas as aulas'], ['semprof', 'Sem professor'], ['pendente', 'Chamada pendente'], ['agendada', 'Agendadas'], ['concluido', 'Concluídas'], ['cancelada', 'Canceladas']].map(([v, l]) => `<option value="${v}" ${ui.filter === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <button class="btn" data-act="repeat">+ Repetir escala</button>
          </div>
          <div class="calendar-grid">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((w) => `<div class="week-label">${w}</div>`).join('')}${grid.join('')}</div>
          <div class="calendar-legend"><span class="badge teal">Agendada</span><span class="badge warning">Pendente / sem professor</span><span class="badge success">Concluído</span><span class="badge neutral">Cancelada / feriado</span></div>
        </section>
        <aside class="agenda-aside">
          ${dayDetail()}
          <section class="panel upcoming"><h2>Próximas aulas</h2>
            ${upcoming.length ? upcoming.map(([d, s]) => `<button class="row" data-act="pickDay" data-date="${d}" data-jump="1"><span class="date-tile"><b>${Number(d.slice(8))}</b><small>${dayName(d)}.</small></span><span><b>${esc(s.k === 'semprof' ? 'Sem professor' : s.sub)}</b><br><small class="hint">${s.label} · 16h e 17h</small></span></button>`).join('') : '<div class="empty"><p>Nenhuma próxima aula.</p></div>'}
          </section>
        </aside>
      </div>
      <section class="panel"><div class="panel-heading"><h2>Pedidos de substituição</h2><span class="badge neutral">${reqs.length} pendentes</span></div>
        ${reqs.length ? reqs.map(reqRow).join('') : '<div class="empty"><h3>Nenhum pedido de substituição</h3><p>Os pedidos dos professores aparecerão aqui.</p></div>'}</section>
      <section class="panel"><div class="panel-heading"><h2>Chamadas que precisam de atenção</h2></div>
        ${pend.length ? pend.slice(-8).reverse().map((d) => {
          const done = [1, 2].filter((g) => groupDone(d, g)).length;
          return `<div class="list-row"><div><b>${esc(longDate(d))}</b><p>${esc(S.days[d] && S.days[d].responsible_id ? tName(S.days[d].responsible_id) : 'Sem professor')} · ${done}/2 finalizadas</p></div>
            <div class="actions"><button class="btn small" data-act="openCall" data-date="${d}" data-group="1">Turma 1</button><button class="btn small" data-act="openCall" data-date="${d}" data-group="2">Turma 2</button></div></div>`;
        }).join('') : '<div class="empty"><h3>Nenhuma pendência</h3><p>Todas as chamadas até hoje estão em dia.</p></div>'}
      </section>`;
  }
  function reqRow(r) {
    return `<div class="list-row"><div><b>${esc(longDate(r.date))}</b><p>${esc(tName(r.from_id))} pede substituição${r.to_id ? ' · sugerido: ' + esc(tName(r.to_id)) : ''}${r.note ? ' · “' + esc(r.note) + '”' : ''}</p></div>
      <div class="actions"><button class="btn small primary" data-act="approve" data-id="${r.id}">Aprovar com substituto</button><button class="btn small danger" data-act="reject" data-id="${r.id}">Recusar</button></div></div>`;
  }
  function dayDetail() {
    const d = ui.selected, s = dayStatus(d);
    if (!s) return `<section class="panel"><span class="eyebrow">DIA SELECIONADO</span><h2>${esc(longDate(d))}</h2><div class="empty"><h3>Sem aula nesta data</h3><p>As turmas se encontram às terças e quintas.</p></div></section>`;
    const x = S.days[d] || {};
    const hist = S.audit.filter((a) => a.entity === d).slice(0, 5);
    const canceled = s.k === 'cancelada';
    return `<section class="panel"><span class="eyebrow">DIA SELECIONADO</span><h2>${esc(longDate(d))}</h2>
      <p style="margin:6px 0 10px"><span class="badge ${s.cls}">${s.label}</span></p>
      <p><b>Responsável:</b> ${esc(x.responsible_id ? tName(x.responsible_id) : 'Ainda não definido')}</p>
      ${x.original_id && x.original_id !== x.responsible_id ? `<p class="hint">Escalado originalmente: ${esc(tName(x.original_id))}</p>` : ''}
      ${canceled && x.reason ? `<p class="hint">Motivo: ${esc(x.reason)}</p>` : ''}
      <div class="actions" style="margin:12px 0">
        <button class="btn primary" data-act="schedule" data-date="${d}">${x.responsible_id ? 'Editar escala' : 'Definir responsável'}</button>
        ${canceled ? `<button class="btn" data-act="uncancel" data-date="${d}">Reativar aula</button>` : `<button class="btn danger" data-act="cancel" data-date="${d}">Cancelar aula / feriado</button><button class="btn" data-act="request" data-date="${d}">Pedir substituição</button>`}
      </div>
      ${canceled ? '' : `<div class="actions">${[1, 2].map((g) => { const c = callOf(d, g); const f = c && c.state === 'finalizada'; return `<button class="btn" data-act="openCall" data-date="${d}" data-group="${g}">Chamada · Turma ${g} (${g === 1 ? '16h' : '17h'}) ${f ? '✔' : ''}</button>`; }).join('')}</div>`}
      ${hist.length ? `<h3 style="margin-top:14px;font-size:14px">Histórico da escala</h3>${hist.map((a) => `<p class="hint">${new Date(a.at).toLocaleString('pt-BR')} · ${esc(a.text)}</p>`).join('')}` : ''}
    </section>`;
  }

  // ----- Chamada -----
  function defaultCallDate() {
    if (ui.callDate) return ui.callDate;
    let d = todayStr(); for (let i = 0; i < 8 && !C.isClassDay(d); i++) d = addDays(d, -1);
    return d;
  }
  function vChamada() {
    const d = defaultCallDate(), g = ui.callGroup;
    const ros = C.roster(S, d, g), c = callOf(d, g) || { state: 'aberta', marks: {} };
    const fin = c.state === 'finalizada';
    const q = ui.callSearch.toLowerCase();
    const marked = ros.filter((s) => c.marks[s.id] && c.marks[s.id].status !== 'nao_marcado').length;
    const x = S.days[d];
    return `
      <div class="page-heading"><div><span class="eyebrow">CHAMADA</span><h1>Lista de presença</h1><p>Marque presença, ausência ou falta justificada.</p></div></div>
      <section class="panel">
        <div class="toolbar no-print" style="margin-bottom:12px">
          <button class="icon-button" data-act="callDay" data-n="-1" aria-label="Aula anterior">‹</button>
          <input type="date" id="callDate" value="${d}" style="max-width:170px">
          <button class="icon-button" data-act="callDay" data-n="1" aria-label="Próxima aula">›</button>
          <div class="chips">${[1, 2].map((n) => `<button class="chip ${g === n ? 'on' : ''}" data-act="callGroup" data-group="${n}">Turma ${n} · ${n === 1 ? '16h' : '17h'}</button>`).join('')}</div>
        </div>
        <p><b>${esc(longDate(d))}</b> · Professor: ${esc(x && x.responsible_id ? tName(x.responsible_id) : 'não definido')} ${fin ? '<span class="badge success">Finalizada</span>' : '<span class="badge warning">Aberta</span>'}</p>
        ${!C.isClassDay(d) ? '<p class="error">Esta data não é terça nem quinta.</p>' : ''}
        ${x && x.status === 'cancelada' ? '<p class="error">Aula cancelada neste dia.</p>' : ''}
        <div class="progress" style="margin:10px 0 4px"><i style="width:${ros.length ? Math.round(100 * marked / ros.length) : 0}%"></i></div>
        <p class="hint">${marked} de ${ros.length} alunos marcados</p>
        <div class="toolbar no-print" style="margin:12px 0"><input type="search" id="callSearch" placeholder="Buscar aluno na chamada" value="${esc(ui.callSearch)}"></div>
        <div id="callRows">${callRows(ros, c, q, fin)}</div>
        <div class="actions no-print" style="margin-top:14px">
          ${fin ? '<button class="btn" data-act="reopenCall">Reabrir chamada</button>' : '<button class="btn primary" data-act="finalizeCall">Finalizar chamada</button>'}
          <button class="btn" onclick="window.print()">Imprimir</button>
        </div>
        ${fin ? '<p class="hint" style="margin-top:8px">A lista foi preservada como estava ao finalizar esta chamada.</p>' : '<p class="hint" style="margin-top:8px">Nenhuma falta é contabilizada antes da finalização.</p>'}
      </section>`;
  }
  function callRows(ros, c, q, fin) {
    const list = ros.filter((s) => !q || s.name.toLowerCase().includes(q));
    if (!ros.length) return '<div class="empty"><h3>Nenhum aluno matriculado nesta data</h3><p>Cadastre alunos na aba Alunos.</p></div>';
    if (!list.length) return '<div class="empty"><h3>Nenhum aluno encontrado</h3></div>';
    return list.map((s) => {
      const m = c.marks[s.id] || { status: 'nao_marcado', note: '' };
      const b = (k, l) => `<button class="${m.status === k ? 'on ' + k : ''}" data-act="mark" data-id="${s.id}" data-status="${k}" ${fin ? 'disabled' : ''} aria-pressed="${m.status === k}">${l}</button>`;
      return `<div class="mark-row"><span class="name">${esc(s.name)}</span>
        <div class="mark-btns">${b('presente', 'Presente')}${b('ausente', 'Ausente')}${b('justificado', 'Justificada')}</div>
        ${m.status === 'justificado' ? `<input type="text" class="note" data-note="${s.id}" placeholder="Motivo / observação" value="${esc(m.note)}" ${fin ? 'disabled' : ''}>` : ''}</div>`;
    }).join('');
  }
  function bindCallSearch() {
    const inp = $('#callSearch'); if (!inp) return;
    inp.oninput = () => {
      ui.callSearch = inp.value;
      const d = defaultCallDate(); const ros = C.roster(S, d, ui.callGroup); const c = callOf(d, ui.callGroup) || { state: 'aberta', marks: {} };
      $('#callRows').innerHTML = callRows(ros, c, ui.callSearch.toLowerCase(), c.state === 'finalizada');
    };
    const dt = $('#callDate'); if (dt) dt.onchange = () => { if (dt.value) { ui.callDate = dt.value; render(); } };
  }

  // ----- Alunos -----
  function vAlunos() {
    const q = ui.stuSearch.toLowerCase();
    const all = S.students.filter((s) => (ui.stuInactive || s.active));
    const list = all.filter((s) => (ui.stuGroup === 'all' || s.group_no === Number(ui.stuGroup)) && (!q || s.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const cnt = (g) => S.students.filter((s) => s.active && s.group_no === g).length;
    return `
      <div class="page-heading"><div><span class="eyebrow">ALUNOS</span><h1>Alunos</h1><p>Acompanhe as matrículas e o percurso de cada aluno.</p></div>
        <div class="actions no-print"><button class="btn" data-act="importStu">Importar lista</button><button class="btn primary" data-act="addStu">+ Cadastrar aluno</button></div></div>
      <section class="panel">
        <div class="toolbar no-print" style="margin-bottom:12px"><input type="search" id="stuSearch" placeholder="Buscar aluno por nome" value="${esc(ui.stuSearch)}">
          <div class="chips">${[['all', `Todos (${cnt(1) + cnt(2)})`], ['1', `Turma 1 (${cnt(1)})`], ['2', `Turma 2 (${cnt(2)})`]].map(([v, l]) => `<button class="chip ${String(ui.stuGroup) === v ? 'on' : ''}" data-act="stuGroup" data-v="${v}">${l}</button>`).join('')}</div>
          <label class="hint"><input type="checkbox" id="stuInactive" ${ui.stuInactive ? 'checked' : ''}> mostrar inativos</label></div>
        <div id="stuRows">${stuRows(list)}</div>
      </section>`;
  }
  function stuRows(list) {
    if (!list.length) return '<div class="empty"><h3>Nenhum aluno encontrado</h3><p>Cadastre um aluno ou ajuste os filtros.</p></div>';
    return list.map((s) => `<div class="list-row"><div><b>${esc(s.name)}</b> ${s.active ? '' : '<span class="badge neutral">Inativo</span>'} ${s.start_date > todayStr() ? '<span class="badge warning">Ingresso futuro</span>' : ''}
        <p>Turma ${s.group_no} (${s.group_no === 1 ? '16h' : '17h'}) · desde ${shortDate(s.start_date)}${s.whatsapp ? ` · <a href="https://wa.me/55${s.whatsapp.replace(/^55/, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p></div>
      <div class="actions no-print"><button class="btn small" data-act="viewStu" data-id="${s.id}">Frequência</button><button class="btn small" data-act="editStu" data-id="${s.id}">Editar</button>
      <button class="btn small ${s.active ? 'danger' : ''}" data-act="toggleStu" data-id="${s.id}">${s.active ? 'Inativar' : 'Reativar'}</button></div></div>`).join('');
  }
  function bindStuSearch() {
    const inp = $('#stuSearch'); if (inp) inp.oninput = () => { ui.stuSearch = inp.value; const q = inp.value.toLowerCase();
      $('#stuRows').innerHTML = stuRows(S.students.filter((s) => (ui.stuInactive || s.active) && (ui.stuGroup === 'all' || s.group_no === Number(ui.stuGroup)) && (!q || s.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))); };
    const ck = $('#stuInactive'); if (ck) ck.onchange = () => { ui.stuInactive = ck.checked; render(); };
  }
  function stuForm(s) {
    s = s || {};
    return `<label class="field">Nome completo<input type="text" name="name" required value="${esc(s.name || '')}"></label>
      <label class="field">WhatsApp (com DDD)<input type="tel" name="whatsapp" inputmode="numeric" value="${esc(s.whatsapp || '')}" placeholder="87999999999"></label>
      <label class="field">Turma<select name="group_no"><option value="1" ${s.group_no !== 2 ? 'selected' : ''}>Turma 1 · 16h</option><option value="2" ${s.group_no === 2 ? 'selected' : ''}>Turma 2 · 17h</option></select></label>
      <label class="field">Data de ingresso<input type="date" name="start_date" required value="${s.start_date || todayStr()}"></label>`;
  }

  // ----- Relatórios -----
  function buildReport() {
    const { repFrom: from, repTo: to } = ui; const rows = new Map(); let held = 0, withTeacher = 0;
    for (const c of Object.values(S.calls)) {
      if (c.state !== 'finalizada' || c.date < from || c.date > to) continue;
      if (ui.repGroup !== 'all' && c.group !== Number(ui.repGroup)) continue;
      held++;
      for (const [sid, m] of Object.entries(c.marks)) {
        const st = S.students.find((s) => s.id === sid); if (!st) continue;
        const r = rows.get(sid) || { st, aulas: 0, p: 0, a: 0, j: 0 };
        r.aulas++; if (m.status === 'presente') r.p++; else if (m.status === 'justificado') r.j++; else r.a++;
        rows.set(sid, r);
      }
    }
    const list = [...rows.values()].map((r) => ({ ...r, freq: r.aulas - r.j > 0 ? Math.round(1000 * r.p / (r.aulas - r.j)) / 10 : null }))
      .sort((a, b) => (a.freq ?? 101) - (b.freq ?? 101) || a.st.name.localeCompare(b.st.name, 'pt-BR'));
    const pend = pendingDays().filter((d) => d >= from && d <= to).length;
    return { list, held, pend };
  }
  function vRelatorios() {
    const { list, held, pend } = buildReport();
    const avg = list.filter((r) => r.freq != null);
    const mean = avg.length ? Math.round(10 * avg.reduce((a, r) => a + r.freq, 0) / avg.length) / 10 : null;
    return `
      <div class="page-heading"><div><span class="eyebrow">RELATÓRIOS</span><h1>Frequência</h1><p>Frequência e aulas realizadas, com critérios claros.</p></div>
        <div class="actions no-print"><button class="btn" onclick="window.print()">Imprimir</button><button class="btn primary" data-act="csv">Baixar planilha</button></div></div>
      <section class="panel no-print"><div class="toolbar">
        <label class="field" style="margin:0">De<input type="date" id="repFrom" value="${ui.repFrom}"></label>
        <label class="field" style="margin:0">Até<input type="date" id="repTo" value="${ui.repTo}"></label>
        <div class="chips" style="align-self:end">${[['all', 'Todas'], ['1', 'Turma 1'], ['2', 'Turma 2']].map(([v, l]) => `<button class="chip ${String(ui.repGroup) === v ? 'on' : ''}" data-act="repGroup" data-v="${v}">${l}</button>`).join('')}</div>
        <button class="btn" data-act="genRep" style="align-self:end">Gerar relatório</button></div></section>
      <div class="metrics">
        <div class="metric"><span class="metric-label">Aulas ministradas</span><b>${held}</b><small>Chamadas finalizadas no período</small></div>
        <div class="metric warning"><span class="metric-label">Chamadas pendentes no período</span><b>${pend}</b><small>Dias com chamada em aberto</small></div>
        <div class="metric"><span class="metric-label">Frequência média</span><b>${mean == null ? '—' : mean + '%'}</b><small>Entre os alunos do período</small></div>
      </div>
      <section class="panel"><div class="panel-heading"><h2>Frequência por aluno</h2></div>
        ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Aluno</th><th>Turma</th><th class="num">Aulas</th><th class="num">Presenças</th><th class="num">Justificadas</th><th class="num">Ausências</th><th class="num">Frequência %</th></tr></thead><tbody>
          ${list.map((r) => `<tr><td>${esc(r.st.name)}</td><td>${r.st.group_no}</td><td class="num">${r.aulas}</td><td class="num">${r.p}</td><td class="num">${r.j}</td><td class="num">${r.a}</td><td class="num"><b style="color:${r.freq != null && r.freq < 60 ? 'var(--bad)' : 'inherit'}">${r.freq == null ? '—' : r.freq + '%'}</b></td></tr>`).join('')}
        </tbody></table></div><p class="hint" style="margin-top:10px">Critério: frequência = presenças ÷ (aulas − faltas justificadas). Só contam chamadas finalizadas.</p>`
        : '<div class="empty"><h3>Nenhuma chamada finalizada no período</h3><p>As frequências aparecem após a finalização das chamadas.</p></div>'}
      </section>`;
  }
  function downloadCsv() {
    const { list } = buildReport();
    const head = ['Aluno', 'Turma', 'Aulas', 'Presenças', 'Justificadas', 'Ausências', 'Frequência %'];
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [head, ...list.map((r) => [r.st.name, r.st.group_no, r.aulas, r.p, r.j, r.a, r.freq == null ? '' : String(r.freq).replace('.', ',')])].map((l) => l.map(q).join(';')).join('\r\n');
    download(`hidro-pet-frequencia-${ui.repFrom}_${ui.repTo}.csv`, csv, 'text/csv;charset=utf-8');
  }
  function download(name, content, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ----- Equipe -----
  function vEquipe() {
    return `
      <div class="page-heading"><div><span class="eyebrow">EQUIPE</span><h1>Equipe</h1><p>Cadastre os professores que podem ministrar as aulas.</p></div>
        <div class="actions no-print"><button class="btn primary" data-act="addTeacher">+ Adicionar professor</button></div></div>
      <section class="panel"><div class="panel-heading"><h2>Professores</h2></div>
        ${S.teachers.length ? S.teachers.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((t) => `<div class="list-row"><div><b>${esc(t.name)}</b> ${t.active ? '' : '<span class="badge neutral">Inativo</span>'}</div>
          <div class="actions"><button class="btn small" data-act="editTeacher" data-id="${t.id}">Editar</button><button class="btn small ${t.active ? 'danger' : ''}" data-act="toggleTeacher" data-id="${t.id}">${t.active ? 'Inativar' : 'Reativar'}</button></div></div>`).join('')
          : '<div class="empty"><h3>Nenhum professor cadastrado</h3><p>Cadastre o nome do professor para incluí-lo na escala das aulas.</p></div>'}
      </section>
      <section class="panel"><div class="panel-heading"><h2>Pedidos de substituição</h2><button class="btn small" data-act="request" data-date="">Novo pedido</button></div>
        ${S.requests.length ? S.requests.slice().reverse().slice(0, 15).map((r) => `<div class="list-row"><div><b>${esc(longDate(r.date))}</b><p>${esc(tName(r.from_id))}${r.to_id ? ' → ' + esc(tName(r.to_id)) : ''}</p></div><span class="badge ${r.status === 'aprovado' ? 'success' : r.status === 'recusado' ? 'danger' : 'warning'}">${r.status}</span></div>`).join('')
          : '<div class="empty"><p>Nenhum pedido registrado.</p></div>'}
      </section>
      <section class="panel"><div class="panel-heading"><h2>Histórico de alterações</h2></div>
        ${S.audit.length ? S.audit.slice(0, 30).map((a) => `<p class="hint" style="padding:4px 0">${new Date(a.at).toLocaleString('pt-BR')} · ${esc(a.text)}</p>`).join('') : '<div class="empty"><p>Ainda não há alterações registradas.</p></div>'}
      </section>
      <section class="panel"><div class="panel-heading"><h2>Cópia de segurança</h2></div>
        <p class="hint" style="margin-bottom:10px">Baixe um arquivo com todos os dados, ou restaure um arquivo baixado antes.</p>
        <div class="actions"><button class="btn" data-act="backup">Baixar cópia</button><button class="btn" data-act="restore">Restaurar cópia</button><input type="file" id="restoreFile" accept=".json,application/json" hidden></div></section>
      ${mode === 'server' ? `<section class="panel"><div class="panel-heading"><h2>Cópias automáticas</h2></div>
        <p class="hint" style="margin-bottom:8px">O sistema guarda sozinho uma cópia por dia (45 dias). Restaurar substitui os dados atuais, e o estado de agora fica guardado como "Antes da última restauração".</p>
        <div id="snaps"><p class="hint">Carregando…</p></div></section>` : ''}
      ${authRequired ? '<div class="actions no-print"><button class="btn" data-act="logout">Sair deste aparelho</button></div>' : ''}`;
  }

  // ---------- eventos ----------
  const handlers = {
    tab(el) { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
    refresh() { poll(true); },
    month(el) { ui.month = shiftMonth(ui.month, Number(el.dataset.n)); render(); },
    today() { ui.month = monthStart(todayStr()); ui.selected = todayStr(); render(); },
    pickDay(el) { ui.selected = el.dataset.date; if (el.dataset.jump) ui.month = monthStart(ui.selected); render(); },
    closeModal() { modal.close(); },
    openCall(el) { ui.callDate = el.dataset.date; ui.callGroup = Number(el.dataset.group); ui.callSearch = ''; ui.tab = 'Chamada'; render(); window.scrollTo(0, 0); },
    callGroup(el) { ui.callGroup = Number(el.dataset.group); render(); },
    callDay(el) {
      const n = Number(el.dataset.n); let d = defaultCallDate();
      for (let i = 0; i < 8; i++) { d = addDays(d, n); if (C.isClassDay(d)) break; }
      ui.callDate = d; render();
    },
    mark(el) { const d = defaultCallDate(), cur = (callOf(d, ui.callGroup) || { marks: {} }).marks[el.dataset.id];
      const status = cur && cur.status === el.dataset.status ? 'nao_marcado' : el.dataset.status;
      run('call.mark', { date: d, group: ui.callGroup, student_id: el.dataset.id, status, note: status === 'justificado' && cur ? cur.note : '' }); },
    finalizeCall() {
      const d = defaultCallDate(), g = ui.callGroup, c = callOf(d, g) || { marks: {} };
      const un = C.roster(S, d, g).filter((s) => !c.marks[s.id] || c.marks[s.id].status === 'nao_marcado').length;
      ask('Finalizar chamada', `${longDate(d)} · Turma ${g}`,
        `<p>${un ? `<b>${un} aluno(s) sem marcação</b> serão registrados como ausentes.` : 'Todos os alunos estão marcados.'} Depois de finalizar, a lista fica preservada. Você ainda poderá reabrir.</p>`,
        'Finalizar', (fd) => act('call.finalize', { date: d, group: g, by: ui.who ? tName(ui.who) : '' }));
    },
    reopenCall() { run('call.reopen', { date: defaultCallDate(), group: ui.callGroup }, 'Chamada reaberta.'); },
    schedule(el) {
      const d = el.dataset.date, x = S.days[d] || {};
      if (!activeTeachers().length) return toast('Cadastre um professor na aba Equipe primeiro.', true);
      ask(x.responsible_id ? 'Editar escala' : 'Definir responsável', `${longDate(d)} · um professor assume as duas turmas. Alterações ficam no histórico.`,
        `<label class="field">Professor<select name="responsible_id">${teacherOptions(x.responsible_id)}</select></label>`, 'Salvar',
        (fd) => act('day.schedule', { date: d, responsible_id: fd.responsible_id, status: 'agendada' }));
    },
    cancel(el) { const d = el.dataset.date;
      ask('Cancelar aula', longDate(d), '<label class="field">Motivo (feriado, chuva, manutenção…)<input type="text" name="reason" placeholder="Feriado"></label>', 'Cancelar aula',
        (fd) => act('day.schedule', { date: d, status: 'cancelada', reason: fd.reason })); },
    uncancel(el) { const d = el.dataset.date, x = S.days[d] || {};
      if (!x.responsible_id) return handlers.schedule(el);
      run('day.schedule', { date: d, status: 'agendada', responsible_id: x.responsible_id }, 'Aula reativada.'); },
    repeat() {
      if (!activeTeachers().length) return toast('Cadastre um professor na aba Equipe primeiro.', true);
      ask('Repetir escala', 'Define o mesmo professor em várias datas. Datas que já têm escala são preservadas.',
        `<label class="field">Professor<select name="responsible_id">${teacherOptions()}</select></label>
         <label class="field">Dias<select name="weekday"><option value="">Terças e quintas</option><option value="2">Só terças</option><option value="4">Só quintas</option></select></label>
         <label class="field">De<input type="date" name="from" value="${todayStr()}" required></label>
         <label class="field">Até<input type="date" name="to" value="${monthEnd(todayStr())}" required></label>`, 'Aplicar escala',
        async (fd) => { const x = await act('day.repeat', fd); toast(`${x.created} datas definidas` + (x.skipped.length ? `; ${x.skipped.length} já existentes preservadas.` : '.')); });
    },
    request(el) {
      const d = el.dataset.date || ui.selected;
      if (S.teachers.length < 1) return toast('Cadastre professores na aba Equipe primeiro.', true);
      ask('Pedir substituição', 'A coordenação decide e a escala só muda após a aprovação.',
        `<label class="field">Data da aula<input type="date" name="date" value="${C.isClassDay(d) ? d : ''}" required></label>
         <label class="field">Quem pede<select name="from_id">${teacherOptions(ui.who)}</select></label>
         <label class="field">Substituto sugerido (opcional)<select name="to_id"><option value="">—</option>${teacherOptions()}</select></label>
         <label class="field">Motivo<input type="text" name="note"></label>`, 'Enviar pedido',
        (fd) => act('request.create', fd));
    },
    approve(el) { const r = S.requests.find((x) => x.id === el.dataset.id);
      ask('Aprovar com substituto', `${longDate(r.date)} · pedido de ${tName(r.from_id)}`,
        `<label class="field">Professor substituto<select name="substitute_id">${teacherOptions(r.to_id)}</select></label>`, 'Aprovar',
        (fd) => act('request.resolve', { id: r.id, decision: 'aprovado', substitute_id: fd.substitute_id })); },
    reject(el) { run('request.resolve', { id: el.dataset.id, decision: 'recusado' }, 'Pedido recusado.'); },
    addStu() { ask('Cadastrar aluno', 'Confira os dados antes de salvar.', stuForm(), 'Salvar', (fd) => act('student.save', { ...fd, confirmDuplicate: !!fd.confirmDuplicate })); },
    editStu(el) { const s = S.students.find((x) => x.id === el.dataset.id);
      ask('Editar aluno', s.name, stuForm(s), 'Salvar', (fd) => act('student.save', { ...fd, id: s.id, confirmDuplicate: !!fd.confirmDuplicate })); },
    toggleStu(el) { const s = S.students.find((x) => x.id === el.dataset.id);
      run('student.setActive', { id: s.id, active: !s.active, today: todayStr() }, s.active ? 'Aluno inativado.' : 'Aluno reativado.'); },
    stuGroup(el) { ui.stuGroup = el.dataset.v; render(); },
    viewStu(el) {
      const s = S.students.find((x) => x.id === el.dataset.id);
      const rows = Object.values(S.calls).filter((c) => c.marks[s.id] && c.state === 'finalizada').sort((a, b) => b.date.localeCompare(a.date));
      modal.innerHTML = `<h2>${esc(s.name)}</h2><p class="sub">Histórico de chamadas finalizadas</p>
        ${rows.length ? `<div class="table-wrap"><table><tbody>${rows.map((c) => `<tr><td>${shortDate(c.date)}</td><td>Turma ${c.group}</td><td>${STATUS[c.marks[s.id].status]}</td><td>${esc(c.marks[s.id].note)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>Sem chamadas finalizadas ainda.</p></div>'}
        <div class="foot"><button class="btn" data-act="closeModal">Fechar</button></div>`;
      modal.showModal();
    },
    importStu() {
      ask('Importar lista de alunos', 'Cole uma linha por aluno: Nome; Turma (1 ou 2); WhatsApp. Também aceita arquivo .csv.',
        `<label class="field">Lista<textarea name="text" rows="8" placeholder="Maria da Silva; 1; 87999999999"></textarea></label>
         <label class="field">ou escolha um arquivo<input type="file" id="impFile" accept=".csv,.txt"></label>`, 'Importar',
        async (fd) => {
          const rows = fd.text.split(/\r?\n/).map((l) => l.split(/[;\t,]/).map((x) => x.trim().replace(/^"|"$/g, ''))).filter((p) => p[0] && !/^nome$/i.test(p[0]))
            .map((p) => ({ name: p[0], group_no: Number(String(p[1] || '').replace(/\D/g, '')), whatsapp: p[2] || '' }));
          if (!rows.length) throw new Error('Nenhuma linha válida encontrada.');
          const x = await act('student.import', { rows, today: todayStr() });
          toast(`${x.created} alunos importados, ${x.skipped} ignorados (duplicados ou turma inválida).`);
        });
      const f = $('#impFile'); f.onchange = () => { const r = new FileReader(); r.onload = () => { modal.querySelector('textarea').value = r.result; }; r.readAsText(f.files[0]); };
    },
    repGroup(el) { ui.repGroup = el.dataset.v; render(); },
    genRep() { ui.repFrom = $('#repFrom').value || ui.repFrom; ui.repTo = $('#repTo').value || ui.repTo; render(); },
    csv() { downloadCsv(); },
    addTeacher() { ask('Adicionar professor', 'Cadastre o nome do professor para incluí-lo na escala das aulas.', '<label class="field">Nome<input type="text" name="name" required></label>', 'Salvar', (fd) => act('teacher.save', fd)); },
    editTeacher(el) { const t = teacher(el.dataset.id);
      ask('Editar professor', t.name, `<label class="field">Nome<input type="text" name="name" required value="${esc(t.name)}"></label>`, 'Salvar', (fd) => act('teacher.save', { id: t.id, name: fd.name, active: t.active })); },
    toggleTeacher(el) { const t = teacher(el.dataset.id); run('teacher.save', { id: t.id, name: t.name, active: !t.active }); },
    async restoreSnap(el) {
      if (!confirm('Restaurar esta cópia? Os dados atuais serão substituídos (uma cópia de segurança deles fica guardada).')) return;
      try {
        const r = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshot: el.dataset.name }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erro ao restaurar.');
        S = Object.assign(C.emptyState(), j.state); toast('Cópia restaurada.'); render();
      } catch (e) { toast(e.message, true); }
    },
    async logout() { await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"logout":true}' }); showLogin(); },
    backup() { download(`hidro-pet-backup-${todayStr()}.json`, JSON.stringify(S), 'application/json'); },
    restore() {
      const f = $('#restoreFile'); f.onchange = async () => {
        try {
          const s = JSON.parse(await f.files[0].text());
          if (!s || !Array.isArray(s.students)) throw new Error('Arquivo inválido.');
          if (!confirm('Isso substitui TODOS os dados atuais pelos do arquivo. Continuar?')) return;
          if (mode === 'server') {
            const r = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: s }) });
            const j = await r.json(); if (!r.ok) throw new Error(j.error); S = Object.assign(C.emptyState(), j.state);
          } else { S = Object.assign(C.emptyState(), s); store.set('hidro_state', JSON.stringify(S)); }
          toast('Cópia restaurada.'); render();
        } catch (e) { toast(e.message, true); }
      };
      f.click();
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const h = handlers[el.dataset.act]; if (h) h(el);
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'calFilter') { ui.filter = e.target.value; render(); }
    if (e.target.matches('[data-note]')) {
      const d = defaultCallDate(), id = e.target.dataset.note, cur = (callOf(d, ui.callGroup) || { marks: {} }).marks[id];
      run('call.mark', { date: d, group: ui.callGroup, student_id: id, status: cur ? cur.status : 'justificado', note: e.target.value });
    }
  });
  whoSel.addEventListener('change', () => { ui.who = whoSel.value; store.set('hidro_who', ui.who); });

  // atualização automática para quem está com o app aberto (modo compartilhado)
  async function poll(force) {
    if (mode !== 'server') { if (force) toast('Modo local: não há o que sincronizar.'); return; }
    if (!force && (document.hidden || modal.open || document.activeElement.matches('input,textarea,select'))) return;
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.status === 401) return showLogin();
      const j = await r.json();
      if (j.state.rev !== S.rev) { S = Object.assign(C.emptyState(), j.state); render(); }
      if (force) toast('Dados atualizados.');
    } catch (e) { if (force) toast('Sem conexão com o servidor.', true); }
  }
  setInterval(poll, 30000);

  // ---------- código de acesso ----------
  function showLogin(info) {
    nav.innerHTML = ''; whoSel.parentElement.hidden = true;
    if (info && info.error === 'config') {
      view.innerHTML = `<section class="panel"><h2>Configuração pendente</h2><p style="margin-top:8px">${esc(info.message)}</p></section>`; return;
    }
    view.innerHTML = `<section class="panel" style="max-width:420px;margin:24px auto"><span class="eyebrow">ACESSO RESTRITO</span><h2>Digite o código de acesso</h2>
      <p class="hint" style="margin:6px 0 14px">O código é o mesmo para toda a equipe. O aparelho vai lembrar dele.</p>
      <form id="loginForm"><label class="field">Código<input type="password" id="loginCode" autocomplete="current-password" required></label>
      <p class="error" id="loginErr" hidden></p><button class="btn primary" style="width:100%">Entrar</button></form></section>`;
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('#loginCode').value }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erro.');
        whoSel.parentElement.hidden = false; await boot();
      } catch (err) { const el = $('#loginErr'); el.hidden = false; el.textContent = err.message; btn.disabled = false; }
    };
  }
  async function boot() {
    const x = await load();
    if (x && x.blocked) return showLogin(x.blocked);
    ui.tab = TAB_HASH[location.hash.slice(1)] || ui.tab; render();
  }

  // ---------- cópias automáticas ----------
  async function loadSnaps() {
    const box = $('#snaps'); if (!box || mode !== 'server') return;
    try {
      const r = await fetch('/api/snapshots', { cache: 'no-store' }); if (!r.ok) throw new Error();
      const { snapshots } = await r.json();
      box.innerHTML = snapshots.length ? snapshots.map((n) => `<div class="list-row"><div><b>${n === 'antes-da-restauracao' ? 'Antes da última restauração' : esc(shortDate(n))}</b><p>${n === 'antes-da-restauracao' ? 'Guardada automaticamente antes de restaurar' : 'Estado no início do dia, antes da primeira alteração'}</p></div>
        <button class="btn small" data-act="restoreSnap" data-name="${esc(n)}">Restaurar</button></div>`).join('') : '<div class="empty"><p>As cópias automáticas aparecem a partir da primeira alteração de cada dia.</p></div>';
    } catch (e) { box.innerHTML = '<p class="hint">Não foi possível carregar as cópias.</p>'; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  boot();
})();
