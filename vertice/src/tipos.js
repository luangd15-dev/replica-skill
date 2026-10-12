// Tipos de elementos pontuais, por disciplina.
// ele: elétrico · hid: hidrossanitário · est: estrutural
//
// Hidráulica (referências NBR 5626 e NBR 8160):
//   peso    peso relativo de água fria (método dos pesos)
//   uhc     unidades Hunter de contribuição de esgoto
//   dnEsg   diâmetro nominal mínimo do ramal de descarga (mm)

export const TIPOS = {
  // elétrico
  luz: { disc: 'ele', nome: 'Ponto de luz', sigla: 'L', potencia: 100, altura: 2.8, grupo: 'ILUM' },
  tug: { disc: 'ele', nome: 'Tomada de uso geral', sigla: 'TUG', potencia: 100, altura: 0.3, grupo: 'TUG' },
  tue: { disc: 'ele', nome: 'Tomada de uso específico', sigla: 'TUE', potencia: 1500, altura: 1.1, grupo: 'TUE' },
  interruptor: { disc: 'ele', nome: 'Interruptor', sigla: 'S', potencia: 0, altura: 1.1, grupo: 'ILUM' },
  qd: { disc: 'ele', nome: 'Quadro de distribuição', sigla: 'QD', potencia: 0, altura: 1.5, grupo: null },

  // hidrossanitário
  reservatorio: { disc: 'hid', nome: 'Reservatório (água fria)', sigla: 'RES', altura: 4.0 },
  ci: { disc: 'hid', nome: 'Caixa de inspeção (saída de esgoto)', sigla: 'CI', altura: -0.4 },
  bacia: { disc: 'hid', nome: 'Bacia sanitária c/ caixa acoplada', sigla: 'BS', altura: 0.2, peso: 0.3, uhc: 6, dnEsg: 100 },
  lavatorio: { disc: 'hid', nome: 'Lavatório', sigla: 'LV', altura: 0.6, peso: 0.3, uhc: 1, dnEsg: 40 },
  chuveiro: { disc: 'hid', nome: 'Chuveiro', sigla: 'CH', altura: 2.1, peso: 0.4, uhc: 2, dnEsg: 40 },
  pia: { disc: 'hid', nome: 'Pia de cozinha', sigla: 'PIA', altura: 1.0, peso: 0.7, uhc: 3, dnEsg: 50 },
  tanque: { disc: 'hid', nome: 'Tanque', sigla: 'TQ', altura: 0.9, peso: 0.7, uhc: 3, dnEsg: 40 },
  mlr: { disc: 'hid', nome: 'Máquina de lavar roupa', sigla: 'MLR', altura: 0.9, peso: 1.0, uhc: 3, dnEsg: 50 },

  // estrutural
  pilar: { disc: 'est', nome: 'Pilar', sigla: 'P', altura: 0, b: 20, h: 30 },
};

export const DISCIPLINAS = {
  arq: 'Arquitetura',
  est: 'Estrutural',
  ele: 'Elétrico',
  hid: 'Hidrossanitário',
  spda: 'SPDA',
  fundo: 'Referência DWG/DXF',
};

export const tiposDa = (disc) => Object.keys(TIPOS).filter((k) => TIPOS[k].disc === disc);
