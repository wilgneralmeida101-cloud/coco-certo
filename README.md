# 🥥 Coco Certo

Aplicativo para celular que ajuda vendedores de água de coco a decidir quantos cocos comprar toda semana, sem chute.

- **Início:** anotar as vendas do dia e o tempo; resumo da semana; previsão do tempo.
- **Pedido:** poucas perguntas, uma por tela, e a quantidade sugerida para comprar na terça, com a conta explicada.
- **Relatório:** vendas, gastos, perdas com cocos estragados e leituras automáticas (melhor dia, efeito da chuva e de feriados, acerto da previsão, tendência).
- **Colocar meu histórico:** lançar vendas antigas por dia, por semana ou colando uma planilha (CSV).
- **Onde fica a banca:** qualquer cidade (GPS ou busca); previsão do tempo do lugar, feriados nacionais e estaduais, e dias especiais da cidade cadastrados pelo vendedor.
- **Ajustes:** anotar vendas do dia (opcional), preços, tamanho da letra, lembrete na agenda, cópia de segurança, dados de exemplo.

Funciona sem internet depois de aberto uma vez e pode ser instalado na tela inicial. Os dados ficam só no celular de quem usa.

## Como a sugestão é calculada

1. Previsão de cada dia dos próximos 7 dias a partir da entrega de terça, pela média de cada dia da semana nas últimas 4 semanas (sem histórico: estimativa do vendedor, 5 dias úteis + 2 de fim de semana).
2. Feriado em dia útil vende como domingo; dia com chance de chuva ≥ 60% vende menos (o app aprende quanto).
3. Mais 10% de reserva (20% se faltou coco na semana anterior).
4. Menos os cocos bons em estoque, descontando o que ainda deve ser vendido até a entrega.
5. Nunca negativo, arredondado para cima.

As regras ficam em `calculo.js`. Para ver com dados fictícios, abra com `?exemplo` no endereço.
