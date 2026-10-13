// Exportação do modelo em IFC4 (ISO 16739, formato STEP) para compatibilização em softwares BIM.
// Geometria por extrusão: paredes, pilares, vigas, lajes, eletrodutos, tubulações e pontos.
// Eixos: X do Vértice = X do IFC; Y do Vértice (para baixo na tela) = -Y do IFC; Z para cima.
import { TIPOS } from './tipos.js';

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
function guid() {
  // GUID IFC: 128 bits em 22 caracteres (base 64 própria do IFC)
  const b = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues?.(b) || b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256)));
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = '';
  for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; }
  return s;
}
// texto STEP: apóstrofo duplicado e acentos em \X2\....\X0\
function str(t) {
  if (t == null) return '$';
  const s = String(t).replace(/'/g, "''").replace(/\\/g, '\\\\');
  return `'${s.replace(/[^\x20-\x7e]+/g, (m) => `\\X2\\${[...m].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')}\\X0\\`)}'`;
}
const num = (v) => { const x = Math.round(Number(v) * 1e6) / 1e6; return Number.isInteger(x) ? `${x}.` : String(x); };

export function exportarIfc(projeto, calc, { autor = '', app = 'Vértice', versao = '' } = {}) {
  const linhas = [];
  let id = 0;
  const E = (txt) => { linhas.push(`#${++id}=${txt};`); return `#${id}`; };
  const pt = (x, y, z) => E(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  const pt2 = (x, y) => E(`IFCCARTESIANPOINT((${num(x)},${num(y)}))`);
  const dir = (x, y, z) => E(`IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);
  const eixo = (o, z, x) => E(`IFCAXIS2PLACEMENT3D(${o},${z || '$'},${x || '$'})`);

  // ---- contexto e unidades
  const pessoa = E(`IFCPERSON($,${str(autor || 'Projetista')},$,$,$,$,$,$)`);
  const org = E(`IFCORGANIZATION($,${str(app)},$,$,$)`);
  const po = E(`IFCPERSONANDORGANIZATION(${pessoa},${org},$)`);
  const appl = E(`IFCAPPLICATION(${org},${str(versao || '1')},${str(app)},${str(app)})`);
  const hist = E(`IFCOWNERHISTORY(${po},${appl},$,.ADDED.,$,$,$,${Math.floor(Date.now() / 1000)})`);
  const origem = pt(0, 0, 0);
  const zUp = dir(0, 0, 1), xDir = dir(1, 0, 0);
  const mundo = eixo(origem, zUp, xDir);
  const ctx = E(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${mundo},$)`);
  const ctxBody = E(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const uL = E('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const uA = E('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const uV = E('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const uAng = E('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const uP = E('IFCSIUNIT(*,.POWERUNIT.,$,.WATT.)');
  const unid = E(`IFCUNITASSIGNMENT((${uL},${uA},${uV},${uAng},${uP}))`);
  const proj = E(`IFCPROJECT('${guid()}',${hist},${str(projeto.nome || 'Projeto')},$,$,$,$,(${ctx}),${unid})`);

  const lpSite = E(`IFCLOCALPLACEMENT($,${eixo(pt(0, 0, 0))})`);
  const site = E(`IFCSITE('${guid()}',${hist},'Terreno',$,$,${lpSite},$,$,.ELEMENT.,$,$,$,$,$)`);
  const lpBld = E(`IFCLOCALPLACEMENT(${lpSite},${eixo(pt(0, 0, 0))})`);
  const bld = E(`IFCBUILDING('${guid()}',${hist},${str(projeto.nome || 'Edificação')},$,$,${lpBld},$,$,.ELEMENT.,$,$,$)`);
  E(`IFCRELAGGREGATES('${guid()}',${hist},$,$,${proj},(${site}))`);
  E(`IFCRELAGGREGATES('${guid()}',${hist},$,$,${site},(${bld}))`);

  // ---- geometria
  const forma = (solido) => E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${E(`IFCSHAPEREPRESENTATION(${ctxBody},'Body','SweptSolid',(${solido}))`)}))`);
  // prisma retangular: base w × d (em planta, centrada), altura h, girado de ang em torno de Z
  const caixa = (w, d, h) => {
    const perfil = E(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${E(`IFCAXIS2PLACEMENT2D(${pt2(0, 0)},$)`)},${num(Math.max(w, 0.001))},${num(Math.max(d, 0.001))})`);
    return E(`IFCEXTRUDEDAREASOLID(${perfil},${eixo(pt(0, 0, 0))},${zUp},${num(Math.max(h, 0.001))})`);
  };
  // extrusão de um perfil ao longo do segmento p→q (eixo local Z na direção do segmento)
  const barra = (perfilDef, p, q) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return null;
    const ax = [dx / L, dy / L, dz / L];
    const ref = Math.abs(ax[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const pl = eixo(pt(...p), dir(...ax), dir(...ref));
    return E(`IFCEXTRUDEDAREASOLID(${perfilDef},${pl},${zUp},${num(L)})`);
  };
  const perfilCirc = (r) => E(`IFCCIRCLEPROFILEDEF(.AREA.,$,${E(`IFCAXIS2PLACEMENT2D(${pt2(0, 0)},$)`)},${num(Math.max(r, 0.002))})`);
  const perfilRet = (a, b) => E(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${E(`IFCAXIS2PLACEMENT2D(${pt2(0, 0)},$)`)},${num(a)},${num(b)})`);

  const psets = [];
  const props = (obj, nome, valores) => {
    const ps = Object.entries(valores).filter(([, v]) => v != null && v !== '').map(([k, v]) => E(`IFCPROPERTYSINGLEVALUE(${str(k)},$,${typeof v === 'number' ? `IFCREAL(${num(v)})` : `IFCLABEL(${str(v)})`},$)`));
    if (!ps.length) return;
    const set = E(`IFCPROPERTYSET('${guid()}',${hist},${str(nome)},$,(${ps.join(',')}))`);
    psets.push([obj, set]);
  };

  const storeys = [];
  const Y = (y) => -y;
  const resumo = { paredes: 0, pilares: 0, vigas: 0, lajes: 0, eletrodutos: 0, pontos: 0, tubos: 0 };
  for (const pav of projeto.pavimentos) {
    const lpSt = E(`IFCLOCALPLACEMENT(${lpBld},${eixo(pt(0, 0, pav.cota))})`);
    const st = E(`IFCBUILDINGSTOREY('${guid()}',${hist},${str(pav.nome)},$,$,${lpSt},$,$,.ELEMENT.,${num(pav.cota)})`);
    storeys.push(st);
    const dentro = [];
    const coloca = (x, y, z, ang = 0) => E(`IFCLOCALPLACEMENT(${lpSt},${eixo(pt(x, Y(y), z), zUp, dir(Math.cos(ang), Math.sin(ang), 0))})`);
    const solto = () => E(`IFCLOCALPLACEMENT(${lpSt},${eixo(pt(0, 0, 0))})`);

    for (const w of pav.paredes) {
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      if (L < 0.01) continue;
      const ang = Math.atan2(Y(w.y2) - Y(w.y1), w.x2 - w.x1);
      dentro.push(E(`IFCWALL('${guid()}',${hist},'Parede',$,$,${coloca((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, 0, ang)},${forma(caixa(L + w.esp, w.esp, pav.peDireito))},$,.STANDARD.)`));
      resumo.paredes++;
    }
    let np = 0;
    for (const e of pav.elementos) {
      if (e.tipo !== 'pilar') continue;
      np++;
      const o = E(`IFCCOLUMN('${guid()}',${hist},${str(`P${np}`)},$,$,${coloca(e.x, e.y, 0)},${forma(caixa(e.b / 100, e.h / 100, pav.peDireito))},$,.COLUMN.)`);
      props(o, 'Pset_Vertice_Pilar', { 'Seção (cm)': `${e.b}x${e.h}` });
      dentro.push(o);
      resumo.pilares++;
    }
    (pav.vigas || []).forEach((v, i) => {
      const zc = pav.peDireito - v.h / 200;
      const s = barra(perfilRet(v.h / 100, v.b / 100), [v.x1, Y(v.y1), zc], [v.x2, Y(v.y2), zc]);
      if (!s) return;
      dentro.push(E(`IFCBEAM('${guid()}',${hist},${str(`V${i + 1}`)},$,$,${solto()},${forma(s)},$,.BEAM.)`));
      resumo.vigas++;
    });
    (pav.lajes || []).forEach((l, i) => {
      const h = (l.h || 10) / 100;
      dentro.push(E(`IFCSLAB('${guid()}',${hist},${str(`L${i + 1}`)},$,$,${coloca((l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2, pav.peDireito - h)},${forma(caixa(l.x2 - l.x1, l.y2 - l.y1, h))},$,.FLOOR.)`));
      resumo.lajes++;
    });

    // pontos elétricos e hidrossanitários: caixas pequenas na altura de instalação
    const CLASSE = {
      luz: ['IFCLIGHTFIXTURE', '.POINTSOURCE.'], arandela: ['IFCLIGHTFIXTURE', '.DIRECTIONSOURCE.'], ventilador: ['IFCFAN', '.NOTDEFINED.'],
      tug: ['IFCOUTLET', '.POWEROUTLET.'], tue: ['IFCOUTLET', '.POWEROUTLET.'],
      interruptor: ['IFCSWITCHINGDEVICE', '.TOGGLESWITCH.'], paralelo: ['IFCSWITCHINGDEVICE', '.TOGGLESWITCH.'], intermediario: ['IFCSWITCHINGDEVICE', '.TOGGLESWITCH.'],
      dimmer: ['IFCSWITCHINGDEVICE', '.DIMMERSWITCH.'], sensor: ['IFCSENSOR', '.MOVEMENTSENSOR.'], pulsador: ['IFCSWITCHINGDEVICE', '.MOMENTARYSWITCH.'],
      campainha: ['IFCALARM', '.BELL.'], qd: ['IFCELECTRICDISTRIBUTIONBOARD', '.DISTRIBUTIONBOARD.'], qm: ['IFCELECTRICDISTRIBUTIONBOARD', '.DISTRIBUTIONBOARD.'],
      es: ['IFCELECTRICDISTRIBUTIONBOARD', '.SWITCHBOARD.'], cp: ['IFCJUNCTIONBOX', '.POWER.'],
    };
    for (const e of pav.elementos) {
      const t = TIPOS[e.tipo];
      if (!t || e.tipo === 'pilar') continue;
      const c = CLASSE[e.tipo] || (t.disc === 'hid' ? (['reservatorio'].includes(e.tipo) ? ['IFCTANK', '.STORAGE.'] : e.tipo === 'ci' ? ['IFCDISTRIBUTIONCHAMBERELEMENT', '.INSPECTIONCHAMBER.'] : ['IFCSANITARYTERMINAL', '.NOTDEFINED.']) : null);
      if (!c) continue;
      const [cls, tipoPred] = c;
      const tam = t.quadro ? [0.5, 0.12, 0.6] : e.tipo === 'reservatorio' ? [1.2, 1.2, 1] : e.tipo === 'ci' ? [0.6, 0.6, 0.6] : t.disc === 'hid' ? [0.4, 0.4, 0.4] : e.tipo === 'luz' ? [0.3, 0.3, 0.06] : [0.1, 0.06, 0.1];
      const z = Math.max(0, (e.altura ?? 0) - (e.tipo === 'luz' ? tam[2] : tam[2] / 2));
      const circ = projeto.circuitos.find((ci) => ci.id === e.circuitoId);
      const nome = t.quadro && calc.nomeQuadro ? calc.nomeQuadro(e) : `${t.sigla}${circ ? ` ${circ.numero}` : ''}`;
      const o = E(`${cls}('${guid()}',${hist},${str(nome)},${str(t.nome)},$,${coloca(e.x, e.y, z)},${forma(caixa(tam[0], tam[1], tam[2]))},$,${tipoPred})`);
      props(o, 'Pset_Vertice', { Tipo: t.nome, Circuito: circ?.nome, 'Potência (VA)': t.carga ? Number(e.potencia) || 0 : null, Comando: e.comando || (e.comandos || []).join(',') || null, 'Altura (m)': e.altura });
      dentro.push(o);
      resumo.pontos++;
    }

    // eletrodutos (pelo forro ou pelo piso, como no modelo 3D)
    for (const sg of calc.ele?.segmentos || []) {
      if (sg.para.pav !== pav) continue;
      const a = sg.de, b = sg.para;
      const r = (sg.dn / 2) / 1000;
      const perf = perfilCirc(r);
      const z = (n) => n.z - pav.cota;
      let trechos;
      if (a.pav === b.pav) {
        const piso = sg.nivel === 'piso';
        const yc = piso ? 0.04 : pav.peDireito - 0.12;
        const zA = piso ? Math.max(z(a), yc) : Math.min(z(a), yc), zB = piso ? Math.max(z(b), yc) : Math.min(z(b), yc);
        trechos = [[[a.x, Y(a.y), zA], [a.x, Y(a.y), yc]], [[a.x, Y(a.y), yc], [b.x, Y(a.y), yc]], [[b.x, Y(a.y), yc], [b.x, Y(b.y), yc]], [[b.x, Y(b.y), yc], [b.x, Y(b.y), zB]]];
      } else {
        trechos = [[[a.x, Y(a.y), z(a)], [b.x, Y(a.y), z(a)]], [[b.x, Y(a.y), z(a)], [b.x, Y(b.y), z(b)]]];
      }
      const solidos = trechos.map(([p, q]) => barra(perf, p, q)).filter(Boolean);
      if (!solidos.length) continue;
      const shape = E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${E(`IFCSHAPEREPRESENTATION(${ctxBody},'Body','SweptSolid',(${solidos.join(',')}))`)}))`);
      const nums = [...sg.circuitos].map((cid) => projeto.circuitos.find((c) => c.id === cid)?.numero).filter(Boolean).sort((x, y) => x - y);
      const o = E(`IFCCABLECARRIERSEGMENT('${guid()}',${hist},${str(`Eletroduto DN${sg.dn}`)},${str(calc.ele.cfg?.material || 'Eletroduto')},$,${solto()},${shape},$,.CONDUITSEGMENT.)`);
      props(o, 'Pset_Vertice_Eletroduto', { 'DN (mm)': sg.dn, 'Comprimento (m)': Math.round(sg.comp * 100) / 100, Circuitos: nums.join(','), Condutores: `${sg.cont.F}F ${sg.cont.N}N ${sg.cont.T}T ${sg.cont.R}R`, 'Ocupação (%)': Math.round(sg.ocupacao * 100), Passagem: sg.nivel === 'piso' ? 'piso' : 'forro' });
      dentro.push(o);
      resumo.eletrodutos++;
    }

    // tubulações de água fria e esgoto
    const tubos = (segs, raioDe, nomeDe) => {
      for (const s of segs || []) {
        if (s.para.pav !== pav) continue;
        const z = (n) => n.z - pav.cota;
        const perf = perfilCirc(raioDe(s));
        const pts = [[s.de.x, Y(s.de.y), z(s.de)], [s.para.x, Y(s.de.y), z(s.de)], [s.para.x, Y(s.para.y), z(s.de)], [s.para.x, Y(s.para.y), z(s.para)]];
        const solidos = [];
        for (let i = 0; i + 1 < pts.length; i++) { const sl = barra(perf, pts[i], pts[i + 1]); if (sl) solidos.push(sl); }
        if (!solidos.length) continue;
        const shape = E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${E(`IFCSHAPEREPRESENTATION(${ctxBody},'Body','SweptSolid',(${solidos.join(',')}))`)}))`);
        dentro.push(E(`IFCPIPESEGMENT('${guid()}',${hist},${str(nomeDe(s))},$,$,${solto()},${shape},$,.RIGIDSEGMENT.)`));
        resumo.tubos++;
      }
    };
    tubos(calc.hid?.af?.segmentos, (s) => Math.max(0.01, s.de_mm / 2000), (s) => `Água fria Ø${s.de_mm}`);
    tubos(calc.hid?.esg?.segmentos, (s) => Math.max(0.02, s.dn / 2000), (s) => `Esgoto DN${s.dn}`);

    if (dentro.length) E(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',${hist},$,$,(${dentro.join(',')}),${st})`);
  }
  if (storeys.length) E(`IFCRELAGGREGATES('${guid()}',${hist},$,$,${bld},(${storeys.join(',')}))`);
  for (const [obj, set] of psets) E(`IFCRELDEFINESBYPROPERTIES('${guid()}',${hist},$,$,(${obj}),${set})`);

  const agora = new Date().toISOString().slice(0, 19);
  const cab = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');
FILE_NAME(${str((projeto.nome || 'projeto') + '.ifc')},'${agora}',(${str(autor || '')}),(${str(app)}),${str(app)},${str(app)},'');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
`;
  return { texto: `${cab}${linhas.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`, resumo };
}
