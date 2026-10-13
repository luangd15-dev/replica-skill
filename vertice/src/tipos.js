// Tipos de elementos pontuais, por disciplina.
// ele: elétrico · hid: hidrossanitário · est: estrutural
//
// Hidráulica (referências NBR 5626 e NBR 8160):
//   peso    peso relativo de água fria (método dos pesos)
//   uhc     unidades Hunter de contribuição de esgoto
//   dnEsg   diâmetro nominal mínimo do ramal de descarga (mm)

export const TIPOS = {
  // elétrico
  //   carga: entra no circuito com potência; comando: recebe letra de comando (a, b, c...)
  luz: { disc: 'ele', nome: 'Lâmpada de teto', sigla: 'L', potencia: 100, altura: 2.8, grupo: 'ILUM', carga: true, comandada: true, caixa: 'oct' },
  arandela: { disc: 'ele', nome: 'Arandela (luz de parede)', sigla: 'AR', potencia: 60, altura: 2.1, grupo: 'ILUM', carga: true, comandada: true, caixa: '4x2' },
  ventilador: { disc: 'ele', nome: 'Ventilador de teto', sigla: 'VT', potencia: 120, altura: 2.8, grupo: 'ILUM', carga: true, comandada: true, caixa: 'oct' },
  interruptor: { disc: 'ele', nome: 'Interruptor simples', sigla: 'S', potencia: 0, altura: 1.1, grupo: 'ILUM', comando: 'simples', caixa: '4x2' },
  paralelo: { disc: 'ele', nome: 'Interruptor paralelo (three-way)', sigla: 'S3W', potencia: 0, altura: 1.1, grupo: 'ILUM', comando: 'paralelo', caixa: '4x2' },
  intermediario: { disc: 'ele', nome: 'Interruptor intermediário (four-way)', sigla: 'S4W', potencia: 0, altura: 1.1, grupo: 'ILUM', comando: 'intermediario', caixa: '4x2' },
  dimmer: { disc: 'ele', nome: 'Dimmer', sigla: 'DIM', potencia: 0, altura: 1.1, grupo: 'ILUM', comando: 'dimmer', caixa: '4x2' },
  sensor: { disc: 'ele', nome: 'Sensor de presença', sigla: 'SP', potencia: 0, altura: 2.8, grupo: 'ILUM', comando: 'sensor', caixa: 'oct' },
  tug: { disc: 'ele', nome: 'Tomada de uso geral', sigla: 'TUG', potencia: 100, altura: 0.3, grupo: 'TUG', carga: true, caixa: '4x2' },
  tue: { disc: 'ele', nome: 'Tomada de uso específico', sigla: 'TUE', potencia: 1500, altura: 1.1, grupo: 'TUE', carga: true, caixa: '4x2' },
  campainha: { disc: 'ele', nome: 'Campainha', sigla: 'CA', potencia: 30, altura: 2.2, grupo: 'ILUM', carga: true, caixa: '4x2' },
  pulsador: { disc: 'ele', nome: 'Pulsador de campainha', sigla: 'PU', potencia: 0, altura: 1.3, grupo: 'ILUM', comando: 'pulsador', caixa: '4x2' },
  qd: { disc: 'ele', nome: 'Quadro de distribuição', sigla: 'QD', potencia: 0, altura: 1.5, grupo: null, quadro: true },
  qm: { disc: 'ele', nome: 'Quadro de medição', sigla: 'QM', potencia: 0, altura: 1.5, grupo: null, quadro: true },
  es: { disc: 'ele', nome: 'Entrada de serviço', sigla: 'ES', potencia: 0, altura: 0, grupo: null, quadro: true },
  cp: { disc: 'ele', nome: 'Caixa de passagem', sigla: 'CP', potencia: 0, altura: 0.3, grupo: null, caixa: 'cp' },

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

// tipos de ambiente: iluminância recomendada (lux, ref. NBR ISO/CIE 8995-1, residencial) e regra
// de tomadas da NBR 5410 (9.5.2.2)
export const AMBIENTES = {
  sala: { nome: 'Sala / estar', lux: 200, tomadas: 'perimetro5' },
  quarto: { nome: 'Dormitório', lux: 150, tomadas: 'perimetro5' },
  cozinha: { nome: 'Cozinha / copa', lux: 300, tomadas: 'molhada', dr: true },
  servico: { nome: 'Área de serviço / lavanderia', lux: 200, tomadas: 'molhada', dr: true },
  banheiro: { nome: 'Banheiro', lux: 200, tomadas: 'banheiro', dr: true },
  varanda: { nome: 'Varanda / área externa', lux: 100, tomadas: 'varanda', dr: true },
  garagem: { nome: 'Garagem', lux: 100, tomadas: 'outros', dr: true },
  circulacao: { nome: 'Circulação / corredor', lux: 100, tomadas: 'outros' },
  escritorio: { nome: 'Escritório', lux: 500, tomadas: 'perimetro5' },
  outro: { nome: 'Outro', lux: 150, tomadas: 'outros' },
};

export const tiposDa = (disc) => Object.keys(TIPOS).filter((k) => TIPOS[k].disc === disc);
