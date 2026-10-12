# Vértice

Aplicativo desktop para projeto elétrico predial: planta 2D, vista 3D, circuitos e
dimensionamento simplificado (referência NBR 5410). Interface clara com ribbon,
árvore do projeto, painel de propriedades e mensagens.

Escrito do zero (Electron + Three.js). Não contém código, ícones, textos ou
arquivos de nenhum software comercial.

## Usar

| ação | onde |
| --- | --- |
| Desenhar paredes | Arquitetura > Parede (duplo clique ou Esc encerra) |
| Novo pavimento | Arquitetura > Novo pavimento (copia as paredes do anterior) |
| Quadro, luz, interruptor, TUG, TUE | Elétrico > Pontos (entram no circuito ativo se o tipo bate) |
| Circuitos | Elétrico > Novo circuito / Atribuir circuito; tipo e tensão em Propriedades |
| Dimensionar | Elétrico > Dimensionar: corrente, cabo, disjuntor, queda de tensão |
| Relatórios | Relatórios > Quadro de cargas, Lista de materiais, Verificações (CSV/HTML) |
| Arquivos | Arquivo > Novo / Abrir / Salvar (`.vtx`, JSON) |

Atalhos: Ctrl+Z/Y, Ctrl+S, Ctrl+O, Ctrl+N, Del, Esc, F7 grade, F8 orto, F9 snap.
Roda do mouse: zoom. Botão do meio, botão direito ou Espaço + arrastar: deslocar.

## Desenvolver

```bash
npm install
npm start          # roda o app
npm test           # testes do cálculo elétrico
npm run dist:win   # gera dist/Vertice-<versão>-portatil.exe e -instalador.exe
```

No Linux, `dist:win` precisa do Wine para gerar o instalador NSIS.

## Limites do cálculo

Método B1 (eletroduto embutido), cobre/PVC 70 °C, 2 condutores carregados, sem
fatores de agrupamento ou temperatura. Comprimento estimado pela rota de vizinho
mais próximo +20% mais descidas. Serve para estudo; o projeto final é
responsabilidade de um profissional habilitado.
