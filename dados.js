// Onde os dados ficam (no próprio celular) e geração de dados de exemplo.
(function (raiz) {
  const CC = raiz.CC || require("./calculo.js");

  const CHAVES = {
    semanas: "coco-certo-historico", // pedidos de segunda (mesmo nome da versão anterior)
    diario: "coco-certo-diario",     // vendas de cada dia
    config: "coco-certo-config",
    clima: "coco-certo-clima",
  };
  const CONFIG_PADRAO = { precoCentavos: 700, custoCentavos: 250 };

  function ler(chave, padrao) {
    try { const v = JSON.parse(localStorage.getItem(chave)); return v ?? padrao; } catch (e) { return padrao; }
  }
  function gravar(chave, valor) { localStorage.setItem(chave, JSON.stringify(valor)); }

  const Dados = {
    semanas: () => { const v = ler(CHAVES.semanas, []); return Array.isArray(v) ? v : []; },
    salvarSemanas: v => gravar(CHAVES.semanas, v),
    diario: () => { const v = ler(CHAVES.diario, []); return Array.isArray(v) ? v : []; },
    salvarDiario: v => gravar(CHAVES.diario, v.slice().sort((a, b) => a.data.localeCompare(b.data))),
    config: () => Object.assign({}, CONFIG_PADRAO, ler(CHAVES.config, {})),
    salvarConfig: v => gravar(CHAVES.config, v),
    clima: () => ler(CHAVES.clima, null),
    salvarClima: v => gravar(CHAVES.clima, v),

    anotarDia(data, vendidos, clima) {
      const d = Dados.diario().filter(r => r.data !== data);
      d.push({ data, vendidos, clima });
      Dados.salvarDiario(d);
    },

    apagarTudo() { Object.values(CHAVES).forEach(k => localStorage.removeItem(k)); },

    // ---------- cópia de segurança ----------
    copia() {
      return { app: "coco-certo", versao: 2, semanas: Dados.semanas(), diario: Dados.diario(), config: Dados.config() };
    },
    // Aceita a cópia nova e a da versão anterior (só com o histórico semanal).
    lerCopia(texto) {
      const d = JSON.parse(texto);
      if (!d || d.app !== "coco-certo") throw new Error("não é cópia do Coco Certo");
      const semanas = d.semanas || d.historico;
      const ok = Array.isArray(semanas) && semanas.every(r => r && typeof r.data === "string" && Number.isFinite(r.estoque));
      if (!ok) throw new Error("cópia com defeito");
      return { semanas, diario: Array.isArray(d.diario) ? d.diario : [], config: d.config || null };
    },
    restaurar({ semanas, diario, config }) {
      Dados.salvarSemanas(semanas);
      Dados.salvarDiario(diario);
      if (config) Dados.salvarConfig(Object.assign({}, CONFIG_PADRAO, config));
    },

    gerarExemplo,
  };

  // ---------- dados fictícios: 12 semanas usando o app ----------
  // Simula o vendedor dia a dia: procura do dia (depende do dia da semana, do tempo e de feriados),
  // estoque, entrega na terça, cocos que estragam, e o pedido que o próprio app sugeriu em cada segunda.
  function gerarExemplo(hoje = CC.iso(), semanasDeUso = 12) {
    let semente = 20261114;
    const sorteio = () => { // número pseudoaleatório fixo, para o exemplo sair sempre igual
      semente = (semente + 0x6D2B79F5) | 0;
      let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const PROCURA = [50, 18, 16, 17, 20, 26, 44]; // dom..sáb, dia de sol
    const climaDoDia = {};
    const clima = d => {
      if (!climaDoDia[d]) { const r = sorteio(); climaDoDia[d] = r < 0.13 ? "chuva" : r < 0.38 ? "nublado" : "sol"; }
      return climaDoDia[d];
    };
    const procura = d => {
      const w = CC.diaSemana(d);
      let v = PROCURA[w];
      if (CC.feriado(d) && w !== 0 && w !== 6) v = PROCURA[0] * 0.95;
      if (CC.ferias(d)) v *= 1.2;
      if (d === eventoNaPraia || d === CC.somaDias(eventoNaPraia, 1)) v *= 1.7; // fim de semana de evento
      if (clima(d) === "chuva") v *= 0.5; else if (clima(d) === "nublado") v *= 0.9;
      return Math.round(v * (0.86 + sorteio() * 0.28));
    };

    let ultimaSegunda = CC.segundaDaSemana(hoje);
    if (ultimaSegunda === hoje) ultimaSegunda = CC.somaDias(hoje, -7); // hoje fica livre para o pedido
    const primeira = CC.somaDias(ultimaSegunda, -7 * semanasDeUso);
    const UTIL = 20, FDS = 40;
    const eventoNaPraia = CC.somaDias(primeira, 7 * 6 + 5); // um sábado no meio do período

    const semanas = [], diario = [];
    let estoque = 35, semana = null;

    for (let seg = primeira; seg <= ultimaSegunda || seg < hoje; seg = CC.somaDias(seg, 7)) {
      if (seg <= ultimaSegunda) {
        const anterior = semanas[semanas.length - 1];
        const vendas = anterior ? semana.vendidos : null;
        const reais = semanas.filter(r => r.vendas != null).map(r => r.vendas);
        if (vendas != null) reais.push(vendas);
        const inicio = CC.somaDias(seg, 1);
        const chuva = {};
        for (let i = 0; i < 7; i++) { const d = CC.somaDias(inicio, i); chuva[d] = clima(d) === "chuva" ? 85 : 15; }
        const prev = CC.preverSemana({ diario, vendasReais: reais, inicio, chuva, util: UTIL, fds: FDS });
        const faltou = anterior ? semana.faltou : false;
        const pedido = CC.calcularPedido(estoque, prev.total, faltou ? CC.MARGEM_SE_FALTOU : CC.MARGEM_NORMAL, prev.vespera.previsto);
        semanas.push({
          data: seg, estoque, comprados: anterior ? semana.comprados : 0, estragados: anterior ? semana.estragados : 0,
          faltou, vendas, util: UTIL, fds: FDS, temAnterior: !!anterior, sugerido: pedido.sugerido, previsto: prev.total,
        });
        semana = { vendidos: 0, estragados: 0, faltou: false, comprados: pedido.sugerido };
      }
      for (let i = 0; i < 7; i++) {
        const d = CC.somaDias(seg, i);
        if (d >= hoje) break;
        if (i === 1) estoque += semana.comprados; // entrega na terça
        const quer = procura(d);
        const vendeu = Math.min(quer, estoque);
        if (quer > estoque) semana.faltou = true;
        estoque -= vendeu;
        semana.vendidos += vendeu;
        const estragou = estoque > 40 && sorteio() < 0.5 ? Math.round(1 + sorteio() * 2) : 0;
        estoque -= estragou;
        semana.estragados += estragou;
        diario.push({ data: d, vendidos: vendeu, clima: clima(d) });
      }
    }
    return { semanas, diario, config: Object.assign({}, CONFIG_PADRAO) };
  }

  if (typeof module !== "undefined") module.exports = Dados; else raiz.Dados = Dados;
})(this);
