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
  const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  const ultimoPedidoReal = () => Dados.semanas().filter(r => !r.importado).slice(-1)[0];
  const vendasReais = rs => rs.filter(r => r.vendas != null).map(r => r.vendas);
  function chancesDeChuva() {
    const c = Dados.clima(), l = Dados.config().local;
    return c && c.lat === l.lat && c.lon === l.lon ? c.dias : {};
  }
  function proximaSegunda() {
    const s = CC.segundaDaSemana(hoje());
    return s > hoje() ? s : CC.somaDias(s, 7);
  }

  // Previsão do tempo para a Praia do Futuro (Open-Meteo, gratuito, sem cadastro).
  async function atualizarClima(forcar = false) {
    const { lat, lon } = Dados.config().local;
    const c = Dados.clima();
    if (!forcar && c && c.buscadoEm === hoje() && c.lat === lat && c.lon === lon) return;
    if (lat == null || lon == null) return;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        "&daily=precipitation_probability_max&timezone=auto&forecast_days=10";
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const j = await r.json();
      const dias = {};
      j.daily.time.forEach((d, i) => { dias[d] = j.daily.precipitation_probability_max[i]; });
      Dados.salvarClima({ buscadoEm: hoje(), lat, lon, dias });
      if (estado.tela === "inicio") mostrar("inicio");
    } catch (e) { /* sem internet: segue sem previsão do tempo */ }
  }

  // Estoque estimado agora: o da última segunda + entrega de terça − vendas anotadas.
  function estoqueEstimado() {
    const ult = ultimoPedidoReal();
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
    const ult = ultimoPedidoReal();
    const temAlgo = Dados.semanas().length || diario.length;
    const ehSegunda = CC.diaSemana(hoje()) === 1;
    const pedidoHoje = registroDeHoje();
    let html = `<h1>${saudacao()}</h1>`;

    // 1. A tarefa principal do dia (uma só, bem grande)
    if (!ult) {
      html += `
        <div class="tarefa">
          <div class="tarefa-emoji">👋</div>
          <div class="tarefa-titulo">Bem-vindo ao Coco Certo</div>
          <p>Toda segunda, o app diz quantos cocos comprar na terça.${temAlgo ? " Seu histórico já está aqui. Agora faça o primeiro pedido." : ""}</p>
          <p class="lugar-banca">📍 Sua banca: <b>${esc(Dados.config().local.nome)}</b> <button class="link-botao inline" data-acao="ir-local">Mudar</button></p>
          <button class="botao amarelo" data-acao="ir-pedido">🛒 Fazer o primeiro pedido</button>
          <button class="link-botao" data-acao="ir-historico">${temAlgo ? "Colocar mais histórico" : "Já tenho vendas anotadas: colocar meu histórico"}</button>
          ${temAlgo ? "" : `<button class="link-botao" data-acao="carregar-exemplo">Prefiro ver um exemplo antes</button>`}
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

    const anotarAtivo = Dados.config().anotarDiario !== false;
    if (estado.anotandoDia) {
      html += formularioDoDia(diario, anotadoHoje);
    } else if (!anotadoHoje) {
      if (anotarAtivo) html += `
        <div class="cartao opcional">
          <div class="titulo-cartao"><span class="emoji">📝</span>Anotar as vendas de hoje <span class="etiqueta cinza">opcional</span></div>
          <p class="nota" style="margin-top:0">Não é obrigatório. Mas, anotando, o app aprende o movimento de cada dia e acerta mais o pedido.</p>
          <button class="botao secundario pequeno" data-acao="anotar-dia">📝 Anotar agora</button>
        </div>`;
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
    const ins = CC.insights({ semanas: Dados.semanas(), diario, config: Dados.config(), desde: CC.somaDias(hoje(), -28) }).lista;
    if (ins.length && ult) {
      resumo += `
        <div class="cartao dica-semana">
          <div class="titulo-cartao"><span class="emoji">💡</span>Dica da semana</div>
          <div class="dica-linha"><span class="emoji">${ins[0].emoji}</span><span>${ins[0].texto}</span></div>
          <button class="link-botao" data-acao="ir-relatorio">Ver mais no relatório →</button>
        </div>`;
    }
    if (ult) {
      const seg = CC.segundaDaSemana(hoje());
      const vendidosSemana = diario.filter(r => r.data >= seg && r.data <= hoje()).reduce((a, r) => a + r.vendidos, 0);
      const est = estoqueEstimado();
      resumo += `
        <div class="cartao">
          <div class="titulo-cartao"><span class="emoji">📦</span>Esta semana</div>
          <div class="linha"><span>Vendidos desde segunda</span><b>${vendidosSemana}</b></div>
          ${est && !est.diasSemAnotar ? `<div class="linha"><span>Cocos no estoque <span class="suave pequeno">(estimado)</span></span><b>${est.valor}</b></div>` : ""}
          <div class="linha"><span>Último pedido <span class="suave pequeno">(${CC.dataCurta(ult.data)})</span></span><b>${ult.sugerido}</b></div>
          <div class="linha"><span>Próximo pedido</span><b>${pedidoHoje ? "feito ✓" : diaComNome(proximaSegunda())}</b></div>
          ${est && est.diasSemAnotar && anotarAtivo && diario.some(r => r.data >= ult.data) ? `<p class="nota">Anote os dias que faltam (${est.diasSemAnotar}) para o app mostrar quantos cocos ainda tem.</p>` : ""}
        </div>`;
    }
    const chances = chancesDeChuva();
    const dias = [0, 1, 2, 3, 4, 5, 6].map(i => CC.somaDias(hoje(), i));
    if (dias.some(d => chances[d] != null)) {
      resumo += `
        <div class="cartao">
          <div class="titulo-cartao"><span class="emoji">🌤️</span>Tempo em ${esc(Dados.config().local.nome)}</div>
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
    const ultimoReg = anteriores[anteriores.length - 1];
    const anterior = ultimoReg && !ultimoReg.importado ? ultimoReg : null; // semana lançada à mão não tem estoque
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

    // o que os números mostram
    const dicas = CC.insights({ semanas, diario, config, desde }).lista.map(i => [i.emoji, i.texto]);
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
          const ini = r.importado ? r.data : inicioDa.get(r.data);
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
        else if (r.vendas != null && r.comprados != null && r.estragados <= Math.max(3, Math.round(r.comprados * 0.03))) etiqueta = `<span class="etiqueta verde">no ponto</span>`;
        return `<div class="semana"><div class="data">${CC.NOMES_DIAS[CC.diaSemana(r.data)]}, ${CC.dataCurta(r.data)}${etiqueta}</div>
          ${r.importado ? `<div>Lançada por você: vendeu <b>${r.vendas}</b> na semana</div>`
            : r.vendas != null ? `<div>Vendeu na semana anterior: <b>${r.vendas}</b></div>` : r.temAnterior ? "<div>Números não bateram</div>" : "<div>Primeiro pedido</div>"}
          ${r.temAnterior ? `<div>Comprou ${r.comprados ?? "?"} · estragaram ${r.estragados}</div>` : ""}
          ${r.sugerido != null ? `<div>Sugestão de compra: <b>${r.sugerido}</b></div>` : ""}</div>`;
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
      <div class="cartao tarefa-clara"><div class="titulo-cartao"><span class="emoji">📥</span>Colocar meu histórico</div>
        <p>Já tem vendas anotadas num caderno ou planilha? Coloque aqui para o app acertar mais desde o começo.</p>
        <button class="botao" data-acao="ir-historico">📥 Colocar meu histórico</button></div>
      <div class="grade">
      <div class="cartao"><div class="titulo-cartao"><span class="emoji">📍</span>Onde fica sua banca</div>
        <p><b>${esc(config.local.nome)}</b>${config.local.cidade && config.local.cidade !== config.local.nome ? ` · ${esc(config.local.cidade)}` : ""}${config.local.uf ? ` – ${config.local.uf}` : ""}</p>
        <p class="nota">Define a previsão do tempo e os feriados.${(config.diasEspeciais || []).length ? ` ${config.diasEspeciais.length} dias especiais cadastrados.` : ""}</p>
        <button class="botao secundario" data-acao="ir-local">📍 Mudar lugar e feriados</button></div>
      <div class="cartao"><div class="titulo-cartao"><span class="emoji">📝</span>Anotar vendas do dia</div>
        ${escolha("anotar-diario", [["sim", "Mostrar no início"], ["nao", "Não quero anotar"]], config.anotarDiario === false ? "nao" : "sim")}
        <p class="nota">É opcional. O pedido funciona só com as perguntas de segunda. Anotando o dia a dia, a previsão fica mais certa.</p></div>
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
  // COLOCAR MEU HISTÓRICO — vendas que o vendedor já tinha anotado
  // =====================================================================
  function telaHistorico() {
    const modo = estado.modoHist || "dia";
    let html = `<div class="estreito">
      <button class="link-botao voltar-link" data-acao="ir-ajustes">← Voltar aos ajustes</button>
      <h1>Colocar meu histórico</h1>
      <p>Quanto mais vendas o app conhecer, mais certa fica a sugestão. Coloque o que você tiver anotado, do jeito que for mais fácil:</p>
      <div class="chips">${[["dia", "Por dia"], ["semana", "Por semana"], ["planilha", "Planilha"]].map(([m, t]) =>
        `<button type="button" data-acao="modo-hist" data-modo="${m}" class="${modo === m ? "marcado" : ""}">${t}</button>`).join("")}</div>`;
    if (modo === "dia") html += historicoPorDia();
    else if (modo === "semana") html += historicoPorSemana();
    else html += historicoPorPlanilha();
    return html + `</div>`;
  }

  function historicoPorDia() {
    const diario = Dados.diario();
    const data = estado.dataHist || CC.somaDias(hoje(), -1);
    const reg = diario.find(r => r.data === data);
    return `
      <div class="cartao">
        <div class="campo"><label for="data-hist">Qual dia?</label>
          <input id="data-hist" type="date" class="grande-select" max="${hoje()}" value="${data}"></div>
        <p class="nota" style="margin:-4px 0 14px">${CC.NOMES_DIAS[CC.diaSemana(data)]}, ${CC.dataCurta(data)}/${data.slice(0, 4)}${reg ? ` · já anotado: <b>${reg.vendidos}</b> cocos` : ""}</p>
        ${campoNumero("vendidos-hist", "Quantos cocos vendeu nesse dia?", reg ? reg.vendidos : 0)}
        <div class="campo"><span class="pergunta">Como estava o tempo?</span>
          ${escolha("clima-hist", [["sol", "Sol", "☀️"], ["nublado", "Nublado", "⛅"], ["chuva", "Chuva", "🌧️"], ["", "Não sei", "❔"]], reg ? (reg.clima || "") : "")}</div>
        <button class="botao verde" data-acao="salvar-dia-hist">💾 Salvar e ir para o próximo dia</button>
      </div>
      ${diario.length ? `<p class="nota">Você tem <b>${diario.length}</b> dias anotados, de ${CC.dataCurta(diario[0].data)}/${diario[0].data.slice(0, 4)} até ${CC.dataCurta(diario[diario.length - 1].data)}/${diario[diario.length - 1].data.slice(0, 4)}.</p>` : ""}`;
  }

  function historicoPorSemana() {
    const limite = Dados.limiteSemanas();
    const maximo = limite ? CC.somaDias(limite, -1) : hoje();
    const data = estado.dataSemanaHist || CC.somaDias(CC.segundaDaSemana(maximo), -7);
    const seg = CC.segundaDaSemana(data);
    const ja = Dados.semanas().find(r => r.importado && r.data === seg);
    const importadas = Dados.semanas().filter(r => r.importado).reverse();
    return `
      ${limite ? `<div class="status">Dá para lançar semanas até antes do seu primeiro pedido no app (${CC.dataCurta(limite)}). Depois disso, o app já guarda sozinho.</div>` : ""}
      <div class="cartao">
        <div class="campo"><label for="data-semana">Escolha um dia da semana</label>
          <input id="data-semana" type="date" class="grande-select" max="${maximo}" value="${data}"></div>
        <p class="nota" style="margin:-4px 0 14px">Semana de segunda ${CC.dataCurta(seg)} a domingo ${CC.dataCurta(CC.somaDias(seg, 6))}${ja ? " · já lançada" : ""}</p>
        ${campoNumero("vendidos-sem", "Quantos cocos vendeu na semana?", ja ? ja.vendas : 0)}
        ${campoNumero("comprados-sem", "Quantos comprou? (se não souber, deixe 0)", ja && ja.comprados != null ? ja.comprados : 0)}
        ${campoNumero("estragados-sem", "Quantos estragaram?", ja ? ja.estragados : 0)}
        <div class="campo"><span class="pergunta">Faltou coco?</span>
          ${escolha("faltou-sem", [["nao", "Não"], ["sim", "Sim"]], ja && ja.faltou ? "sim" : "nao")}</div>
        <button class="botao verde" data-acao="salvar-semana-hist">💾 Salvar e ir para a semana anterior</button>
      </div>
      ${importadas.length ? `<div class="cartao"><div class="titulo-cartao">Semanas lançadas por você</div>
        ${importadas.map(r => `<div class="linha"><span>${CC.dataCurta(r.data)}/${r.data.slice(2, 4)} · <b>${r.vendas}</b> vendidos${r.faltou ? " · faltou" : ""}</span>
          <button class="botao-icone" data-acao="apagar-semana-hist" data-data="${r.data}" aria-label="Apagar semana de ${CC.dataCurta(r.data)}">🗑️</button></div>`).join("")}
      </div>` : ""}`;
  }

  function historicoPorPlanilha() {
    const tipo = estado.tipoPlanilha || "dia";
    const leitura = estado.leitura;
    let html = `
      <div class="cartao">
        <p>Cole as suas anotações ou uma planilha. Basta <b>uma linha para cada ${tipo === "dia" ? "dia" : "semana"}</b>, com a data e a quantidade. Por exemplo:</p>
        <pre class="exemplo">${tipo === "dia" ? "10/11 32 sol\n11/11 18 chuva\n12/11 25" : "03/11 180 190 6\n27/10 175 185 4 faltou"}</pre>
        ${tipo === "semana" ? `<p class="nota">Na ordem: data, vendidos, comprados, estragados. Escreva "faltou" se faltou coco.</p>` : `<p class="nota">O tempo (sol, nublado, chuva) é opcional.</p>`}
        <div class="campo" style="margin-top:14px"><span class="pergunta">Cada linha é:</span>
          ${escolha("tipo-planilha", [["dia", "Um dia"], ["semana", "Uma semana"]], tipo)}</div>
        <div class="campo"><label for="texto-planilha">Cole aqui</label>
          <textarea id="texto-planilha" rows="7" placeholder="10/11 32 sol">${(estado.textoPlanilha || "").replace(/</g, "&lt;")}</textarea></div>
        <button class="botao secundario pequeno" data-acao="escolher-planilha">📎 Ou escolher um arquivo (CSV)</button>
        <input id="arquivo-planilha" type="file" accept=".csv,.txt,text/csv,text/plain" hidden>
        <button class="botao" data-acao="ler-planilha">🔍 Conferir</button>
        <button class="link-botao" data-acao="modelo-planilha">Baixar modelo de planilha</button>
      </div>`;
    if (leitura) {
      const itens = leitura.itens;
      const ordenados = itens.slice().sort((a, b) => a.data.localeCompare(b.data));
      html += `<div class="cartao ${itens.length ? "sucesso" : ""}">
        <div class="titulo-cartao"><span class="emoji">${itens.length ? "✅" : "🤔"}</span>${itens.length
          ? `Entendi ${itens.length} ${tipo === "dia" ? (itens.length === 1 ? "dia" : "dias") : (itens.length === 1 ? "semana" : "semanas")}`
          : "Não entendi nenhuma linha"}</div>
        ${itens.length ? `<p>De ${CC.dataCurta(ordenados[0].data)}/${ordenados[0].data.slice(0, 4)} a ${CC.dataCurta(ordenados[ordenados.length - 1].data)}/${ordenados[ordenados.length - 1].data.slice(0, 4)}, total de <b>${itens.reduce((a, r) => a + r.vendidos, 0)}</b> cocos vendidos.</p>
          ${ordenados.slice(-6).reverse().map(r => `<div class="linha"><span>${CC.DIAS_CURTOS[CC.diaSemana(r.data)]} ${CC.dataCurta(r.data)}/${r.data.slice(2, 4)} ${r.clima ? EMOJI_CLIMA[r.clima] : ""}${r.faltou ? " · faltou" : ""}</span><b>${r.vendidos}</b></div>`).join("")}
          ${itens.length > 6 ? `<p class="nota">… e mais ${itens.length - 6}.</p>` : ""}` : ""}
        ${leitura.erros.length ? `<div class="alerta" style="margin-top:12px">${leitura.erros.length} ${leitura.erros.length === 1 ? "linha ficou" : "linhas ficaram"} de fora:<br>${leitura.erros.slice(0, 5).map(e =>
            `Linha ${e.linha}: “${e.texto.slice(0, 30).replace(/</g, "&lt;")}” — ${e.motivo}`).join("<br>")}</div>` : ""}
        ${itens.length ? `<button class="botao verde" data-acao="salvar-planilha">💾 Salvar ${itens.length} ${tipo === "dia" ? "dias" : "semanas"}</button>` : ""}
      </div>`;
    }
    return html;
  }

  function lerArquivoPlanilha(arquivo) {
    const leitor = new FileReader();
    leitor.onload = () => {
      estado.textoPlanilha = String(leitor.result);
      estado.leitura = Dados.lerTexto(estado.textoPlanilha, estado.tipoPlanilha || "dia");
      mostrar("historico", { topo: false });
    };
    leitor.readAsText(arquivo);
  }

  // =====================================================================
  // ONDE FICA A BANCA — previsão do tempo, feriados e dias especiais
  // =====================================================================
  function telaLocal() {
    const c = Dados.config(), l = c.local, res = estado.resultadosLocal;
    const especiais = c.diasEspeciais || [];
    return `<div class="estreito">
      <button class="link-botao voltar-link" data-acao="ir-ajustes">← Voltar aos ajustes</button>
      <h1>Onde fica sua banca</h1>
      <div class="cartao sucesso"><div class="titulo-cartao"><span class="emoji">📍</span>${esc(l.nome)}</div>
        <p style="margin:0">${esc(l.cidade || "")}${l.uf ? ` – ${l.uf}` : ""}</p></div>

      <div class="cartao"><div class="titulo-cartao">Mudar o lugar</div>
        <button class="botao" data-acao="local-gps">📍 Usar minha localização</button>
        <p class="nota">Melhor fazer isso estando na banca. O celular vai pedir permissão.</p>
        <div class="campo" style="margin-top:18px"><label for="busca-local">Ou digite o nome da cidade</label>
          <input id="busca-local" class="grande-select" type="search" placeholder="Ex.: Salvador" value="${esc(estado.buscaLocal || "")}" enterkeyhint="search" autocomplete="off"></div>
        <button class="botao secundario" data-acao="buscar-local">🔍 Buscar</button>
        ${res ? (res.length ? `<div class="opcoes-local">${res.map((r, i) =>
            `<button type="button" class="opcao-local" data-acao="escolher-local" data-i="${i}"><b>${esc(r.name)}</b><span>${esc([r.admin1, r.country].filter(Boolean).join(", "))}</span></button>`).join("")}</div>`
          : `<p class="nota">Não achei nenhum lugar com esse nome. Confira a escrita.</p>`) : ""}
      </div>

      <div class="cartao">
        <div class="campo"><label for="apelido-local">Nome da banca ou praia</label>
          <input id="apelido-local" class="grande-select" type="text" value="${esc(l.nome)}" maxlength="40"></div>
        <div class="campo"><label for="uf-local">Estado (para os feriados)</label>
          <select id="uf-local" class="grande-select"><option value="">Fora do Brasil / não sei</option>${CC.SIGLAS_UF.map(u => `<option${u === l.uf ? " selected" : ""}>${u}</option>`).join("")}</select></div>
        <button class="botao verde" data-acao="salvar-local">💾 Salvar</button>
      </div>

      <div class="cartao"><div class="titulo-cartao"><span class="emoji">🎉</span>Feriados e dias especiais</div>
        <p>Os feriados nacionais${l.uf ? ` e do estado (${l.uf})` : ""} já estão no app. Coloque aqui os <b>feriados da sua cidade</b> e dias de <b>festa, show ou evento</b> perto da banca. Nesses dias o app conta venda de domingo.</p>
        ${especiais.map((d, i) => `<div class="linha"><span>${d.todoAno ? `${CC.dataCurta(d.data)} · todo ano` : `${CC.dataCurta(d.data)}/${d.data.slice(0, 4)}`}<br><b class="nome-especial">${esc(d.nome)}</b></span>
          <button class="botao-icone" data-acao="apagar-dia-especial" data-i="${i}" aria-label="Apagar ${esc(d.nome)}">🗑️</button></div>`).join("")}
        <div class="campo" style="margin-top:14px"><label for="data-especial">Dia</label><input id="data-especial" type="date" class="grande-select"></div>
        <div class="campo"><label for="nome-especial">Nome</label><input id="nome-especial" type="text" class="grande-select" placeholder="Ex.: Aniversário da cidade" maxlength="40"></div>
        <div class="campo"><span class="pergunta">Repete todo ano?</span>${escolha("todo-ano", [["sim", "Sim"], ["nao", "Só esse ano"]], "sim")}</div>
        <button class="botao secundario" data-acao="add-dia-especial">➕ Adicionar dia</button>
      </div></div>`;
  }

  function salvarLocal(local) {
    Dados.salvarConfig(Object.assign(Dados.config(), { local }));
    estado.resultadosLocal = null;
    avisar(`Banca em ${local.nome}`);
    mostrar("local", { topo: false });
    atualizarClima(true);
  }
  async function buscarLocal() {
    const q = $("busca-local").value.trim();
    estado.buscaLocal = q;
    if (!q) return;
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=pt&format=json`,
        { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      estado.resultadosLocal = j.results || [];
    } catch (e) { avisar("Sem internet. Tente de novo."); return; }
    mostrar("local", { topo: false });
  }
  function localPorGps() {
    if (!navigator.geolocation) { avisar("Este celular não deu a localização. Digite a cidade."); return; }
    avisar("Procurando sua localização…");
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = Math.round(pos.coords.latitude * 1000) / 1000, lon = Math.round(pos.coords.longitude * 1000) / 1000;
      let cidade = null, uf = null;
      try { // nome do lugar a partir das coordenadas
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`,
          { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        cidade = j.city || j.locality || null;
        const cod = j.principalSubdivisionCode || "";
        uf = cod.startsWith("BR-") ? cod.slice(3) : null;
      } catch (e) { /* sem nome: fica só com as coordenadas */ }
      salvarLocal({ nome: cidade || "Minha banca", cidade, uf, lat, lon });
    }, () => avisar("Não consegui a localização. Digite a cidade."), { timeout: 15000, enableHighAccuracy: false });
  }

  // =====================================================================
  // NAVEGAÇÃO E AÇÕES
  // =====================================================================
  function novoPedido() {
    estado.etapaPedido = "registro";
    estado.respostas = null;
    estado.passo = 0;
  }

  const TELAS = { inicio: telaInicio, pedido: telaPedido, relatorio: telaRelatorio, ajustes: telaAjustes, historico: telaHistorico, local: telaLocal };

  function mostrar(tela, { topo = true } = {}) {
    estado.tela = tela;
    conteudo.innerHTML = `<div class="entrar">${TELAS[tela]()}</div>`;
    document.querySelectorAll(".abas button").forEach(b => {
      const aba = tela === "historico" || tela === "local" ? "ajustes" : tela;
      if (b.dataset.tela === aba) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
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
    "ir-historico": () => mostrar("historico"),
    "ir-relatorio": () => mostrar("relatorio"),
    "ir-local": () => { estado.resultadosLocal = null; mostrar("local"); },
    "buscar-local": buscarLocal,
    "local-gps": localPorGps,
    "escolher-local": b => {
      const r = estado.resultadosLocal[Number(b.dataset.i)];
      salvarLocal({ nome: r.name, cidade: r.name, uf: r.country_code === "BR" ? CC.ufDoEstado(r.admin1) : null,
        lat: Math.round(r.latitude * 1000) / 1000, lon: Math.round(r.longitude * 1000) / 1000 });
    },
    "salvar-local": () => {
      const c = Dados.config();
      const nome = $("apelido-local").value.trim() || c.local.cidade || "Minha banca";
      Dados.salvarConfig(Object.assign(c, { local: Object.assign(c.local, { nome, uf: $("uf-local").value || null }) }));
      avisar("Salvo");
      mostrar("local", { topo: false });
    },
    "add-dia-especial": () => {
      const data = $("data-especial").value, nome = $("nome-especial").value.trim();
      if (!data || !nome) { avisar("Coloque o dia e o nome"); return; }
      const c = Dados.config();
      c.diasEspeciais = (c.diasEspeciais || []).concat({ data, nome, todoAno: valorEscolha("todo-ano") === "sim" })
        .sort((a, b) => a.data.slice(5).localeCompare(b.data.slice(5)));
      Dados.salvarConfig(c);
      avisar(`${nome} adicionado`);
      mostrar("local", { topo: false });
    },
    "apagar-dia-especial": b => {
      const c = Dados.config();
      const d = c.diasEspeciais[Number(b.dataset.i)];
      if (!d || !confirm(`Apagar ${d.nome}?`)) return;
      c.diasEspeciais.splice(Number(b.dataset.i), 1);
      Dados.salvarConfig(c);
      mostrar("local", { topo: false });
    },
    "ir-ajustes": () => mostrar("ajustes"),
    "modo-hist": b => { estado.modoHist = b.dataset.modo; estado.leitura = null; mostrar("historico", { topo: false }); },
    "salvar-dia-hist": () => {
      const data = $("data-hist").value;
      if (!data || data > hoje()) { avisar("Escolha um dia que já passou"); return; }
      const n = lerNumero("vendidos-hist");
      Dados.anotarDia(data, n, valorEscolha("clima-hist") || null);
      avisar(`Salvo: ${n} cocos em ${CC.dataCurta(data)}`);
      const prox = CC.somaDias(data, 1);
      estado.dataHist = prox <= hoje() ? prox : data;
      mostrar("historico", { topo: false });
    },
    "salvar-semana-hist": () => {
      const data = $("data-semana").value;
      const vendidos = lerNumero("vendidos-sem");
      if (!data) { avisar("Escolha a semana"); return; }
      if (!vendidos) { avisar("Coloque quantos cocos vendeu"); return; }
      const res = Dados.importarSemanas([{
        data, vendidos, comprados: lerNumero("comprados-sem") || null,
        estragados: lerNumero("estragados-sem"), faltou: valorEscolha("faltou-sem") === "sim",
      }]);
      if (res.recusadas.length) { avisar("Essa semana já é do tempo do app"); return; }
      avisar(`Semana de ${CC.dataCurta(CC.segundaDaSemana(data))} salva`);
      estado.dataSemanaHist = CC.somaDias(CC.segundaDaSemana(data), -7);
      mostrar("historico", { topo: false });
    },
    "apagar-semana-hist": b => {
      if (!confirm(`Apagar a semana de ${CC.dataCurta(b.dataset.data)}?`)) return;
      Dados.apagarSemanaImportada(b.dataset.data);
      mostrar("historico", { topo: false });
    },
    "escolher-planilha": () => $("arquivo-planilha").click(),
    "ler-planilha": () => {
      estado.textoPlanilha = $("texto-planilha").value;
      estado.leitura = Dados.lerTexto(estado.textoPlanilha, estado.tipoPlanilha || "dia");
      mostrar("historico", { topo: false });
    },
    "salvar-planilha": () => {
      const { itens } = estado.leitura;
      if ((estado.tipoPlanilha || "dia") === "dia") {
        const n = Dados.importarDias(itens);
        avisar(`${n} dias salvos`);
      } else {
        const res = Dados.importarSemanas(itens);
        avisar(res.recusadas.length ? `${res.salvas} semanas salvas; ${res.recusadas.length} ficaram de fora (depois do primeiro pedido)` : `${res.salvas} semanas salvas`);
      }
      estado.leitura = null; estado.textoPlanilha = "";
      mostrar("historico", { topo: false });
    },
    "modelo-planilha": () => {
      const tipo = estado.tipoPlanilha || "dia";
      const csv = tipo === "dia"
        ? "data;vendidos;tempo\n10/11/2026;32;sol\n11/11/2026;18;chuva\n12/11/2026;25;nublado\n"
        : "semana (segunda);vendidos;comprados;estragados;faltou\n03/11/2026;180;190;6;sim\n27/10/2026;175;185;4;não\n";
      baixar(new Blob(["\ufeff" + csv], { type: "text/csv" }), `modelo-coco-certo-${tipo}.csv`);
    },
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
      if (opcao.parentElement.dataset.grupo === "tipo-planilha") {
        estado.tipoPlanilha = opcao.dataset.valor; estado.leitura = null;
        estado.textoPlanilha = $("texto-planilha").value;
        mostrar("historico", { topo: false });
      }
      if (opcao.parentElement.dataset.grupo === "anotar-diario") {
        Dados.salvarConfig(Object.assign(Dados.config(), { anotarDiario: opcao.dataset.valor === "sim" }));
        avisar(opcao.dataset.valor === "sim" ? "A anotação aparece no início" : "Pronto, sem anotação diária");
      }
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
    if (e.key === "Enter" && e.target.id === "busca-local") { e.preventDefault(); buscarLocal(); }
  });
  document.addEventListener("input", e => {
    if (!e.target.matches(".contador input")) return;
    e.target.value = e.target.dataset.decimal ? e.target.value.replace(/[^\d,]/g, "") : e.target.value.replace(/\D/g, "");
  });
  document.addEventListener("change", e => {
    if (e.target.id === "data-hist") { estado.dataHist = e.target.value; mostrar("historico", { topo: false }); }
    if (e.target.id === "data-semana") { estado.dataSemanaHist = e.target.value; mostrar("historico", { topo: false }); }
    if (e.target.id === "arquivo-planilha" && e.target.files[0]) { lerArquivoPlanilha(e.target.files[0]); e.target.value = ""; }
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
  Dados.aplicarLocal();
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
