/* =============================================================
   Restaurante & Grill Centenário — script.js
   - status aberto/fechado (sempre no fuso de Brasília)
   - cardápio do dia lido de uma planilha do Google (CSV), com "Prato do dia"
     variando por dia da semana (coluna "dia") e itens fixos (Fitness, À la
     minuta, Adicionais) todo santo dia
   - carrinho em memória (sem localStorage) -> pedido montado no WhatsApp
   - galeria com lightbox
   O cardápio mostra o preço de cada item. A mensagem do WhatsApp lista os
   itens com o preço unitário, mas não soma nada — quem atende fecha o total
   (com a taxa de entrega) na conversa.
   ============================================================= */
(function () {
  "use strict";

  var ZAP = "5551998778868"; // (51) 99877-8868
  var HORARIO = { abreMin: 11 * 60, fechaMin: 13 * 60 + 30, diasAbertos: [1, 2, 3, 4, 5, 6] }; // 0=domingo
  var DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  var DIAS_SEM_ACENTO = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  var AVISO_ANTECEDENCIA = 30; // min antes de fechar -> "fecha em X min"
  var DIA_SABADO = 6;
  // Regra do restaurante: aos sábados não tem tele-entrega — só buffet a quilo, no local.
  var SABADO_SEM_ENTREGA = true;

  function normalizarDia(s) {
    return (s || "").toLowerCase().trim()
      .normalize("NFD").replace(/[̀-ͯ]/g, ""); // tira acento
  }
  function formatarReal(n) {
    return "R$ " + n.toFixed(2).replace(".", ",");
  }

  var $ = function (s, ctx) { return (ctx || document).querySelector(s); };
  var $$ = function (s, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(s)); };

  /* ---------- cabeçalho: sombra ao rolar ---------- */
  var cabecalho = $("#cabecalho");
  if (cabecalho) {
    var rolou = function () { cabecalho.classList.toggle("cabecalho--rolado", window.scrollY > 8); };
    rolou();
    window.addEventListener("scroll", rolou, { passive: true });
  }

  /* =========================================================
     1. HORÁRIO / STATUS  (fuso America/Sao_Paulo)
     ========================================================= */
  function horaBrasilia() {
    var f = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
    });
    var m = {};
    f.formatToParts(new Date()).forEach(function (p) { m[p.type] = p.value; });
    var wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[m.weekday];
    var h = parseInt(m.hour, 10); if (h === 24) h = 0;
    var min = parseInt(m.minute, 10);
    return { wd: wd, min: h * 60 + min };
  }

  function proximaAbertura(agora) {
    // hoje ainda abre?
    if (HORARIO.diasAbertos.indexOf(agora.wd) !== -1 && agora.min < HORARIO.abreMin) {
      return "hoje às 11h";
    }
    for (var i = 1; i <= 7; i++) {
      var d = (agora.wd + i) % 7;
      if (HORARIO.diasAbertos.indexOf(d) !== -1) {
        if (i === 1) return "amanhã às 11h";
        return DIAS[d] + " às 11h";
      }
    }
    return "às 11h";
  }

  var estadoAtual = "fechado";

  function calcularStatus(cfg) {
    var agora = horaBrasilia();
    var forcado = (cfg && cfg.status_hoje || "auto").toLowerCase().trim();

    if (forcado === "aberto") {
      return { estado: "aberto", texto: "Aberto agora" };
    }
    if (forcado === "fechado") {
      return { estado: "fechado", texto: "Fechado hoje · abre " + proximaAbertura(agora) };
    }

    var aberto = HORARIO.diasAbertos.indexOf(agora.wd) !== -1 &&
                 agora.min >= HORARIO.abreMin && agora.min < HORARIO.fechaMin;

    if (aberto) {
      var faltam = HORARIO.fechaMin - agora.min;
      if (faltam <= AVISO_ANTECEDENCIA) return { estado: "aberto", texto: "Fecha em " + faltam + " min" };
      return { estado: "aberto", texto: "Aberto agora · fecha 13h30" };
    }
    return { estado: "fechado", texto: "Fechado · abre " + proximaAbertura(agora) };
  }

  function pintarStatus(cfg) {
    var s = calcularStatus(cfg);
    estadoAtual = s.estado;
    $$(".placa").forEach(function (placa) {
      placa.setAttribute("data-status", s.estado);
      var alvo = $(".placa__texto", placa);
      if (alvo) alvo.textContent = s.texto;
    });
    // rótulo do botão de envio muda quando está fechado
    var enviar = $("#sacola-enviar");
    var avisoFechado = $("#sacola-aviso-fechado");
    if (enviar) enviar.textContent = s.estado === "fechado" ? "Enviar pedido para amanhã" : "Pedir no WhatsApp";
    if (avisoFechado) {
      if (s.estado === "fechado") {
        avisoFechado.textContent = "O restaurante está fechado agora — seu pedido chega para o próximo dia de funcionamento.";
        avisoFechado.hidden = false;
      } else {
        avisoFechado.hidden = true;
      }
    }
  }

  /* =========================================================
     2. CSV  (parser tolerante a aspas, vírgulas e quebras)
     ========================================================= */
  function parseCSV(texto) {
    var linhas = [], campo = "", linha = [], dentroAspas = false;
    texto = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (var i = 0; i < texto.length; i++) {
      var c = texto[i];
      if (dentroAspas) {
        if (c === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; }
          else dentroAspas = false;
        } else campo += c;
      } else if (c === '"') {
        dentroAspas = true;
      } else if (c === ",") {
        linha.push(campo); campo = "";
      } else if (c === "\n") {
        linha.push(campo); linhas.push(linha); linha = []; campo = "";
      } else campo += c;
    }
    if (campo.length || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas;
  }

  function csvParaObjetos(texto) {
    var linhas = parseCSV(texto).filter(function (l) { return l.some(function (c) { return c.trim() !== ""; }); });
    if (!linhas.length) return [];
    var cab = linhas[0].map(function (h) { return h.trim().toLowerCase(); });
    return linhas.slice(1).map(function (l) {
      var o = {};
      cab.forEach(function (h, idx) { o[h] = (l[idx] || "").trim(); });
      return o;
    });
  }

  function buscarCSV(url) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 6000);
    return fetch(url, { signal: ctrl.signal, cache: "no-cache", credentials: "omit" })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.text(); });
  }

  /* =========================================================
     3. CONFIG (aba "config" da planilha) — opcional
     ========================================================= */
  function lerConfig(linhas) {
    var cfg = {};
    linhas.forEach(function (o) {
      var chave = (o.chave || o.key || "").toLowerCase().trim();
      if (chave) cfg[chave] = (o.valor || o.value || "").trim();
    });
    return cfg;
  }

  function aplicarAviso(cfg) {
    var el = $("#aviso-topo");
    if (!el) return;
    var txt = (cfg.aviso || "").trim();
    if (txt) { el.textContent = txt; el.hidden = false; }
    else { el.hidden = true; }
  }

  /* =========================================================
     4. CARRINHO (em memória — nada é salvo)
     ========================================================= */
  var carrinho = new Map(); // id -> { nome, tamanho, categoria, qtd }

  var sacola = $("#sacola");
  var sacolaItens = $("#sacola-itens");
  var sacolaContagem = $("#sacola-contagem");
  var sacolaSubtotal = $("#sacola-subtotal");
  var sacolaDetalhe = $("#sacola-detalhe");
  var sacolaBackdrop = $("#sacola-backdrop");
  var sacolaToggle = $("#sacola-toggle");
  var sacolaFechar = $("#sacola-fechar");
  var sacolaContinuar = $("#sacola-continuar");
  var entregaAtiva = true;
  var carrinhoAberto = false;

  function idItem(d) { return [d.categoria, d.nome, d.tamanho || ""].join("|"); }

  function totalItens() {
    var n = 0; carrinho.forEach(function (v) { n += v.qtd; }); return n;
  }

  function totalPreco() {
    var t = 0; carrinho.forEach(function (v) { t += v.preco * v.qtd; }); return t;
  }

  // barra fixa do rodapé — só mostra/esconde a barra em si, nunca o painel
  function mostrarSacola(mostrar) {
    if (!sacola) return;
    if (mostrar) {
      document.body.classList.add("tem-sacola");
      sacola.hidden = false;
      requestAnimationFrame(function () { sacola.classList.add("sacola--ativa"); });
    } else {
      sacola.classList.remove("sacola--ativa");
      document.body.classList.remove("tem-sacola");
      // só esconde de fato se ainda estiver "desativada" (evita corrida se o
      // cliente adicionar item de novo antes da transição terminar)
      var esconder = function () {
        sacola.removeEventListener("transitionend", esconder);
        if (!sacola.classList.contains("sacola--ativa")) sacola.hidden = true;
      };
      sacola.addEventListener("transitionend", esconder);
      setTimeout(esconder, 280); // fallback sem transição
    }
  }

  // painel de finalização — só abre por toque explícito em "Ver carrinho"
  function abrirCarrinho() {
    if (!sacolaDetalhe || carrinhoAberto) return;
    carrinhoAberto = true;
    sacolaDetalhe.hidden = false;
    if (sacolaBackdrop) sacolaBackdrop.hidden = false;
    if (sacolaToggle) sacolaToggle.setAttribute("aria-expanded", "true");
    requestAnimationFrame(function () {
      sacolaDetalhe.classList.add("sacola__detalhe--ativa");
      if (sacolaBackdrop) sacolaBackdrop.classList.add("sacola-backdrop--ativa");
    });
    // entra uma entrada no histórico só pra que o botão voltar do celular feche o painel
    history.pushState({ carrinhoAberto: true }, "");
  }

  // fecha de fato (chamado pelo popstate, fonte única da transição visual)
  function fecharCarrinhoVisual() {
    if (!sacolaDetalhe || !carrinhoAberto) return;
    carrinhoAberto = false;
    sacolaDetalhe.classList.remove("sacola__detalhe--ativa");
    if (sacolaToggle) sacolaToggle.setAttribute("aria-expanded", "false");
    var esconder = function () {
      sacolaDetalhe.removeEventListener("transitionend", esconder);
      if (!sacolaDetalhe.classList.contains("sacola__detalhe--ativa")) sacolaDetalhe.hidden = true;
    };
    sacolaDetalhe.addEventListener("transitionend", esconder);
    setTimeout(esconder, 280);
    if (sacolaBackdrop) {
      sacolaBackdrop.classList.remove("sacola-backdrop--ativa");
      var escBackdrop = function () {
        sacolaBackdrop.removeEventListener("transitionend", escBackdrop);
        if (!sacolaBackdrop.classList.contains("sacola-backdrop--ativa")) sacolaBackdrop.hidden = true;
      };
      sacolaBackdrop.addEventListener("transitionend", escBackdrop);
      setTimeout(escBackdrop, 280);
    }
  }

  // X, "continuar escolhendo" e toque no fundo passam por aqui: desfazem a
  // entrada no histórico (o popstate acima cuida do fechamento visual)
  function fecharCarrinho() {
    if (!carrinhoAberto) return;
    if (history.state && history.state.carrinhoAberto) history.back();
    else fecharCarrinhoVisual();
  }

  window.addEventListener("popstate", function () {
    if (carrinhoAberto) fecharCarrinhoVisual();
  });

  function atualizarSacola(pulsar, idRecemAdicionado) {
    var n = totalItens();
    if (sacolaContagem) {
      sacolaContagem.textContent = n === 1 ? "1 item" : n + " itens";
      if (pulsar) {
        sacolaContagem.classList.remove("pulsa");
        void sacolaContagem.offsetWidth;
        sacolaContagem.classList.add("pulsa");
      }
    }
    if (sacolaSubtotal) sacolaSubtotal.textContent = n ? formatarReal(totalPreco()) : "";
    if (sacolaItens) {
      sacolaItens.textContent = "";
      carrinho.forEach(function (v, id) {
        var li = document.createElement("li");
        li.className = "sacola__item";
        var nome = document.createElement("span");
        nome.className = "sacola__item-nome";
        nome.textContent = v.nome + (v.tamanho ? " (" + v.tamanho + ")" : "");
        var small = document.createElement("small");
        small.textContent = v.categoria + (v.preco ? " · " + formatarReal(v.preco) : "");
        nome.appendChild(small);
        var st = criarStepper(v.qtd, function (delta) { alterarQtd(id, delta); });
        li.appendChild(nome); li.appendChild(st);
        sacolaItens.appendChild(li);
      });
    }
    if (n === 0) {
      fecharCarrinho();
      mostrarSacola(false);
    } else {
      mostrarSacola(true);
    }
    sincronizarCartoesCardapio(idRecemAdicionado);
  }

  function criarStepper(qtd, aoMudar) {
    var wrap = document.createElement("span");
    wrap.className = "stepper";
    var menos = document.createElement("button");
    menos.type = "button"; menos.textContent = "−";
    menos.setAttribute("aria-label", "Diminuir quantidade");
    var val = document.createElement("span"); val.textContent = qtd;
    var mais = document.createElement("button");
    mais.type = "button"; mais.textContent = "+";
    mais.setAttribute("aria-label", "Aumentar quantidade");
    menos.addEventListener("click", function () { aoMudar(-1); });
    mais.addEventListener("click", function () { aoMudar(1); });
    wrap.appendChild(menos); wrap.appendChild(val); wrap.appendChild(mais);
    return wrap;
  }

  function alterarQtd(id, delta) {
    var it = carrinho.get(id);
    if (!it) return;
    it.qtd += delta;
    if (it.qtd <= 0) carrinho.delete(id);
    atualizarSacola(false);
  }

  function adicionarItem(d) {
    var id = idItem(d);
    var it = carrinho.get(id);
    if (it) it.qtd += 1;
    else carrinho.set(id, {
      nome: d.nome, tamanho: d.tamanho || "", categoria: d.categoria || "Marmita",
      preco: d.preco || 0, qtd: 1
    });
    // só entra na sacola — o painel de finalização não abre sozinho
    atualizarSacola(true, id);
  }

  // troca o botão "+" pelo stepper (e vice-versa) nos cartões do cardápio;
  // idRecemAdicionado recebe um pulso curto de confirmação no próprio botão
  function sincronizarCartoesCardapio(idRecemAdicionado) {
    $$(".item").forEach(function (row) {
      var acao = $(".item__acao", row);
      if (!acao) return;
      var id = row.getAttribute("data-id");
      var it = carrinho.get(id);
      var atual = acao.querySelector(".stepper, .item__mais");
      if (it) {
        if (atual && atual.classList.contains("stepper")) {
          atual.querySelector("span").textContent = it.qtd;
        } else {
          var st = criarStepper(it.qtd, function (delta) { alterarQtd(id, delta); });
          if (atual) acao.replaceChild(st, atual); else acao.appendChild(st);
        }
      } else if (atual && atual.classList.contains("stepper")) {
        acao.replaceChild(botaoMais(row), atual);
      }
      if (id && id === idRecemAdicionado) {
        acao.classList.remove("item__acao--confirmado");
        void acao.offsetWidth;
        acao.classList.add("item__acao--confirmado");
      }
    });
  }

  function botaoMais(row) {
    var b = document.createElement("button");
    var tam = row.getAttribute("data-tam");
    b.type = "button"; b.className = "item__mais"; b.textContent = "+";
    b.setAttribute("aria-label", "Adicionar " + row.getAttribute("data-nome") + (tam ? " tamanho " + tam : "") + " ao pedido");
    b.addEventListener("click", function () {
      adicionarItem({
        nome: row.getAttribute("data-nome"),
        tamanho: row.getAttribute("data-tam") || "",
        categoria: row.getAttribute("data-cat") || "Marmita",
        preco: parseFloat(row.getAttribute("data-preco")) || 0
      });
    });
    return b;
  }

  /* ---------- painel da sacola: abrir só pelo "Ver carrinho" ---------- */
  if (sacolaToggle) sacolaToggle.addEventListener("click", abrirCarrinho);
  if (sacolaFechar) sacolaFechar.addEventListener("click", fecharCarrinho);
  if (sacolaContinuar) sacolaContinuar.addEventListener("click", fecharCarrinho);
  if (sacolaBackdrop) sacolaBackdrop.addEventListener("click", fecharCarrinho);

  /* ---------- retirada / entrega ---------- */
  var campoEndereco = $("#campo-endereco");
  $$('input[name="entrega"]').forEach(function (r) {
    r.addEventListener("change", function () {
      if (campoEndereco) campoEndereco.hidden = !(this.value === "entrega");
    });
  });

  /* ---------- enviar pedido ---------- */
  var btnEnviar = $("#sacola-enviar");
  if (btnEnviar) {
    btnEnviar.addEventListener("click", function () {
      if (totalItens() === 0) return;
      var nome = ($("#sac-nome") || {}).value || "";
      var tipo = (document.querySelector('input[name="entrega"]:checked') || {}).value || "retirada";
      var endereco = ($("#sac-endereco") || {}).value || "";
      var referencia = ($("#sac-referencia") || {}).value || "";
      var pagamento = (document.querySelector('input[name="pagamento"]:checked') || {}).value || "";
      var obs = ($("#sac-obs") || {}).value || "";
      var erroNome = $("#erro-nome");
      var erroEnd = $("#erro-endereco");

      if (!nome.trim()) {
        if (erroNome) erroNome.hidden = false;
        var alvoNome = $("#sac-nome");
        if (alvoNome) { alvoNome.scrollIntoView({ block: "center", behavior: "smooth" }); alvoNome.focus(); }
        return;
      }
      if (erroNome) erroNome.hidden = true;

      if (tipo === "entrega" && !endereco.trim()) {
        if (erroEnd) erroEnd.hidden = false;
        if (campoEndereco) campoEndereco.hidden = false;
        var alvoEnd = $("#sac-endereco");
        if (alvoEnd) { alvoEnd.scrollIntoView({ block: "center", behavior: "smooth" }); alvoEnd.focus(); }
        return;
      }
      if (erroEnd) erroEnd.hidden = true;

      var linhas = ["Olá! Pedido pelo site:", "", "Nome: " + nome.trim(), ""];
      carrinho.forEach(function (v) {
        linhas.push(
          v.qtd + "x " + v.nome + (v.tamanho ? " (" + v.tamanho + ")" : "") +
          (v.preco ? " — " + formatarReal(v.preco) : "")
        );
      });
      linhas.push("");
      linhas.push(tipo === "entrega" ? "Entrega" : "Retirada no balcão");
      if (tipo === "entrega") {
        linhas.push("Endereço: " + endereco.trim());
        if (referencia.trim()) linhas.push("Perto de: " + referencia.trim());
      }
      linhas.push("Pagamento: " + (pagamento || "a combinar"));
      if (obs.trim()) { linhas.push(""); linhas.push("Obs: " + obs.trim()); }
      linhas.push("");
      linhas.push("(valor total e taxa de entrega a combinar)");

      var url = "https://wa.me/" + ZAP + "?text=" + encodeURIComponent(linhas.join("\n"));
      window.__pedidoURL = url; // espelho do último pedido montado (debug/teste)
      var aba = window.open(url, "_blank", "noopener");
      if (!aba) window.location.href = url; // popup bloqueado -> mesma aba
    });
  }

  /* =========================================================
     5. RENDER DO CARDÁPIO
     ========================================================= */
  var caixa = $("#cardapio-lista");

  function indisponivel(v) {
    return ["nao", "não", "n", "0", "false", "off"].indexOf((v || "").toLowerCase().trim()) !== -1;
  }

  // nome do dia pra exibir no título do grupo "Prato do dia" (o valor da
  // planilha fica sem acento: segunda/terca/quarta/quinta/sexta)
  var DIA_EXIBICAO = {
    segunda: "Segunda", terca: "Terça", quarta: "Quarta",
    quinta: "Quinta", sexta: "Sexta", sabado: "Sábado", domingo: "Domingo"
  };

  function montarCardapio(itens) {
    caixa.textContent = "";
    var hojeSlug = DIAS_SEM_ACENTO[horaBrasilia().wd];

    var validos = itens.filter(function (o) {
      if ((o.nome || "").trim() === "") return false;
      var dia = normalizarDia(o.dia);
      // sem dia marcado = todo santo dia; com dia marcado, só aparece no dia certo
      return !dia || dia === hojeSlug;
    });

    if (!validos.length) { estadoSemCardapio(); return; }

    var grupos = {};
    var ordem = [];
    validos.forEach(function (o) {
      var cat = (o.categoria || "Marmita").trim();
      if (!grupos[cat]) { grupos[cat] = []; ordem.push(cat); }
      grupos[cat].push(o);
    });

    // dentro de cada grupo: tudo do mesmo nome junto (Frango, Frango, Frango...),
    // e dentro do nome sempre P -> M -> G — não depende da ordem das linhas na planilha
    var ORDEM_TAMANHO = { P: 0, M: 1, G: 2 };
    ordem.forEach(function (cat) {
      var nomesNaOrdem = [];
      grupos[cat].forEach(function (o) {
        var n = (o.nome || "").trim();
        if (nomesNaOrdem.indexOf(n) === -1) nomesNaOrdem.push(n);
      });
      grupos[cat] = grupos[cat].slice().sort(function (a, b) {
        var na = nomesNaOrdem.indexOf((a.nome || "").trim());
        var nb = nomesNaOrdem.indexOf((b.nome || "").trim());
        if (na !== nb) return na - nb;
        var ta = ORDEM_TAMANHO[(a.tamanho || "").trim().toUpperCase()];
        var tb = ORDEM_TAMANHO[(b.tamanho || "").trim().toUpperCase()];
        if (ta === undefined) ta = 99;
        if (tb === undefined) tb = 99;
        return ta - tb;
      });
    });

    ordem.forEach(function (cat) {
      var g = document.createElement("div");
      g.className = "cardapio__grupo";
      var h = document.createElement("h3");
      h.className = "cardapio__grupo-titulo";
      // "Prato do dia" ganha o nome do dia de hoje no título (ex.: "Prato de Quinta")
      h.textContent = cat.toLowerCase() === "prato do dia"
        ? "Prato de " + (DIA_EXIBICAO[hojeSlug] || cat)
        : cat;
      g.appendChild(h);

      grupos[cat].forEach(function (o) {
        var row = document.createElement("div");
        row.className = "item";
        var esgotado = indisponivel(o.disponivel);
        var tam = (o.tamanho || "").trim();
        var preco = parseFloat((o.preco || "").replace(",", "."));
        if (isNaN(preco)) preco = 0;
        var d = { nome: o.nome.trim(), tamanho: tam, categoria: cat };
        row.setAttribute("data-id", idItem(d));
        row.setAttribute("data-nome", d.nome);
        row.setAttribute("data-tam", tam);
        row.setAttribute("data-cat", cat);
        row.setAttribute("data-preco", preco);

        var nome = document.createElement("div");
        nome.className = "item__nome";
        nome.textContent = d.nome;
        row.appendChild(nome);

        var leader = document.createElement("span");
        leader.className = "item__leader";
        leader.setAttribute("aria-hidden", "true");
        row.appendChild(leader);

        var acao = document.createElement("div");
        acao.className = "item__acao";
        if (esgotado) {
          row.classList.add("item--esgotado");
          var tag = document.createElement("span");
          tag.className = "item__tag-esgotado";
          tag.textContent = "acabou hoje";
          acao.appendChild(tag);
        } else {
          if (tam) {
            var chip = document.createElement("span");
            chip.className = "item__tam";
            chip.textContent = tam;
            acao.appendChild(chip);
          }
          if (preco) {
            var precoEl = document.createElement("span");
            precoEl.className = "item__preco";
            precoEl.textContent = formatarReal(preco);
            acao.appendChild(precoEl);
          }
          acao.appendChild(botaoMais(row));
        }
        row.appendChild(acao);

        if ((o.descricao || "").trim()) {
          var desc = document.createElement("p");
          desc.className = "item__desc";
          desc.textContent = o.descricao.trim();
          row.appendChild(desc);
        }
        g.appendChild(row);
      });
      caixa.appendChild(g);
    });

    caixa.setAttribute("aria-busy", "false");
    sincronizarCartoesCardapio();
    guardarCache(itens); // guarda tudo (todos os dias) pro cache continuar valendo amanhã
  }

  function estadoSemCardapio() {
    caixa.textContent = "";
    var p = document.createElement("p");
    p.className = "cardapio__erro";
    p.appendChild(document.createTextNode("O cardápio de hoje ainda não foi publicado. "));
    var a = document.createElement("a");
    a.href = "https://wa.me/" + ZAP;
    a.rel = "noopener";
    a.textContent = "Chame no WhatsApp";
    p.appendChild(a);
    p.appendChild(document.createTextNode(" para saber o que tem hoje."));
    caixa.appendChild(p);
    caixa.setAttribute("aria-busy", "false");
  }

  function guardarCache(itens) {
    try {
      sessionStorage.setItem("cardapio_cache", JSON.stringify({ t: Date.now(), itens: itens }));
    } catch (e) { /* modo privado: sem cache, tudo bem */ }
  }
  function lerCache() {
    try {
      var raw = sessionStorage.getItem("cardapio_cache");
      if (!raw) return null;
      return JSON.parse(raw).itens || null;
    } catch (e) { return null; }
  }

  /* =========================================================
     6. GALERIA + LIGHTBOX
     ========================================================= */
  (function galeria() {
    var lista = $("#galeria");
    var vazia = $("#galeria-vazia");
    var botoes = lista ? $$(".galeria__abrir", lista) : [];
    if (!lista || !botoes.length) return;

    lista.hidden = false;
    if (vazia) vazia.hidden = true;

    var lb = $("#lightbox");
    var lbImg = $("#lightbox-img");
    var lbFechar = $("#lightbox-fechar");
    var ultimoFoco = null;

    function abrir(src, alt) {
      ultimoFoco = document.activeElement;
      lbImg.src = src; lbImg.alt = alt || "";
      lb.hidden = false;
      lbFechar.focus();
      document.addEventListener("keydown", onKey);
    }
    function fechar() {
      lb.hidden = true; lbImg.src = "";
      document.removeEventListener("keydown", onKey);
      if (ultimoFoco) ultimoFoco.focus();
    }
    function onKey(e) { if (e.key === "Escape") fechar(); }

    botoes.forEach(function (b) {
      b.addEventListener("click", function () {
        var img = b.querySelector("img");
        abrir(b.getAttribute("data-full") || (img && img.src), img && img.alt);
      });
    });
    lbFechar.addEventListener("click", fechar);
    lb.addEventListener("click", function (e) { if (e.target === lb) fechar(); });
  })();

  /* =========================================================
     BOOT
     ========================================================= */
  // sábado: sem tele-entrega, só busca no local (e por lá é só a quilo) —
  // regra fixa do restaurante, não depende da planilha
  function aplicarRegraSabado() {
    if (!SABADO_SEM_ENTREGA || horaBrasilia().wd !== DIA_SABADO) return false;
    entregaAtiva = false;
    var op = $("#op-entrega"); if (op) op.hidden = true;
    var radioRetirada = document.querySelector('input[name="entrega"][value="retirada"]');
    if (radioRetirada) radioRetirada.checked = true;
    if (campoEndereco) campoEndereco.hidden = true;
    var nota = $("#cardapio-obs-entrega");
    if (nota) {
      nota.textContent = "Aos sábados o restaurante funciona só com buffet a quilo, no local — sem tele-entrega.";
      nota.hidden = false;
    }
    return true;
  }

  function boot() {
    // status já com defaults, antes mesmo da planilha responder
    pintarStatus({});
    setInterval(function () { pintarStatus(window.__cfg || {}); }, 30000);

    var ehSabado = aplicarRegraSabado();

    if (!caixa) return;

    var csv = (caixa.getAttribute("data-csv") || "").trim();
    var csvDemo = (caixa.getAttribute("data-csv-demo") || "").trim();
    var configCsv = (caixa.getAttribute("data-config-csv") || "").trim();
    var configDemo = (caixa.getAttribute("data-config-demo") || "").trim();

    var ehReal = /^https?:\/\//i.test(csv);
    var urlCardapio = ehReal ? csv : csvDemo;
    var urlConfig = /^https?:\/\//i.test(configCsv) ? configCsv : configDemo;

    // config (não bloqueia o cardápio)
    if (urlConfig) {
      buscarCSV(urlConfig)
        .then(function (t) {
          var cfg = lerConfig(csvParaObjetos(t));
          window.__cfg = cfg;
          if (!ehSabado) {
            if (cfg.entrega_ativa && indisponivel(cfg.entrega_ativa)) {
              entregaAtiva = false;
              var op = $("#op-entrega"); if (op) op.hidden = true;
            }
            if (cfg.obs_entrega) {
              var nota = $("#cardapio-obs-entrega");
              if (nota) { nota.textContent = cfg.obs_entrega; nota.hidden = false; }
            }
          }
          // sábado sempre vence: reaplica caso a planilha tente religar a entrega
          aplicarRegraSabado();
          aplicarAviso(cfg);
          pintarStatus(cfg);
        })
        .catch(function () { /* sem config: segue com defaults */ });
    }

    // cardápio
    if (!urlCardapio) { estadoSemCardapio(); return; }
    buscarCSV(urlCardapio)
      .then(function (t) { montarCardapio(csvParaObjetos(t)); })
      .catch(function () {
        var cache = lerCache();
        if (cache && cache.length) {
          montarCardapio(cache);
          var nota = document.createElement("p");
          nota.className = "cardapio__nota";
          nota.textContent = "Mostrando o último cardápio carregado — pode estar desatualizado.";
          caixa.appendChild(nota);
        } else {
          estadoSemCardapio();
        }
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
