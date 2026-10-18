// Regras de negócio do Hidro PET. Usado pelo servidor (Node) e pelo navegador (modo local).
(function (root) {
  const CLASS_DAYS = [2, 4]; // terça e quinta
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const emptyState = () => ({ rev: 0, teachers: [], students: [], days: {}, calls: {}, requests: [], audit: [] });

  const parse = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  const weekday = (d) => parse(d).getUTCDay();
  const isClassDay = (d) => CLASS_DAYS.includes(weekday(d));
  const callKey = (date, group) => date + '|' + group;

  function roster(state, date, group) {
    return state.students
      .filter((s) => s.active && s.group_no === group && s.start_date <= date && (!s.end_date || s.end_date >= date))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  function log(state, text, entity) {
    state.audit.unshift({ at: new Date().toISOString(), entity: entity || '', text });
    if (state.audit.length > 500) state.audit.length = 500;
  }
  const tName = (s, id) => (s.teachers.find((t) => t.id === id) || {}).name || '—';
  const need = (c, msg) => { if (!c) throw new Error(msg); };
  const clean = (v) => String(v == null ? '' : v).trim();

  function getCall(state, date, group) {
    const k = callKey(date, group);
    if (!state.calls[k]) state.calls[k] = { date, group, state: 'aberta', marks: {}, finalized_at: null };
    return state.calls[k];
  }

  const actions = {
    'teacher.save'(s, p) {
      const name = clean(p.name).toUpperCase();
      need(name, 'Informe o nome do professor.');
      need(!s.teachers.some((t) => t.name === name && t.id !== p.id), 'Já existe um professor com esse nome.');
      if (p.id) {
        const t = s.teachers.find((x) => x.id === p.id); need(t, 'Professor não encontrado.');
        t.name = name; t.active = p.active !== false; log(s, 'Professor editado: ' + name);
      } else { s.teachers.push({ id: uid(), name, active: true }); log(s, 'Professor cadastrado: ' + name); }
    },
    'student.save'(s, p) {
      const name = clean(p.name); need(name, 'Informe o nome do aluno.');
      const group_no = Number(p.group_no); need([1, 2].includes(group_no), 'Escolha a turma 1 ou 2.');
      const whatsapp = clean(p.whatsapp).replace(/\D/g, '');
      need(!whatsapp || whatsapp.length >= 10, 'WhatsApp inválido. Inclua o DDD.');
      const start_date = p.start_date || fmt(new Date());
      const dup = s.students.find((x) => x.active && x.id !== p.id && x.name.toLowerCase() === name.toLowerCase());
      need(!dup || p.confirmDuplicate, 'DUP:Já existe um aluno ativo com esse nome. Confirme se é outra pessoa.');
      if (p.id) {
        const st = s.students.find((x) => x.id === p.id); need(st, 'Aluno não encontrado.');
        Object.assign(st, { name, whatsapp, group_no, start_date }); log(s, 'Aluno editado: ' + name);
      } else {
        s.students.push({ id: uid(), name, whatsapp, group_no, start_date, end_date: null, active: true });
        log(s, 'Aluno cadastrado: ' + name + ' (Turma ' + group_no + ')');
      }
    },
    'student.setActive'(s, p) {
      const st = s.students.find((x) => x.id === p.id); need(st, 'Aluno não encontrado.');
      st.active = !!p.active; st.end_date = p.active ? null : (p.today || fmt(new Date()));
      log(s, (p.active ? 'Aluno reativado: ' : 'Aluno inativado: ') + st.name);
    },
    'student.import'(s, p) {
      let n = 0, skipped = 0;
      for (const r of p.rows || []) {
        const name = clean(r.name); const g = Number(r.group_no);
        if (!name || ![1, 2].includes(g) || s.students.some((x) => x.active && x.name.toLowerCase() === name.toLowerCase())) { skipped++; continue; }
        s.students.push({ id: uid(), name, whatsapp: clean(r.whatsapp).replace(/\D/g, ''), group_no: g, start_date: r.start_date || p.today || fmt(new Date()), end_date: null, active: true });
        n++;
      }
      log(s, 'Importação: ' + n + ' alunos novos, ' + skipped + ' ignorados');
      return { created: n, skipped };
    },
    'day.schedule'(s, p) {
      need(isClassDay(p.date), 'Só há aula às terças e quintas.');
      const prev = s.days[p.date];
      const status = p.status === 'cancelada' ? 'cancelada' : 'agendada';
      if (status === 'agendada') need(s.teachers.some((t) => t.id === p.responsible_id), 'Escolha o professor responsável.');
      s.days[p.date] = {
        responsible_id: status === 'cancelada' ? (prev && prev.responsible_id) || null : p.responsible_id,
        status, reason: clean(p.reason),
        original_id: (prev && prev.original_id) || (prev && prev.responsible_id) || null,
      };
      log(s, status === 'cancelada'
        ? 'Aula de ' + p.date + ' cancelada' + (p.reason ? ' (' + clean(p.reason) + ')' : '')
        : 'Escala de ' + p.date + ': ' + tName(s, p.responsible_id), p.date);
    },
    'day.repeat'(s, p) {
      need(s.teachers.some((t) => t.id === p.responsible_id), 'Escolha o professor.');
      need(p.from && p.to && p.from <= p.to, 'Período inválido.');
      let created = 0; const skipped = [];
      for (let d = parse(p.from); fmt(d) <= p.to; d = new Date(d.getTime() + 864e5)) {
        const ds = fmt(d); if (!isClassDay(ds)) continue;
        if (p.weekday && weekday(ds) !== Number(p.weekday)) continue;
        if (s.days[ds]) { skipped.push(ds); continue; }
        s.days[ds] = { responsible_id: p.responsible_id, status: 'agendada', reason: '', original_id: null }; created++;
      }
      log(s, 'Escala repetida: ' + tName(s, p.responsible_id) + ' (' + p.from + ' a ' + p.to + '), ' + created + ' datas');
      return { created, skipped };
    },
    'call.mark'(s, p) {
      need(['presente', 'ausente', 'justificado', 'nao_marcado'].includes(p.status), 'Status inválido.');
      const c = getCall(s, p.date, p.group); need(c.state === 'aberta', 'Chamada finalizada. Reabra para alterar.');
      c.marks[p.student_id] = { status: p.status, note: clean(p.note) };
    },
    'call.finalize'(s, p) {
      const c = getCall(s, p.date, p.group); need(c.state === 'aberta', 'Chamada já finalizada.');
      let n = 0;
      for (const st of roster(s, p.date, p.group)) {
        const m = c.marks[st.id];
        if (!m || m.status === 'nao_marcado') { c.marks[st.id] = { status: 'ausente', note: '' }; n++; }
      }
      c.state = 'finalizada'; c.finalized_at = new Date().toISOString(); c.delivered_by = clean(p.by) || null;
      log(s, 'Chamada finalizada: ' + p.date + ', Turma ' + p.group + (n ? ' (' + n + ' sem marcação viraram ausência)' : ''), p.date);
    },
    'call.reopen'(s, p) {
      const c = getCall(s, p.date, p.group); c.state = 'aberta'; c.finalized_at = null;
      log(s, 'Chamada reaberta: ' + p.date + ', Turma ' + p.group, p.date);
    },
    'request.create'(s, p) {
      need(isClassDay(p.date), 'Escolha uma terça ou quinta.'); need(p.from_id, 'Informe quem pede a substituição.');
      s.requests.push({ id: uid(), date: p.date, from_id: p.from_id, to_id: p.to_id || null, note: clean(p.note), status: 'pendente', created_at: new Date().toISOString() });
      log(s, 'Pedido de substituição para ' + p.date + ' por ' + tName(s, p.from_id), p.date);
    },
    'request.resolve'(s, p) {
      const r = s.requests.find((x) => x.id === p.id); need(r && r.status === 'pendente', 'Pedido não encontrado.');
      if (p.decision === 'aprovado') {
        const sub = p.substitute_id || r.to_id; need(sub, 'Escolha o professor substituto.');
        const prev = s.days[r.date] || {};
        s.days[r.date] = { responsible_id: sub, status: 'agendada', reason: 'Substituição', original_id: prev.original_id || prev.responsible_id || r.from_id };
        r.status = 'aprovado'; r.to_id = sub; log(s, 'Substituição aprovada em ' + r.date + ': ' + tName(s, sub), r.date);
      } else { r.status = 'recusado'; log(s, 'Substituição recusada em ' + r.date, r.date); }
    },
  };

  function apply(state, action, payload) {
    const fn = actions[action]; if (!fn) throw new Error('Ação desconhecida.');
    const copy = JSON.parse(JSON.stringify(state)); // só confirma se tudo der certo
    const extra = fn(copy, payload || {}) || {};
    copy.rev = (state.rev || 0) + 1;
    return { state: copy, extra };
  }

  const api = { CLASS_DAYS, emptyState, apply, roster, isClassDay, weekday, parse, fmt, callKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HidroCore = api;
})(typeof self !== 'undefined' ? self : this);
