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
  const FERIADOS_NACIONAIS = {
    "01-01": "Ano Novo", "04-21": "Tiradentes", "05-01": "Dia do Trabalho", "09-07": "Independência",
    "10-12": "Nossa Senhora Aparecida", "11-02": "Finados", "11-15": "Proclamação da República",
    "11-20": "Consciência Negra", "12-25": "Natal",
  };
  // Feriados estaduais de data fixa (os que mudam de data todo ano ficam de fora).
  const FERIADOS_ESTADUAIS = {
    AC: { "01-23": "Dia do Evangélico", "06-15": "Aniversário do Acre", "09-05": "Dia da Amazônia", "11-17": "Tratado de Petrópolis" },
    AL: { "06-24": "São João", "06-29": "São Pedro", "09-16": "Emancipação de Alagoas" },
    AP: { "03-19": "São José", "09-13": "Criação do Amapá" },
    AM: { "09-05": "Elevação do Amazonas" },
    BA: { "07-02": "Independência da Bahia" },
    CE: { "03-19": "São José", "03-25": "Data Magna do Ceará" },
    DF: { "11-30": "Dia do Evangélico" },
    MA: { "07-28": "Adesão do Maranhão" },
    MS: { "10-11": "Criação de Mato Grosso do Sul" },
    PA: { "08-15": "Adesão do Pará" },
    PB: { "08-05": "Fundação da Paraíba" },
    PE: { "03-06": "Revolução Pernambucana" },
    PI: { "10-19": "Dia do Piauí" },
    PR: { "12-19": "Emancipação do Paraná" },
    RJ: { "04-23": "São Jorge" },
    RN: { "10-03": "Mártires de Cunhaú e Uruaçu" },
    RO: { "01-04": "Criação de Rondônia", "06-18": "Dia do Evangélico" },
    RR: { "10-05": "Criação de Roraima" },
    RS: { "09-20": "Revolução Farroupilha" },
    SE: { "07-08": "Emancipação de Sergipe" },
    SP: { "07-09": "Revolução Constitucionalista" },
    TO: { "09-08": "Nossa Senhora da Natividade", "10-05": "Criação do Tocantins" },
  };
  const FERIADOS_MUNICIPAIS = { "fortaleza|CE": { "08-15": "Nossa Senhora da Assunção" } };
  const UFS = {
    "acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM", "bahia": "BA", "ceara": "CE",
    "distrito federal": "DF", "espirito santo": "ES", "goias": "GO", "maranhao": "MA", "mato grosso": "MT",
    "mato grosso do sul": "MS", "minas gerais": "MG", "para": "PA", "paraiba": "PB", "parana": "PR",
    "pernambuco": "PE", "piaui": "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN",
    "rio grande do sul": "RS", "rondonia": "RO", "roraima": "RR", "santa catarina": "SC",
    "sao paulo": "SP", "sergipe": "SE", "tocantins": "TO",
  };
  const semAcento = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  function ufDoEstado(nome) { return UFS[semAcento(nome)] || null; }

  // Onde fica a banca: decide feriados estaduais/municipais e os dias especiais do vendedor.
  // extras: {"AAAA-MM-DD": nome} para um dia só, {"MM-DD": nome} para todo ano.
  let LOCAL = { uf: "CE", cidade: "Fortaleza", extras: {} };
  function definirLocal({ uf = null, cidade = null, extras = {} } = {}) { LOCAL = { uf, cidade, extras }; }

  function feriado(s) {
    const md = s.slice(5);
    if (LOCAL.extras[s]) return LOCAL.extras[s];
    if (LOCAL.extras[md]) return LOCAL.extras[md];
    if (FERIADOS_NACIONAIS[md]) return FERIADOS_NACIONAIS[md];
    const est = FERIADOS_ESTADUAIS[LOCAL.uf];
    if (est && est[md]) return est[md];
    const mun = FERIADOS_MUNICIPAIS[semAcento(LOCAL.cidade) + "|" + LOCAL.uf];
    if (mun && mun[md]) return mun[md];
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

    // Média de cada dia da semana nas últimas 4 semanas; se tiver pouco, olha até 8 semanas.
    const normaisDe = (w, dias) => antes
      .filter(r => r.data >= somaDias(inicio, -dias) && diaSemana(r.data) === w && !feriado(r.data) && r.clima !== "chuva")
      .map(r => r.vendidos);
    const porDia = [0, 1, 2, 3, 4, 5, 6].map(w => {
      let xs = normaisDe(w, 28);
      if (xs.length < 2) xs = normaisDe(w, 56).slice(-2);
      return xs.length >= 2 ? media(xs) : null;
    });

    // Semanas inteiras anotadas dia a dia também valem como vendas da semana.
    const porSemana = {};
    antes.forEach(r => { const s = segundaDaSemana(r.data); (porSemana[s] = porSemana[s] || []).push(r.vendidos); });
    const semanasDoDiario = Object.keys(porSemana).sort().filter(s => porSemana[s].length === 7)
      .map(s => porSemana[s].reduce((a, b) => a + b, 0));
    const reaisUsadas = vendasReais.length >= SEMANAS_PARA_USAR_HISTORICO ? vendasReais : vendasReais.concat(semanasDoDiario);

    let fonte, base;
    const historico = demandaPorHistorico(reaisUsadas);
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
    // Semana lançada à mão sem o número de comprados: considera vendidos + estragados.
    const compradosDe = r => r.comprados ?? ((r.vendas || 0) + (r.estragados || 0));
    const comprados = ss.reduce((a, r) => a + compradosDe(r), 0);
    const estragados = ss.reduce((a, r) => a + (r.estragados || 0), 0);
    const faturamento = vendidos * config.precoCentavos;
    const gastoCompras = comprados * config.custoCentavos;
    const noPonto = comVendas.filter(r => !r.faltou && r.estragados <= Math.max(3, Math.round(compradosDe(r) * 0.03))).length;

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

  // O que os números mostram: frases curtas, da mais importante para a menos importante.
  function insights({ semanas = [], diario = [], config, desde = null }) {
    const rel = relatorio({ semanas, diario, config, desde });
    const lista = [];
    const add = (peso, emoji, texto) => lista.push({ peso, emoji, texto });
    const n = rel.numSemanas;

    if (rel.faltas) add(90, "⚠️", `Faltou coco em <b>${rel.faltas} ${rel.faltas === 1 ? "semana" : "semanas"}</b>. Depois de uma falta, o app pede ${MARGEM_SE_FALTOU}% a mais.`);
    if (rel.estragados && n) {
      const porSemana = rel.estragados / n;
      const ano = Math.round(rel.perdaEstragados / n * 52);
      add(porSemana > 8 ? 85 : 30, "🗑️", `Estragam uns <b>${Math.round(porSemana)} cocos por semana</b>. Em um ano, isso dá <b>${reais(ano)}</b> jogados fora.${porSemana > 8 ? " Guarde os cocos na sombra e venda os mais antigos primeiro." : ""}`);
    }
    const vs = semanas.filter(r => r.vendas != null).map(r => r.vendas);
    if (vs.length >= 8) {
      const a = vs.slice(-4).reduce((x, y) => x + y, 0), b = vs.slice(-8, -4).reduce((x, y) => x + y, 0);
      const pct = Math.round((a - b) / b * 100);
      if (Math.abs(pct) >= 3) add(Math.abs(pct) >= 10 ? 70 : 35, pct > 0 ? "📈" : "📉", `Nas últimas 4 semanas você vendeu <b>${Math.abs(pct)}% ${pct > 0 ? "mais" : "menos"}</b> que nas 4 anteriores.`);
    }
    const comDia = rel.porDia.map((v, w) => [v, w]).filter(([v]) => v != null);
    if (comDia.length >= 5) {
      const [mv, mw] = comDia.reduce((a, b) => (b[0] > a[0] ? b : a));
      const [pv, pw] = comDia.reduce((a, b) => (b[0] < a[0] ? b : a));
      add(60, "🏆", `<b>${NOMES_DIAS[mw]}</b> é seu melhor dia: vende uns ${mv} cocos. O mais fraco é ${NOMES_DIAS[pw].toLowerCase()}, com ${pv}.`);
    }
    if (comDia.length === 7) {
      const total = comDia.reduce((a, [v]) => a + v, 0);
      const fds = Math.round((rel.porDia[0] + rel.porDia[6]) / total * 100);
      add(50, "🏖️", `Sábado e domingo trazem <b>${fds}%</b> das suas vendas da semana.`);
    }
    // Feriado em dia útil comparado ao mesmo dia da semana comum
    const dd = diario.filter(r => (!desde || r.data >= desde) && Number.isFinite(r.vendidos));
    const razoesFeriado = dd.filter(r => feriado(r.data) && diaSemana(r.data) >= 1 && diaSemana(r.data) <= 5 && rel.porDia[diaSemana(r.data)])
      .map(r => r.vendidos / rel.porDia[diaSemana(r.data)]);
    if (razoesFeriado.length) {
      const x = media(razoesFeriado);
      if (x >= 1.3) add(55, "🎉", `Em feriado você vende cerca de <b>${x.toFixed(1).replace(".", ",")} vezes</b> o de um dia comum. O app já conta isso.`);
    }
    if (rel.fatorChuva.aprendido) add(50, "🌧️", `Em dia de chuva você vende cerca de <b>${Math.round((1 - rel.fatorChuva.fator) * 100)}% menos</b>. Quando a previsão é de chuva, o app pede menos.`);
    // Acerto da previsão: o previsto num pedido contra o vendido na semana seguinte (sem semanas de falta)
    const erros = [];
    for (let i = 0; i + 1 < semanas.length; i++) {
      const a = semanas[i], b = semanas[i + 1];
      if (a.previsto == null || b.vendas == null || b.faltou || b.importado || (desde && b.data < desde)) continue;
      erros.push({ abs: Math.abs(b.vendas - a.previsto), base: b.vendas });
    }
    if (erros.length >= 2) {
      const e = Math.round(media(erros.map(x => x.abs)));
      const p = Math.round(100 * erros.reduce((s, x) => s + x.abs, 0) / erros.reduce((s, x) => s + x.base, 0));
      add(45, "🎯", `A previsão do app errou, em média, <b>${e} cocos por semana</b> (${p}%).${p <= 10 ? " Está acertando bem." : " Anotar as vendas do dia ajuda a acertar mais."}`);
    }
    if (n) add(40, "💰", `Sobram em média <b>${reais(Math.round(rel.lucro / n))} por semana</b> depois de pagar os cocos.`);
    const comVenda = rel.semanas.filter(r => r.vendas != null);
    if (comVenda.length >= 4) {
      const melhor = comVenda.reduce((a, b) => (b.vendas > a.vendas ? b : a));
      add(25, "⭐", `Sua melhor semana foi a do pedido de ${dataCurta(melhor.data)}, com <b>${melhor.vendas} cocos</b>.`);
    }
    if (n >= 3 && !rel.faltas) add(20, "👏", `${rel.noPonto} de ${n} semanas ficaram no ponto: sem faltar coco e quase sem estragar.`);
    return { rel, lista: lista.sort((a, b) => b.peso - a.peso) };
  }

  function reais(centavos) {
    return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  const CC = {
    MARGEM_NORMAL, MARGEM_SE_FALTOU, SEMANAS_PARA_USAR_HISTORICO, SEMANAS_NA_MEDIA,
    FATOR_CHUVA_PADRAO, FATOR_FERIAS, CHANCE_DE_CHUVA, NOMES_DIAS, DIAS_CURTOS,
    iso, deIso, somaDias, diaSemana, segundaDaSemana, dataCurta, pascoa, feriado, ferias,
    definirLocal, ufDoEstado, semAcento, SIGLAS_UF: Object.values(UFS).sort(),
    demandaPorEstimativa, vendasDaSemana, demandaPorHistorico, calcularPedido,
    aprenderFatorChuva, preverSemana, relatorio, insights, reais,
  };
  if (typeof module !== "undefined") module.exports = CC; else raiz.CC = CC;
})(this);
