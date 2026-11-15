// Regras de cálculo do Coco Certo. Sem acesso à tela: dá para testar no Node.
// Contas de dinheiro em centavos e contas de margem em inteiros, para evitar erro de arredondamento.
(function (raiz) {
  const MARGEM_NORMAL = 10;              // % de reserva
  const MARGEM_SE_FALTOU = 20;           // % quando faltou coco na semana passada
  const SEMANAS_PARA_USAR_HISTORICO = 3; // semanas com vendas reais antes de largar a estimativa
  const SEMANAS_NA_MEDIA = 4;
  const FATOR_CHUVA_PADRAO = 0.6;        // dia de chuva vende 40% menos, até o app aprender o real
  const FATOR_FERIAS = 1.2;              // férias escolares vendem 20% mais
  const CHANCE_DE_CHUVA = 60;            // % de chance a partir da qual conta como dia de chuva

  const NOMES_DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  // ---------- datas (sempre "AAAA-MM-DD", hora local) ----------
  function iso(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function deIso(s) { const [a, m, d] = s.split("-").map(Number); return new Date(a, m - 1, d); }
  function somaDias(s, n) { const d = deIso(s); d.setDate(d.getDate() + n); return iso(d); }
  function diaSemana(s) { return deIso(s).getDay(); }
  function segundaDaSemana(s) { return somaDias(s, -((diaSemana(s) + 6) % 7)); }
  function dataCurta(s) { return s.slice(8, 10) + "/" + s.slice(5, 7); }

  // ---------- feriados e férias (Brasil, Ceará e Fortaleza) ----------
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(new Date(ano, mes - 1, dia));
  }
  const FERIADOS_FIXOS = {
    "01-01": "Ano Novo", "03-19": "São José", "03-25": "Data Magna do Ceará", "04-21": "Tiradentes",
    "05-01": "Dia do Trabalho", "08-15": "Nossa Senhora da Assunção", "09-07": "Independência",
    "10-12": "Nossa Senhora Aparecida", "11-02": "Finados", "11-15": "Proclamação da República",
    "11-20": "Consciência Negra", "12-25": "Natal",
  };
  function feriado(s) {
    if (FERIADOS_FIXOS[s.slice(5)]) return FERIADOS_FIXOS[s.slice(5)];
    const p = pascoa(Number(s.slice(0, 4)));
    if (s === somaDias(p, -48) || s === somaDias(p, -47)) return "Carnaval";
    if (s === somaDias(p, -2)) return "Sexta-feira Santa";
    if (s === somaDias(p, 60)) return "Corpus Christi";
    return null;
  }
  function ferias(s) {
    const m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
    return m === 1 || m === 7 || (m === 12 && d >= 15);
  }

  // ---------- regras da semana ----------
  function demandaPorEstimativa(vendaDiaUtil, vendaFimDeSemana) {
    return 5 * vendaDiaUtil + 2 * vendaFimDeSemana;
  }

  // Vendas da semana que passou. null se os números não batem (resultado negativo).
  function vendasDaSemana(estoqueAnterior, comprados, estragados, estoqueAtual) {
    const vendas = estoqueAnterior + comprados - estragados - estoqueAtual;
    return vendas >= 0 ? vendas : null;
  }

  function demandaPorHistorico(vendasReais) {
    if (vendasReais.length < SEMANAS_PARA_USAR_HISTORICO) return null;
    const ultimas = vendasReais.slice(-SEMANAS_NA_MEDIA);
    const soma = ultimas.reduce((a, b) => a + b, 0);
    return { ultimas, media: Math.ceil(soma / ultimas.length) };
  }

  // vendaAteEntrega: cocos que ainda devem ser vendidos hoje, antes da entrega de terça.
  function calcularPedido(estoqueAgora, demandaSemanal, margemPercentual = MARGEM_NORMAL, vendaAteEntrega = 0) {
    const estoque = Math.max(0, estoqueAgora - vendaAteEntrega);
    const comMargemX100 = demandaSemanal * (100 + margemPercentual);
    const comMargem = Math.ceil(comMargemX100 / 100);
    const sugerido = Math.max(0, Math.ceil((comMargemX100 - estoque * 100) / 100));
    return { demandaSemanal, margemPercentual, comMargem, estoqueAgora, vendaAteEntrega, estoque, sugerido };
  }

  // ---------- previsão dia a dia ----------
  const media = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

  // Quanto um dia de chuva vende, comparado a um dia normal do mesmo dia da semana.
  function aprenderFatorChuva(diario) {
    const normais = [[], [], [], [], [], [], []];
    diario.forEach(r => { if (r.clima !== "chuva" && !feriado(r.data)) normais[diaSemana(r.data)].push(r.vendidos); });
    const razoes = diario
      .filter(r => r.clima === "chuva" && !feriado(r.data) && normais[diaSemana(r.data)].length)
      .map(r => r.vendidos / media(normais[diaSemana(r.data)]));
    if (razoes.length < 3) return { fator: FATOR_CHUVA_PADRAO, aprendido: false, dias: razoes.length };
    return { fator: Math.min(1, Math.max(0.3, media(razoes))), aprendido: true, dias: razoes.length };
  }

  // Prevê os 7 dias a partir de `inicio` usando só o que aconteceu antes de `inicio`.
  //   diario: [{data, vendidos, clima}]   vendasReais: vendas semanais (antiga → nova)
  //   chuva: {data: % de chance}          util/fds: estimativa do vendedor
  function preverSemana({ diario = [], vendasReais = [], inicio, chuva = {}, util = 0, fds = 0, vendasDesde = null }) {
    const antes = diario.filter(r => r.data < inicio && Number.isFinite(r.vendidos));
    const recentes = antes.filter(r => r.data >= somaDias(inicio, -28));
    const fatorChuva = aprenderFatorChuva(antes.filter(r => r.data >= somaDias(inicio, -90)));

    const porDia = [0, 1, 2, 3, 4, 5, 6].map(w => {
      const xs = recentes.filter(r => diaSemana(r.data) === w && !feriado(r.data) && r.clima !== "chuva").map(r => r.vendidos);
      return xs.length >= 2 ? media(xs) : null;
    });

    let fonte, base;
    const historico = demandaPorHistorico(vendasReais);
    if (porDia.every(v => v != null)) {
      fonte = "diario";
      base = porDia;
    } else if (historico) {
      fonte = "semanal";
      const u = util || 1, f = fds || 2; // proporção dia útil × fim de semana
      const pesos = [f, u, u, u, u, u, f];
      const soma = pesos.reduce((a, b) => a + b, 0);
      base = pesos.map(p => historico.media * p / soma);
    } else {
      fonte = "estimativa";
      base = [fds, util, util, util, util, util, fds];
    }

    const parteFerias = recentes.length ? recentes.filter(r => ferias(r.data)).length / recentes.length : 0;
    function preverDia(data) {
      const w = diaSemana(data);
      let v = base[w];
      const motivos = [];
      const nomeFeriado = feriado(data);
      if (nomeFeriado && w !== 0 && w !== 6 && base[0] > v) {
        v = base[0];
        motivos.push(`Feriado (${nomeFeriado}): vende como domingo`);
      }
      if (fonte === "diario" && ferias(data) && parteFerias < 0.5) {
        v *= FATOR_FERIAS;
        motivos.push("Férias escolares: +20%");
      } else if (fonte === "diario" && !ferias(data) && parteFerias >= 0.5) {
        v /= FATOR_FERIAS;
        motivos.push("Acabaram as férias: −20%");
      }
      const chance = chuva[data];
      const vaiChover = chance != null && chance >= CHANCE_DE_CHUVA;
      if (vaiChover) {
        v *= fatorChuva.fator;
        motivos.push(`Chuva prevista: −${Math.round((1 - fatorChuva.fator) * 100)}%`);
      }
      return { data, diaSemana: w, previsto: Math.round(v), feriado: nomeFeriado, chance, vaiChover, motivos };
    }
    const dias = [0, 1, 2, 3, 4, 5, 6].map(i => preverDia(somaDias(inicio, i)));
    // Até a entrega: o que ainda deve sair do estoque entre `vendasDesde` (padrão: véspera) e o dia da entrega.
    const diasAteEntrega = [];
    for (let d = vendasDesde || somaDias(inicio, -1); d < inicio; d = somaDias(d, 1)) diasAteEntrega.push(preverDia(d));
    const vespera = { dias: diasAteEntrega, previsto: diasAteEntrega.reduce((a, d) => a + d.previsto, 0) };
    return { fonte, dias, vespera, total: dias.reduce((a, d) => a + d.previsto, 0), fatorChuva, historico };
  }

  // ---------- relatório ----------
  function relatorio({ semanas = [], diario = [], config, desde = null }) {
    const ss = semanas.filter(r => r.temAnterior && (!desde || r.data >= desde));
    const comVendas = ss.filter(r => r.vendas != null);
    const vendidos = comVendas.reduce((a, r) => a + r.vendas, 0);
    const comprados = ss.reduce((a, r) => a + (r.comprados || 0), 0);
    const estragados = ss.reduce((a, r) => a + (r.estragados || 0), 0);
    const faturamento = vendidos * config.precoCentavos;
    const gastoCompras = comprados * config.custoCentavos;
    const noPonto = comVendas.filter(r => !r.faltou && r.estragados <= Math.max(3, Math.round(r.comprados * 0.03))).length;

    const dd = diario.filter(r => (!desde || r.data >= desde) && Number.isFinite(r.vendidos));
    const porDia = [0, 1, 2, 3, 4, 5, 6].map(w => {
      const xs = dd.filter(r => diaSemana(r.data) === w && !feriado(r.data)).map(r => r.vendidos);
      return xs.length ? Math.round(media(xs)) : null;
    });
    const porClima = {};
    ["sol", "nublado", "chuva"].forEach(c => {
      const xs = dd.filter(r => r.clima === c && !feriado(r.data)).map(r => r.vendidos);
      porClima[c] = xs.length ? { media: Math.round(media(xs)), dias: xs.length } : null;
    });

    return {
      semanas: ss, numSemanas: comVendas.length, vendidos, comprados, estragados,
      faturamento, gastoCompras, lucro: faturamento - gastoCompras, perdaEstragados: estragados * config.custoCentavos,
      faltas: ss.filter(r => r.faltou).length, noPonto,
      mediaSemanal: comVendas.length ? Math.round(vendidos / comVendas.length) : 0,
      porDia, porClima, fatorChuva: aprenderFatorChuva(dd),
    };
  }

  function reais(centavos) {
    return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  const CC = {
    MARGEM_NORMAL, MARGEM_SE_FALTOU, SEMANAS_PARA_USAR_HISTORICO, SEMANAS_NA_MEDIA,
    FATOR_CHUVA_PADRAO, FATOR_FERIAS, CHANCE_DE_CHUVA, NOMES_DIAS, DIAS_CURTOS,
    iso, deIso, somaDias, diaSemana, segundaDaSemana, dataCurta, pascoa, feriado, ferias,
    demandaPorEstimativa, vendasDaSemana, demandaPorHistorico, calcularPedido,
    aprenderFatorChuva, preverSemana, relatorio, reais,
  };
  if (typeof module !== "undefined") module.exports = CC; else raiz.CC = CC;
})(this);
