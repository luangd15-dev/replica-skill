# Vértice

Aplicativo desktop para projeto de edificações: arquitetura, estrutura, elétrico,
hidrossanitário e SPDA, com planta 2D, vista 3D e DWG/DXF. Interface clara com
ribbon, árvore do projeto, painel de propriedades e mensagens.

Escrito do zero (Electron + Three.js). Não contém código, ícones, textos ou
arquivos de nenhum software comercial.

## Interface

- Barra de título com atalhos e o nome do projeto; ribbon com ARQUIVO, DESENHOS, ELEMENTOS,
  LANÇAMENTO (muda conforme a rede escolhida: elétrica, água fria, esgoto, estrutura, SPDA,
  arquitetura), 3D e OPERAÇÕES.
- Janelas em abas por pavimento e disciplina ("Térreo - Fiação", "Térreo - Hidráulico",
  "Visão 3D"...), abertas com duplo clique na árvore Edificação.
- Painel lateral com Edificação, Propriedades (grade com categorias), Camadas e Mensagens.
- Barra de status com comando atual, coordenadas, escala 1:N, zoom, grade, snap, orto e
  filtro de seleção.
- DESENHOS: linha, retângulo, círculo, texto, medir, rotacionar, espelhar, copiar/colar e
  filtro de seleção por classe. LANÇAMENTO: altura e posição de inserção dos pontos.
- 3D: enquadrar, vistas (topo, frente, lateral, isométrica), projeção ortográfica, corte
  horizontal, planos dos pavimentos, só até o pavimento atual, cor de fundo, eletrodutos e
  quadros em 3D.

## Disciplinas

| aba | o que faz | cálculo (simplificado, referência) |
| --- | --- | --- |
| Arquitetura | paredes, pavimentos, níveis intermediários, referência DWG/DXF, paredes a partir do desenho | |
| Estrutural | pilares, vigas, lajes, lançamento automático (pilares em cantos/encontros/vãos > 5 m, vigas sobre paredes, lajes nos ambientes) | lajes → vigas (charneiras 45°) → pilares → fundação; flexão de vigas, pilares à compressão, sapatas (NBR 6118/6120, C25/CA-50) |
| Elétrico | entrada de serviço, quadro de medição, QD e caixa de passagem; luz, arandela, ventilador, interruptor simples/paralelo/intermediário, dimmer, sensor, TUG, TUE, campainha; ambientes; comandos (a, b, c…); circuitos e reservas | ver abaixo |
| Hidrossanitário | reservatório, caixa de inspeção, bacia, lavatório, chuveiro, pia, tanque, máquina de lavar | água fria por pesos, Ø por v ≤ 3 m/s, pressões com Fair-Whipple-Hsiao (NBR 5626); esgoto por UHC (NBR 8160) |
| SPDA | captação em malha, descidas, anel de aterramento | método das malhas por nível I–IV (NBR 5419-3) |

### Elétrico (NBR 5410)

- **Eletrodutos automáticos**: a rede de cada quadro é gerada sem desenhar trecho a trecho
  (árvore mínima com distâncias ortogonais e descidas de teto); circuitos diferentes
  evitam dividir o mesmo trecho e TUE ganha eletroduto exclusivo.
- **Fiação por trecho**: fase, neutro, terra e retornos de cada comando, travessas entre
  paralelos; diâmetro do eletroduto pela taxa de ocupação de 40%.
- **Dimensionamento**: seção por capacidade de condução com agrupamento real (tab. 42) e
  temperatura (tab. 40), queda de tensão pelo comprimento da rede, disjuntor com
  Ib ≤ In ≤ Iz, equilíbrio de fases, demanda, alimentadores e disjuntor geral.
- **Proteção**: DR obrigatório pelo tipo de ambiente, agrupado em até 4 circuitos,
  DPS, reservas mínimas e tamanho do quadro em módulos DIN.
- **Lançamento automático**: reconhecimento de ambientes (nomes do DWG), luminárias pelo
  método dos lúmens e tomadas pelos mínimos da NBR 5410 9.5.2.
- **Gerenciador elétrico**: árvore entrada → medição → quadros → circuitos → comandos,
  com arrastar e soltar; alertas na planta; centro de cargas.
- **Documentos**: diagrama unifilar (SVG/PDF), quadro de cargas, memorial descritivo,
  relatório luminotécnico, lista de materiais.

Relatórios: quadro de cargas, vigas, pilares, fundações, água fria, esgoto, SPDA,
lista de materiais de todas as disciplinas e verificações, em CSV, HTML ou PDF.

## DWG e DXF

- **Importar** (Arquivo ou Arquitetura > Importar DWG/DXF): o desenho entra como
  referência do pavimento, com camadas liga/desliga, unidade detectada (mm, cm, m) e
  blocos explodidos. Opcionalmente, linhas duplas de parede viram paredes do modelo,
  unidas nos cantos e encontros.
- **Exportar** (Arquivo > Exportar pavimento / todos): DWG ou DXF AutoCAD 2000, com
  camadas por disciplina (ARQ-, EST-, ELE-, HID-, SPDA, REF-).

A conversão DWG ↔ DXF usa o [LibreDWG](https://www.gnu.org/software/libredwg/)
(GNU, GPL-3.0), que roda como programa separado em `resources/libredwg`. O DWG
gravado pelo LibreDWG é marcado como experimental pelo próprio projeto; se algum
programa recusar o DWG, exporte em DXF, que todos os CADs leem.

## Usar

Atalhos: Ctrl+Z/Y, Ctrl+S, Ctrl+O, Ctrl+N, Ctrl+C/V (copiar e colar blocos, inclusive
em outro pavimento), Ctrl+A, Del, Esc, F7 grade, F8 orto, F9 snap.
Seleção por área: arraste no vazio (da esquerda para a direita pega o que está dentro;
da direita para a esquerda, o que toca). No 3D: Shift + arrastar.
Roda do mouse: zoom. Botão do meio, botão direito ou Espaço + arrastar: deslocar.
A aba ativa destaca a sua disciplina; Visualizar liga e desliga disciplinas e muda o
estilo das linhas de chamada (simples, círculo, retângulo).

## Desenvolver

```bash
npm install
npm run libredwg   # baixa os conversores DWG (uma vez)
npm start          # roda o app
npm test           # testes dos cálculos, DXF e importação
npm run dist:win   # gera dist/Vertice-<versão>-portatil.exe e -instalador.exe
```

No Linux, `dist:win` precisa do Wine para gerar o instalador NSIS, e o app usa o
Wine para rodar os conversores DWG.

## Limites

Todos os cálculos são simplificados, para estudo e pré-dimensionamento; o projeto final
é responsabilidade de um profissional habilitado. Não há verificação de flechas,
punção, torção, armadura de cisalhamento detalhada, água quente, águas pluviais,
gás, nem análise de risco de SPDA.
