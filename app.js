// Telas do Coco Certo. Regras em calculo.js, dados em dados.js.
(function () {
  const $ = id => document.getElementById(id);
  const hoje = () => CC.iso();
  const conteudo = $("conteudo");

  const estado = {
    tela: "inicio",
    etapaPedido: "registro", // registro | resultado | explicacao
    ultimoCalculo: null,
    anotandoDia: false,
    diaAnotar: null,
    respostas: null,         // respostas do pedido em andamento
    passo: 0,
    periodo: 28,             // dias do relatório (null = tudo)
    instalar: null,          // evento do Android para instalar o app
  };

  const EMOJI_CLIMA = { sol: "☀️", nublado: "⛅", chuva: "🌧️" };
  const NOME_CLIMA = { sol: "Sol", nublado: "Nublado", chuva: "Chuva" };

  // ---------- ajudantes ----------
  function formatarDecimal(n) { return n.toFixed(2).replace(".", ","); }
  function lerNumero(id) {
    const e = $(id);
    if (!e) return 0;
    if (e.dataset.decimal) {
      const n = parseFloat(e.value.replace(/[^\d,]/g, "").replace(",", "."));
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    const n = parseInt(e.value.replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  function campoNumero(id, rotulo, valor = 0, { passo = 1, decimal = false } = {}) {
    return `
      <div class="campo">
        <label for="${id}">${rotulo}</label>
        <div class="contador">
          <button type="button" data-alvo="${id}" data-passo="-${passo}" aria-label="Diminuir">−</button>
          <input id="${id}" type="text" inputmode="${decimal ? "decimal" : "numeric"}" value="${decimal ? formatarDecimal(valor) : valor}"${decimal ? ' data-decimal="1"' : ""} autocomplete="off">
          <button type="button" data-alvo="${id}" data-passo="${passo}" aria-label="Aumentar">+</button>
        </div>
      </div>`;
  }
  function escolha(grupo, opcoes, marcado) {
    return `<div class="escolha" data-grupo="${grupo}">` + opcoes.map(([valor, texto, emoji]) =>
      `<button type="button" data-valor="${valor}" class="${valor === marcado ? "marcado" : ""}">${emoji ? `<span class="emoji">${emoji}</span>` : ""}${texto}</button>`
    ).join("") + `</div>`;
  }
  function valorEscolha(grupo) {
    const b = document.querySelector(`[data-grupo="${grupo}"] .marcado`);
    return b ? b.dataset.valor : null;
  }
  function avisar(texto) {
    const t = document.createElement("div");
    t.className = "aviso-toast";
    t.textContent = texto;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function diaComNome(data) {
    const w = CC.diaSemana(data);
    if (data === hoje()) return "Hoje";
    if (data === CC.somaDias(hoje(), -1)) return "Ontem";
    return `${CC.NOMES_DIAS[w]}, ${CC.dataCurta(data)}`;
  }
  function saudacao() {
    const h = new Date().getHours();
    return h < 12 ? "Bom dia!" : h < 18 ? "Boa tarde!" : "Boa noite!";
  }

  // ---------- dados de apoio ----------
  function semanasAnteriores() {
    const h = Dados.semanas();
    return h.length && h[h.length - 1].data === hoje() ? h.slice(0, -1) : h;
  }
  function registroDeHoje() {
    const h = Dados.semanas();
    return h.length && h[h.length - 1].data === hoje() ? h[h.length - 1] : null;
  }
  const vendasReais = rs => rs.filter(r => r.vendas != null).map(r => r.vendas);
  function chancesDeChuva() { const c = Dados.clima(); return c ? c.dias : {}; }
  function proximaSegunda() {
    const s = CC.segundaDaSemana(hoje());
    return s > hoje() ? s : CC.somaDias(s, 7);
  }

  // Previsão do tempo para a Praia do Futuro (Open-Meteo, gratuito, sem cadastro).
  async function atualizarClima() {
    const c = Dados.clima();
    if (c && c.buscadoEm === hoje()) return;
    try {
      const url = "https://api.open-meteo.com/v1/forecast?latitude=-3.74&longitude=-38.45" +
        "&daily=precipitation_probability_max&timezone=America%2FFortaleza&forecast_days=10";
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const j = await r.json();
      const dias = {};
      j.daily.time.forEach((d, i) => { dias[d] = j.daily.precipitation_probability_max[i]; });
      Dados.salvarClima({ buscadoEm: hoje(), dias });
      if (estado.tela === "inicio") mostrar("inicio");
    } catch (e) { /* sem internet: segue sem previsão do tempo */ }
  }

  // Estoque estimado agora: o da última segunda + entrega de terça − vendas anotadas.
  function estoqueEstimado() {
    const ult = Dados.semanas().slice(-1)[0];
    if (!ult) return null;
    let est = ult.estoque;
    if (CC.somaDias(ult.data, 1) <= hoje()) est += ult.sugerido;
    let diasSemAnotar = 0;
    for (let d = ult.data; d <= hoje(); d = CC.somaDias(d, 1)) {
      const r = Dados.diario().find(x => x.data === d);
      if (r) est -= r.vendidos; else if (d < hoje()) diasSemAnotar++;
    }
    return { valor: Math.max(0, est), diasSemAnotar };
  }

  // =====================================================================
  // INÍCIO — primeiro a tarefa do dia, depois o resumo
  // =====================================================================
  function telaInicio() {
    const diario = Dados.diario();
    const anotadoHoje = diario.find(r => r.data === hoje());
    const ult = Dados.semanas().slice(-1)[0];
    const ehSegunda = CC.diaSemana(hoje()) === 1;
    const pedidoHoje = registroDeHoje();
    let html = `<h1>${saudacao()}</h1>`;

    // 1. A tarefa principal do dia (uma só, bem grande)
    if (!ult && !diario.length) {
      html += `
        <div class="tarefa">
          <div class="tarefa-emoji">👋</div>
          <div class="tarefa-titulo">Bem-vindo ao Coco Certo</div>
          <p>Toda segunda, o app diz quantos cocos comprar na terça. Comece pelo primeiro pedido.</p>
          <button class="botao amarelo" data-acao="ir-pedido">🛒 Fazer o primeiro pedido</button>
          <button class="link-botao" data-acao="carregar-exemplo">Prefiro ver um exemplo antes</button>
        </div>`;
    } else if (ehSegunda && !pedidoHoje) {
      html += `
        <div class="tarefa">
          <div class="tarefa-emoji">📣</div>
          <div class="tarefa-titulo">Hoje é dia de fazer o pedido</div>
          <p>São poucas perguntas. Leva 1 minuto.</p>
          <button class="botao amarelo" data-acao="ir-pedido">🛒 Fazer o pedido</button>
        </div>`;
    }

    const precisaAnotar = !anotadoHoje || estado.anotandoDia;
    if (precisaAnotar) {
      html += formularioDoDia(diario, anotadoHoje);
    } else {
      html += `
        <div class="cartao sucesso">
          <div class="titulo-cartao"><span class="emoji">✅</span>Vendas de hoje anotadas</div>
          <div class="grande">${anotadoHoje.vendidos} <span class="pequeno suave">cocos · ${EMOJI_CLIMA[anotadoHoje.clima] || ""} ${NOME_CLIMA[anotadoHoje.clima] || ""}</span></div>
          <button class="link-botao" data-acao="anotar-dia">✏️ Corrigir ou anotar outro dia</button>
        </div>`;
    }

    // 2. Resumo
    let resumo = "";
    if (ult) {
      const seg = CC.segundaDaSemana(hoje());
      const vendidosSemana = diario.filter(r => r.data >= seg && r.data <= hoje()).reduce((a, r) => a + r.vendidos, 0);
      const est = estoqueEstimado();
      resumo += `
        <div class="cartao">
          <div class="titulo-cartao"><span class="emoji">📦</span>Esta semana</div>
          <div class="linha"><span>Vendidos desde segunda</span><b>${vendidosSemana}</b></div>
          ${est ? `<div class="linha"><span>Cocos no estoque <span class="suave pequeno">(estimado)</span></span><b>${est.valor}</b></div>` : ""}
          <div class="linha"><span>Último pedido <span class="suave pequeno">(${CC.dataCurta(ult.data)})</span></span><b>${ult.sugerido}</b></div>
          <div class="linha"><span>Próximo pedido</span><b>${pedidoHoje ? "feito ✓" : diaComNome(proximaSegunda())}</b></div>
          ${est && est.diasSemAnotar ? `<p class="nota">⚠️ ${est.diasSemAnotar} ${est.diasSemAnotar === 1 ? "dia" : "dias"} sem anotar vendas. O estoque estimado pode estar alto.</p>` : ""}
        </div>`;
    }
    const chances = chancesDeChuva();
    const dias = [0, 1, 2, 3, 4, 5, 6].map(i => CC.somaDias(hoje(), i));
    if (dias.some(d => chances[d] != null)) {
      resumo += `
        <div class="cartao">
          <div class="titulo-cartao"><span class="emoji">🌤️</span>Tempo na Praia do Futuro</div>
          <div class="tempo">${dias.map(d => {
            const c = chances[d];
            const em = c == null ? "–" : c >= CC.CHANCE_DE_CHUVA ? "🌧️" : c >= 30 ? "⛅" : "☀️";
            return `<div class="${CC.feriado(d) ? "feriado" : ""}">${d === hoje() ? "Hoje" : CC.DIAS_CURTOS[CC.diaSemana(d)]}<span class="emoji">${em}</span>${c == null ? "" : c + "%"}</div>`;
          }).join("")}</div>
          <p class="nota">Chance de chuva. Com mais de ${CC.CHANCE_DE_CHUVA}%, o pedido já conta que vai vender menos.</p>
        </div>`;
    }
    if (resumo) html += `<div class="grade">${resumo}</div>`;
    return html;
  }

  function formularioDoDia(diario, anotadoHoje) {
    const outroDia = estado.anotandoDia && estado.diaAnotar && estado.diaAnotar !== hoje();
    const data = estado.anotandoDia ? (estado.diaAnotar || hoje()) : hoje();
    const reg = diario.find(r => r.data === data);
    const opcoes = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const d = CC.somaDias(hoje(), -i);
      const ja = diario.find(r => r.data === d);
      return `<option value="${d}"${d === data ? " selected" : ""}>${diaComNome(d)}${ja ? ` — anotado: ${ja.vendidos}` : ""}</option>`;
    }).join("");
    return `
      <div class="cartao">
        <div class="titulo-cartao"><span class="emoji">📝</span>${data === hoje() ? "Anote as vendas de hoje" : "Anotar vendas"}</div>
        ${estado.anotandoDia ? `<div class="campo"><label for="dia-anotar">Qual dia?</label><select id="dia-anotar" class="grande-select">${opcoes}</select></div>` : ""}
        ${campoNumero("vendidos-dia", "Quantos cocos você vendeu?", reg ? reg.vendidos : 0)}
        <div class="campo"><span class="pergunta">Como estava o tempo?</span>
          ${escolha("clima", [["sol", "Sol", "☀️"], ["nublado", "Nublado", "⛅"], ["chuva", "Chuva", "🌧️"]], reg ? reg.clima : "sol")}</div>
        <button class="botao verde" data-acao="salvar-dia">💾 Salvar</button>
        ${estado.anotandoDia
          ? (anotadoHoje || outroDia ? `<button class="link-botao" data-acao="cancelar-dia">Cancelar</button>` : "")
          : `<button class="link-botao" data-acao="anotar-dia">Esqueceu algum dia? Anotar outro dia</button>`}
      </div>`;
  }

  // =====================================================================
  // PEDIDO — uma pergunta por tela
  // =====================================================================
  function contextoPedido() {
    const anteriores = semanasAnteriores();
    const anterior = anteriores[anteriores.length - 1];
    const deHoje = registroDeHoje();
    const ultimo = deHoje || anterior;
    const reais = vendasReais(anteriores);
    const util = ultimo ? ultimo.util : 0, fds = ultimo ? ultimo.fds : 0;
    const previa = CC.preverSemana({ diario: Dados.diario(), vendasReais: reais, inicio: proximaTerca(), util, fds });
    return { anteriores, anterior, deHoje, util, fds, precisaEstimativa: previa.fonte === "estimativa" };
  }

  function perguntasDoPedido(ctx) {
    const { anterior, deHoje } = ctx;
    const ps = [];
    if (anterior) {
      ps.push({ id: "comprados", emoji: "🚚", titulo: "Quantos cocos chegaram na terça passada?",
        dica: `O app tinha sugerido ${anterior.sugerido}. Se comprou isso, é só tocar em Próximo.`,
        padrao: deHoje ? deHoje.comprados : anterior.sugerido });
      ps.push({ id: "estragados", emoji: "🗑️", titulo: "Quantos cocos estragaram na semana?",
        dica: "Os que foram jogados fora. Se nenhum, deixe 0.", padrao: deHoje ? deHoje.estragados : 0 });
      ps.push({ id: "faltou", tipo: "simnao", emoji: "😟", titulo: "Faltou coco para algum cliente na semana?",
        dica: "Se sim, o app pede um pouco mais desta vez.", padrao: deHoje && deHoje.faltou ? "sim" : "nao" });
    }
    ps.push({ id: "estoque", emoji: "🥥", titulo: "Conte os cocos bons que você tem agora.",
      dica: "Não conte os estragados.", padrao: deHoje ? deHoje.estoque : 0 });
    if (ctx.precisaEstimativa) {
      ps.push({ id: "util", emoji: "📅", titulo: "Num dia de semana, quantos cocos você vende?",
        dica: "De segunda a sexta. Pode ser um número aproximado.", padrao: ctx.util });
      ps.push({ id: "fds", emoji: "🏖️", titulo: "Num sábado ou domingo, quantos cocos você vende?",
        dica: "Pode ser um número aproximado.", padrao: ctx.fds });
    }
    return ps;
  }

  function telaPedido() {
    if (estado.etapaPedido === "resultado" && estado.ultimoCalculo) return `<div class="estreito">${telaResultado()}</div>`;
    if (estado.etapaPedido === "explicacao" && estado.ultimoCalculo) return `<div class="estreito">${telaExplicacao()}</div>`;

    const ctx = contextoPedido();
    const ps = perguntasDoPedido(ctx);
    if (!estado.respostas) {
      estado.respostas = {};
      ps.forEach(p => { estado.respostas[p.id] = p.padrao; });
      estado.passo = 0;
    }
    const i = Math.min(estado.passo, ps.length - 1);
    const p = ps[i];
    const ultima = i === ps.length - 1;
    const valor = estado.respostas[p.id];

    let corpo;
    if (p.tipo === "simnao") {
      corpo = `<div class="escolha grande-escolha" data-grupo="resposta">
          <button type="button" data-acao="responder" data-valor="nao" class="${valor === "nao" ? "marcado" : ""}"><span class="emoji">👍</span>Não</button>
          <button type="button" data-acao="responder" data-valor="sim" class="${valor === "sim" ? "marcado" : ""}"><span class="emoji">👎</span>Sim</button>
        </div>`;
    } else {
      corpo = campoNumero("resposta", p.titulo, valor, {}).replace('<label for="resposta">', '<label for="resposta" class="so-leitor">');
    }
    return `
      <div class="estreito">
        <div class="progresso" aria-label="Pergunta ${i + 1} de ${ps.length}">
          <div class="progresso-texto">Pedido da semana · pergunta ${i + 1} de ${ps.length}</div>
          <div class="progresso-barra"><span style="width:${Math.round(100 * (i + 1) / ps.length)}%"></span></div>
        </div>
        <div class="pergunta-tela">
          <div class="pergunta-emoji">${p.emoji}</div>
          <h1 class="pergunta-titulo">${p.titulo}</h1>
          ${corpo}
          <p class="dica">💡 ${p.dica}</p>
          <p id="erro" class="erro" hidden></p>
        </div>
        ${p.tipo === "simnao" ? "" : `<button class="botao ${ultima ? "verde" : ""}" data-acao="proximo">${ultima ? "🛒 Ver quantos comprar" : "Próximo →"}</button>`}
        ${i > 0 ? `<button class="botao secundario" data-acao="anterior">← Voltar</button>` : ""}
      </div>`;
  }

  function guardarResposta() {
    const ps = perguntasDoPedido(contextoPedido());
    const p = ps[Math.min(estado.passo, ps.length - 1)];
    if (p.tipo !== "simnao") estado.respostas[p.id] = lerNumero("resposta");
    return ps;
  }
  function avancar() {
    const ps = guardarResposta();
    const p = ps[Math.min(estado.passo, ps.length - 1)];
    if (p.id === "fds" && !estado.respostas.util && !estado.respostas.fds) {
      $("erro").textContent = "Coloque pelo menos um número de vendas.";
      $("erro").hidden = false;
      return;
    }
    if (estado.passo >= ps.length - 1) return calcular();
    estado.passo++;
    mostrar("pedido");
    focarResposta();
  }
  function focarResposta() {
    const campo = $("resposta");
    if (campo && window.matchMedia("(pointer: fine)").matches) campo.select();
  }

  function calcular() {
    const ctx = contextoPedido();
    const { anteriores, anterior } = ctx;
    const res = estado.respostas;
    const estoque = res.estoque || 0;
    const util = ctx.precisaEstimativa ? (res.util || 0) : ctx.util;
    const fds = ctx.precisaEstimativa ? (res.fds || 0) : ctx.fds;
    const comprados = anterior ? res.comprados || 0 : 0;
    const estragados = anterior ? res.estragados || 0 : 0;
    const faltou = anterior ? res.faltou === "sim" : false;

    const vendas = anterior ? CC.vendasDaSemana(anterior.estoque, comprados, estragados, estoque) : null;
    const reais = vendasReais(anteriores);
    if (vendas != null) reais.push(vendas);

    const diario = Dados.diario();
    const jaVendeuHoje = diario.some(r => r.data === hoje());
    const prev = CC.preverSemana({
      diario, vendasReais: reais, inicio: proximaTerca(), chuva: chancesDeChuva(), util, fds,
      vendasDesde: jaVendeuHoje ? CC.somaDias(hoje(), 1) : hoje(),
    });
    const margem = faltou ? CC.MARGEM_SE_FALTOU : CC.MARGEM_NORMAL;
    const r = CC.calcularPedido(estoque, prev.total, margem, prev.vespera.previsto);

    Dados.salvarSemanas(anteriores.concat({
      data: hoje(), estoque, comprados, estragados, faltou, vendas, util, fds,
      temAnterior: !!anterior, sugerido: r.sugerido, previsto: prev.total,
    }));
    estado.ultimoCalculo = { r, prev, vendas, anterior, comprados, estragados, estoque, util, fds, faltou, margem };
    estado.etapaPedido = "resultado";
    mostrar("pedido");
  }

  function telaResultado() {
    const { r, anterior, vendas } = estado.ultimoCalculo;
    const config = Dados.config();
    return `
      ${anterior && vendas == null ? `<div class="alerta">Os números da semana passada não batem (deu venda negativa). Essa semana não entrou na conta. Confira e corrija.</div>` : ""}
      ${r.vendaAteEntrega > r.estoqueAgora ? `<div class="alerta">Seus ${r.estoqueAgora} cocos não devem dar até a entrega de terça. Faltam uns ${r.vendaAteEntrega - r.estoqueAgora}. Se der, compre um pouco antes.</div>` : ""}
      <div class="resultado">
        <div class="topo-res">🛒 Compre na terça (${CC.dataCurta(proximaTerca())})</div>
        <div class="corpo">
          <div class="numero">${r.sugerido}</div>
          <div class="rotulo">cocos</div>
          ${r.sugerido === 0
            ? `<p class="custo">Você já tem cocos suficientes para a semana.</p>`
            : `<p class="custo">Vai custar cerca de <b>${CC.reais(r.sugerido * config.custoCentavos)}</b></p>`}
        </div>
      </div>
      <button class="botao" data-acao="explicar">❓ Por que esse número?</button>
      ${r.sugerido > 0 ? `<button class="botao verde" data-acao="whatsapp-pedido">💬 Mandar pedido no WhatsApp</button>` : ""}
      <button class="botao secundario" data-acao="refazer">✏️ Mudar os números</button>`;
  }
  function proximaTerca() {
    let d = CC.somaDias(hoje(), 1);
    while (CC.diaSemana(d) !== 2) d = CC.somaDias(d, 1);
    return d;
  }

  function telaExplicacao() {
    const { r, prev, vendas, anterior, comprados, estragados, estoque, util, fds, faltou, margem } = estado.ultimoCalculo;
    let p = "";
    if (vendas != null) {
      p += `<div class="passo">Semana passada você vendeu:<br>${anterior.estoque} que tinha + ${comprados} comprados − ${estragados} estragados − ${estoque} de agora = <b>${vendas}</b> cocos</div>`;
    }
    const intro = {
      diario: "Previsão de cada dia, pela média das últimas 4 semanas:",
      semanal: `Média das últimas ${prev.historico ? prev.historico.ultimas.length : ""} semanas (${prev.historico ? prev.historico.ultimas.join(", ") : ""}), dividida pelos dias:`,
      estimativa: `Pelo que você acha que vende (${util} por dia na semana, ${fds} no fim de semana):`,
    }[prev.fonte];
    p += `<div class="passo">${intro}${prev.dias.map(d => `
        <div class="dia-prev"><span>${CC.DIAS_CURTOS[d.diaSemana]} ${CC.dataCurta(d.data)} ${d.vaiChover ? "🌧️" : d.feriado ? "🎉" : ""}
          ${d.motivos.map(m => `<span class="motivo">${m}</span>`).join("")}</span><b>${d.previsto}</b></div>`).join("")}
      </div>`;
    p += `<div class="passo">Total previsto para a semana:<br><b>${prev.total}</b> cocos</div>`;
    const motivo = faltou ? "a mais, porque faltou coco semana passada" : "de reserva, para não faltar";
    p += `<div class="passo">Mais ${margem}% ${motivo}:<br>+ <b>${r.comMargem - prev.total}</b> = <b>${r.comMargem}</b> cocos</div>`;
    if (r.vendaAteEntrega > 0) {
      const ate = prev.vespera.dias.length === 1 ? "hoje" : "até a entrega de terça";
      p += `<div class="passo">Você tem ${r.estoqueAgora} cocos, mas ${ate} ainda deve vender uns ${r.vendaAteEntrega}.<br>Devem sobrar para terça: <b>${r.estoque}</b></div>`;
    } else {
      p += `<div class="passo">Menos os cocos bons que você já tem:<br>− <b>${r.estoque}</b> cocos</div>`;
    }
    p += `<div class="passo final">Comprar:<br><b>${r.sugerido}</b> cocos</div>`;
    return `<h1>Como foi feita a conta</h1><div class="passos">${p}</div>
      <button class="botao" data-acao="voltar-resultado">← Voltar ao resultado</button>`;
  }

  // =====================================================================
  // RELATÓRIO
  // =====================================================================
  function telaRelatorio() {
    const semanas = Dados.semanas();
    const diario = Dados.diario();
    const config = Dados.config();
    const desde = estado.periodo ? CC.somaDias(hoje(), -estado.periodo) : null;
    const rel = CC.relatorio({ semanas, diario, config, desde });

    let html = `<h1>Relatório</h1>
      <div class="chips">${[[28, "4 semanas"], [91, "3 meses"], [0, "Tudo"]].map(([d, t]) =>
        `<button type="button" data-acao="periodo" data-dias="${d}" class="${(estado.periodo || 0) === d ? "marcado" : ""}">${t}</button>`).join("")}</div>`;

    if (!rel.numSemanas && !diario.length) {
      return html + `<div class="cartao"><p>Ainda não há vendas registradas neste período.</p>
        <p class="suave">O relatório aparece depois da segunda semana de uso, ou ao anotar as vendas do dia.</p></div>`;
    }

    html += `
      <div class="grade"><div class="kpis">
        <div class="kpi largo"><div class="valor verde">${CC.reais(rel.lucro)}</div><div class="legenda">sobrou (vendas − compras de coco)</div></div>
        <div class="kpi"><div class="valor">${rel.vendidos}</div><div class="legenda">cocos vendidos</div></div>
        <div class="kpi"><div class="valor ${rel.faltas ? "vermelho" : "verde"}">${rel.faltas}</div><div class="legenda">${rel.faltas === 1 ? "semana" : "semanas"} com falta</div></div>
        <div class="kpi largo"><div class="linha"><span>Vendas</span><b>${CC.reais(rel.faturamento)}</b></div>
          <div class="linha"><span>Compra de cocos</span><b>− ${CC.reais(rel.gastoCompras)}</b></div>
          <div class="linha"><span>Perdido com ${rel.estragados} estragados</span><b style="color:var(--vermelho)">${CC.reais(rel.perdaEstragados)}</b></div></div>
      </div>`;

    // dicas
    const dicas = [];
    const comDia = rel.porDia.map((v, w) => [v, w]).filter(([v]) => v != null);
    if (comDia.length >= 5) {
      const [mv, mw] = comDia.reduce((a, b) => (b[0] > a[0] ? b : a));
      const [pv, pw] = comDia.reduce((a, b) => (b[0] < a[0] ? b : a));
      dicas.push(["🏆", `<b>${CC.NOMES_DIAS[mw]}</b> é seu melhor dia: vende uns ${mv} cocos. O mais fraco é ${CC.NOMES_DIAS[pw].toLowerCase()}, com ${pv}.`]);
    }
    if (rel.fatorChuva.aprendido) {
      dicas.push(["🌧️", `Em dia de chuva você vende cerca de <b>${Math.round((1 - rel.fatorChuva.fator) * 100)}% menos</b>. O app já desconta isso quando a previsão é de chuva.`]);
    }
    if (rel.estragados > 0) {
      dicas.push(["🗑️", `Estragaram <b>${rel.estragados} cocos</b> (${CC.reais(rel.perdaEstragados)}). ${rel.estragados / Math.max(1, rel.numSemanas) > 8 ? "É bastante: guarde os cocos na sombra e venda os mais antigos primeiro." : "Está sob controle."}`]);
    }
    dicas.push(rel.faltas
      ? ["⚠️", `Faltou coco em <b>${rel.faltas} ${rel.faltas === 1 ? "semana" : "semanas"}</b>. Depois de uma falta, o app aumenta a reserva para ${CC.MARGEM_SE_FALTOU}%.`]
      : ["👏", "Não faltou coco em nenhuma semana deste período."]);
    const vs = vendasReais(semanas);
    if (vs.length >= 8) {
      const a = vs.slice(-4).reduce((x, y) => x + y, 0), b = vs.slice(-8, -4).reduce((x, y) => x + y, 0);
      const pct = Math.round((a - b) / b * 100);
      if (Math.abs(pct) >= 3) dicas.push([pct > 0 ? "📈" : "📉", `Nas últimas 4 semanas você vendeu <b>${Math.abs(pct)}% ${pct > 0 ? "mais" : "menos"}</b> que nas 4 anteriores.`]);
    }
    html += `<div class="cartao"><div class="titulo-cartao"><span class="emoji">💡</span>O que os números mostram</div>
      ${dicas.map(([e, t]) => `<div class="dica-linha"><span class="emoji">${e}</span><span>${t}</span></div>`).join("")}</div>`;
    html += `</div><div class="grade">`;

    // gráfico semanas
    const comVendas = rel.semanas.filter(r => r.vendas != null).slice(-12);
    const inicioDa = new Map(semanas.map((r, i) => [r.data, i ? semanas[i - 1].data : CC.somaDias(r.data, -7)]));
    if (comVendas.length) {
      const maior = Math.max(...comVendas.map(r => r.vendas));
      html += `<div class="cartao grafico"><div class="titulo-cartao">Cocos vendidos por semana</div>
        ${comVendas.map(r => {
          const ini = inicioDa.get(r.data);
          return `<div class="barra-linha"><div class="rotulo-barra">${CC.dataCurta(ini)}</div>
            <div class="barra${r.faltou ? " faltou" : ""}" style="width:${Math.max(28, Math.round(100 * r.vendas / maior))}%">${r.vendas}</div></div>`;
        }).join("")}
        <div class="legenda-graf">Data = dia do pedido daquela semana.${rel.faltas ? ` <span style="background:var(--vermelho)"></span>faltou coco` : ""}</div></div>`;
    }

    // gráfico dias da semana
    const ordem = [1, 2, 3, 4, 5, 6, 0];
    if (rel.porDia.some(v => v != null)) {
      const maior = Math.max(...rel.porDia.filter(v => v != null));
      html += `<div class="cartao grafico"><div class="titulo-cartao">Média por dia da semana</div>
        ${ordem.filter(w => rel.porDia[w] != null).map(w => `<div class="barra-linha"><div class="rotulo-barra">${CC.DIAS_CURTOS[w]}</div>
          <div class="barra${w === 0 || w === 6 ? "" : " claro"}" style="width:${Math.max(28, Math.round(100 * rel.porDia[w] / maior))}%">${rel.porDia[w]}</div></div>`).join("")}
        <div class="legenda-graf">Sem contar feriados.</div></div>`;
    }

    // gráfico tempo
    const climas = ["sol", "nublado", "chuva"].filter(c => rel.porClima[c]);
    if (climas.length >= 2) {
      const maior = Math.max(...climas.map(c => rel.porClima[c].media));
      html += `<div class="cartao grafico"><div class="titulo-cartao">Vendas por dia, conforme o tempo</div>
        ${climas.map(c => `<div class="barra-linha"><div class="rotulo-barra">${EMOJI_CLIMA[c]}</div>
          <div class="barra${c === "chuva" ? " chuva" : ""}" style="width:${Math.max(28, Math.round(100 * rel.porClima[c].media / maior))}%">${rel.porClima[c].media}</div></div>`).join("")}
        <div class="legenda-graf">${climas.map(c => `${NOME_CLIMA[c]}: ${rel.porClima[c].dias} dias`).join(" · ")}</div></div>`;
    }

    html += `</div>`;
    // semana a semana
    const lista = semanas.filter(r => !desde || r.data >= desde).slice().reverse();
    html += `<details class="cartao"><summary>📅 Semana a semana (${lista.length})</summary>
      ${lista.map(r => {
        let etiqueta = "";
        if (r.faltou) etiqueta = `<span class="etiqueta vermelha">faltou coco</span>`;
        else if (r.vendas != null && r.estragados <= Math.max(3, Math.round(r.comprados * 0.03))) etiqueta = `<span class="etiqueta verde">no ponto</span>`;
        return `<div class="semana"><div class="data">${CC.NOMES_DIAS[CC.diaSemana(r.data)]}, ${CC.dataCurta(r.data)}${etiqueta}</div>
          ${r.vendas != null ? `<div>Vendeu na semana anterior: <b>${r.vendas}</b></div>` : r.temAnterior ? "<div>Números não bateram</div>" : "<div>Primeiro pedido</div>"}
          ${r.temAnterior ? `<div>Comprou ${r.comprados} · estragaram ${r.estragados}</div>` : ""}
          <div>Sugestão de compra: <b>${r.sugerido}</b></div></div>`;
      }).join("")}</details>`;

    html += `<button class="botao verde" data-acao="compartilhar-relatorio">📤 Mandar relatório no WhatsApp</button>`;
    return html;
  }

  function textoRelatorio() {
    const config = Dados.config();
    const desde = estado.periodo ? CC.somaDias(hoje(), -estado.periodo) : null;
    const rel = CC.relatorio({ semanas: Dados.semanas(), diario: Dados.diario(), config, desde });
    const periodo = estado.periodo === 28 ? "últimas 4 semanas" : estado.periodo === 91 ? "últimos 3 meses" : "todo o período";
    return [
      `🥥 Coco Certo — ${periodo}`,
      `Cocos vendidos: ${rel.vendidos}`,
      `Vendas: ${CC.reais(rel.faturamento)}`,
      `Gasto com cocos: ${CC.reais(rel.gastoCompras)}`,
      `Sobrou: ${CC.reais(rel.lucro)}`,
      `Estragados: ${rel.estragados} (${CC.reais(rel.perdaEstragados)})`,
      `Semanas com falta de coco: ${rel.faltas}`,
    ].join("\n");
  }

  // =====================================================================
  // AJUSTES
  // =====================================================================
  function telaAjustes() {
    const config = Dados.config();
    const temDados = Dados.semanas().length || Dados.diario().length;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const instalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    return `<h1>Ajustes</h1>
      <div class="grade">
      <div class="cartao"><div class="titulo-cartao"><span class="emoji">🔠</span>Tamanho da letra</div>
        ${escolha("letra", [["1", "Normal", "A"], ["1.15", "Grande", "A+"], ["1.3", "Maior", "A++"]], String(config.letra || 1))}
        <p class="nota">Muda na hora. Escolha o que for mais fácil de ler.</p></div>
      <div class="cartao"><div class="titulo-cartao"><span class="emoji">💰</span>Preços</div>
        ${campoNumero("preco", "Por quanto você vende um coco (R$)?", config.precoCentavos / 100, { passo: 0.5, decimal: true })}
        ${campoNumero("custo", "Quanto você paga por um coco (R$)?", config.custoCentavos / 100, { passo: 0.5, decimal: true })}
        <button class="botao" data-acao="salvar-precos">💾 Salvar preços</button></div>

      <div class="cartao"><div class="titulo-cartao"><span class="emoji">📱</span>Usar como aplicativo</div>
        ${instalado ? "<p>✅ O Coco Certo já está instalado neste celular.</p>"
          : estado.instalar ? `<p>Coloque o Coco Certo na tela inicial do celular, como um aplicativo.</p><button class="botao" data-acao="instalar">📲 Instalar o app</button>`
          : ios ? "<p>No iPhone: toque em <b>Compartilhar</b> (o quadrado com a seta) e depois em <b>Adicionar à Tela de Início</b>.</p>"
          : "<p>No Android: toque no menu <b>⋮</b> do navegador e depois em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p>"}
        <p class="pequeno suave">Depois de instalado, funciona mesmo sem internet. Só a previsão do tempo precisa de internet.</p></div>

      <div class="cartao"><div class="titulo-cartao"><span class="emoji">⏰</span>Lembrete toda segunda</div>
        <p>Coloca na agenda do celular um aviso toda segunda, às 7h, para fazer o pedido.</p>
        <button class="botao secundario" data-acao="lembrete">🔔 Criar lembrete</button></div>

      <div class="cartao"><div class="titulo-cartao"><span class="emoji">🛟</span>Cópia de segurança</div>
        <p>Mande a cópia para o seu WhatsApp. Se trocar de celular, é só recuperar.</p>
        ${temDados ? `<button class="botao secundario" data-acao="exportar">📤 Guardar cópia</button>` : ""}
        <button class="botao secundario" data-acao="importar">📥 Recuperar cópia</button></div>

      <div class="cartao"><div class="titulo-cartao"><span class="emoji">🧪</span>Dados de exemplo</div>
        <p>Preenche o app com 12 semanas fictícias, para ver como tudo funciona.</p>
        <button class="botao secundario" data-acao="carregar-exemplo">Carregar exemplo</button></div>

      ${temDados ? `<div class="cartao"><div class="titulo-cartao"><span class="emoji">🗑️</span>Corrigir ou apagar</div>
        ${Dados.semanas().length ? `<button class="botao perigo" data-acao="apagar-ultima">Apagar o último pedido</button>` : ""}
        <button class="botao perigo" data-acao="apagar-tudo">Apagar tudo</button></div>` : ""}
      </div>`;
  }

  async function exportarCopia() {
    const nome = `coco-certo-copia-${hoje()}.json`;
    const arquivo = new File([JSON.stringify(Dados.copia())], nome, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      try { await navigator.share({ files: [arquivo], title: "Cópia do Coco Certo" }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    baixar(arquivo, nome);
  }
  function baixar(blob, nome) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function lembrete() {
    const seg = proximaSegunda().replace(/-/g, "");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Coco Certo//PT-BR", "BEGIN:VEVENT",
      "UID:coco-certo-pedido-segunda", `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART:${seg}T070000`, "DURATION:PT15M", "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "SUMMARY:🥥 Coco Certo: fazer o pedido de cocos", "DESCRIPTION:Abra o Coco Certo para ver quantos cocos comprar na terça.",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:PT0M", "DESCRIPTION:Fazer o pedido de cocos", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    baixar(new Blob([ics], { type: "text/calendar" }), "lembrete-coco-certo.ics");
  }
  function compartilharTexto(texto) {
    if (navigator.share) { navigator.share({ text: texto }).catch(() => {}); return; }
    window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank");
  }

  // =====================================================================
  // NAVEGAÇÃO E AÇÕES
  // =====================================================================
  function novoPedido() {
    estado.etapaPedido = "registro";
    estado.respostas = null;
    estado.passo = 0;
  }

  const TELAS = { inicio: telaInicio, pedido: telaPedido, relatorio: telaRelatorio, ajustes: telaAjustes };

  function mostrar(tela, { topo = true } = {}) {
    estado.tela = tela;
    conteudo.innerHTML = `<div class="entrar">${TELAS[tela]()}</div>`;
    document.querySelectorAll(".abas button").forEach(b => {
      if (b.dataset.tela === tela) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (topo) window.scrollTo(0, 0);
  }

  const ACOES = {
    "ir-pedido": () => { novoPedido(); mostrar("pedido"); },
    "anotar-dia": () => { estado.anotandoDia = true; estado.diaAnotar = hoje(); mostrar("inicio", { topo: false }); },
    "cancelar-dia": () => { estado.anotandoDia = false; mostrar("inicio", { topo: false }); },
    proximo: avancar,
    anterior: () => { guardarResposta(); estado.passo = Math.max(0, estado.passo - 1); mostrar("pedido"); },
    responder: b => {
      estado.respostas[perguntasDoPedido(contextoPedido())[estado.passo].id] = b.dataset.valor;
      b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("marcado", x === b));
      setTimeout(avancar, 250); // mostra a escolha marcada antes de passar
    },
    "salvar-dia": () => {
      const data = $("dia-anotar") ? $("dia-anotar").value : hoje();
      Dados.anotarDia(data, lerNumero("vendidos-dia"), valorEscolha("clima") || "sol");
      estado.anotandoDia = false;
      avisar(`Anotado: ${lerNumero("vendidos-dia")} cocos (${diaComNome(data).toLowerCase()})`);
      mostrar("inicio");
    },
    calcular,
    explicar: () => { estado.etapaPedido = "explicacao"; mostrar("pedido"); },
    "voltar-resultado": () => { estado.etapaPedido = "resultado"; mostrar("pedido"); },
    refazer: () => { estado.etapaPedido = "registro"; estado.passo = 0; mostrar("pedido"); },
    "whatsapp-pedido": () => {
      const { r } = estado.ultimoCalculo;
      compartilharTexto(`Olá! Quero ${r.sugerido} cocos para terça-feira, ${CC.dataCurta(proximaTerca())}. Obrigado!`);
    },
    periodo: b => { estado.periodo = Number(b.dataset.dias) || null; mostrar("relatorio", { topo: false }); },
    "compartilhar-relatorio": () => compartilharTexto(textoRelatorio()),
    "salvar-precos": () => {
      Dados.salvarConfig(Object.assign(Dados.config(), { precoCentavos: Math.round(lerNumero("preco") * 100), custoCentavos: Math.round(lerNumero("custo") * 100) }));
      avisar("Preços salvos");
    },
    instalar: async () => {
      if (!estado.instalar) return;
      estado.instalar.prompt();
      await estado.instalar.userChoice;
      estado.instalar = null;
      mostrar("ajustes");
    },
    lembrete,
    exportar: exportarCopia,
    importar: () => $("arquivo-copia").click(),
    "carregar-exemplo": () => {
      const tem = Dados.semanas().length || Dados.diario().length;
      if (tem && !confirm("Trocar os dados deste celular por 12 semanas de exemplo?")) return;
      Dados.restaurar(Dados.gerarExemplo());
      estado.ultimoCalculo = null; estado.etapaPedido = "registro";
      avisar("Exemplo carregado");
      mostrar("inicio");
    },
    "apagar-ultima": () => {
      const h = Dados.semanas();
      if (!h.length || !confirm(`Apagar o pedido de ${CC.dataCurta(h[h.length - 1].data)}?`)) return;
      h.pop(); Dados.salvarSemanas(h);
      estado.ultimoCalculo = null; estado.etapaPedido = "registro";
      avisar("Pedido apagado");
      mostrar("ajustes");
    },
    "apagar-tudo": () => {
      if (!confirm("Apagar todos os dados do Coco Certo deste celular? Não dá para desfazer.")) return;
      Dados.apagarTudo();
      estado.ultimoCalculo = null; estado.etapaPedido = "registro";
      mostrar("inicio");
    },
  };

  document.addEventListener("click", e => {
    const aba = e.target.closest(".abas [data-tela]");
    if (aba) {
      if (aba.dataset.tela === "pedido" && (estado.tela === "pedido" || estado.etapaPedido === "registro")) novoPedido();
      mostrar(aba.dataset.tela);
      return;
    }
    const mais = e.target.closest("[data-alvo]");
    if (mais) {
      const campo = $(mais.dataset.alvo);
      const n = Math.max(0, lerNumero(mais.dataset.alvo) + Number(mais.dataset.passo));
      campo.value = campo.dataset.decimal ? formatarDecimal(n) : n;
      return;
    }
    const opcao = e.target.closest(".escolha [data-valor]:not([data-acao])");
    if (opcao) {
      opcao.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("marcado", b === opcao));
      if (opcao.parentElement.dataset.grupo === "letra") {
        Dados.salvarConfig(Object.assign(Dados.config(), { letra: Number(opcao.dataset.valor) }));
        aplicarLetra();
      }
      return;
    }
    const acao = e.target.closest("[data-acao]");
    if (acao && ACOES[acao.dataset.acao]) ACOES[acao.dataset.acao](acao);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.id === "resposta") { e.preventDefault(); avancar(); }
  });
  document.addEventListener("input", e => {
    if (!e.target.matches(".contador input")) return;
    e.target.value = e.target.dataset.decimal ? e.target.value.replace(/[^\d,]/g, "") : e.target.value.replace(/\D/g, "");
  });
  document.addEventListener("change", e => {
    if (e.target.id === "dia-anotar") {
      estado.diaAnotar = e.target.value;
      mostrar("inicio", { topo: false });
    }
    if (e.target.id === "arquivo-copia" && e.target.files[0]) {
      const leitor = new FileReader();
      leitor.onload = () => {
        try {
          const c = Dados.lerCopia(leitor.result);
          if (!confirm(`Recuperar ${c.semanas.length} pedidos e ${c.diario.length} dias anotados? O que está no celular será trocado.`)) return;
          Dados.restaurar(c);
          avisar("Cópia recuperada");
          mostrar("inicio");
        } catch (err) { alert("Esse arquivo não é uma cópia do Coco Certo."); }
      };
      leitor.readAsText(e.target.files[0]);
      e.target.value = "";
    }
  });

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    estado.instalar = e;
    if (estado.tela === "ajustes") mostrar("ajustes", { topo: false });
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  function aplicarLetra() {
    document.documentElement.style.setProperty("--zoom", Dados.config().letra || 1);
  }

  // ---------- começo ----------
  aplicarLetra();
  const nomeData = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  $("data-hoje").textContent = nomeData.charAt(0).toUpperCase() + nomeData.slice(1);

  // Abrir com ?exemplo no endereço carrega os dados fictícios.
  if (new URLSearchParams(location.search).has("exemplo")) {
    const tem = Dados.semanas().length || Dados.diario().length;
    if (!tem || confirm("Trocar os dados deste celular por 12 semanas de exemplo?")) Dados.restaurar(Dados.gerarExemplo());
    history.replaceState(null, "", location.pathname);
  }
  mostrar("inicio");
  atualizarClima();
})();
