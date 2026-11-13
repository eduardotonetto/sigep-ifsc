// Relatório da importação no terminal do backend: é o único lugar onde erros e conflitos aparecem.

const NIVEIS = [
  ['erro', 'NÃO IMPORTADO'],
  ['conflito', 'CONFLITOS'],
  ['aviso', 'AVISOS']
];

const ROTULOS_RESUMO = {
  periodos: 'Período letivo',
  cursos: 'Curso',
  alunos: 'Alunos',
  turmas: 'Turmas',
  matriculas: 'Matrículas',
  disciplinas: 'Disciplinas',
  diarios: 'Diários',
  notas: 'Notas e frequências'
};

const SEPARADOR = '='.repeat(70);

// Uma única chamada ao console: relatórios de importações simultâneas não se misturam.
function escrever(linhas) {
  console.log([SEPARADOR, ...linhas, SEPARADOR].join('\n'));
}

function linhasDoNivel(titulo, ocorrencias) {
  return [
    '',
    `${titulo} (${ocorrencias.length})`,
    ...ocorrencias.map(({ linha, mensagem }) => `  ${linha ? `L${linha}: ` : ''}${mensagem}`)
  ];
}

function montarRelatorio({ arquivo, simulacao, contexto, linhas, resumo, ocorrencias }) {
  const porLinha = [...ocorrencias].sort((a, b) => (a.linha ?? 0) - (b.linha ?? 0));

  return [
    `RELATÓRIO DE IMPORTAÇÃO - ${simulacao ? 'PRÉVIA (nada foi gravado)' : 'CONCLUÍDA'}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    `Arquivo: ${arquivo}`,
    `Curso: ${contexto.curso} | Período letivo: ${contexto.ano}.${contexto.semestre}`,
    `Linhas: ${linhas.importadas} de ${linhas.total} importadas, ${linhas.ignoradas} não importadas`,
    '',
    'RESUMO',
    ...Object.entries(ROTULOS_RESUMO).map(([campo, rotulo]) => {
      const { novos, atualizados, inalterados } = resumo[campo];
      return `  ${rotulo}: ${novos} novos, ${atualizados} alterados, ${inalterados} sem alteração`;
    }),
    ...NIVEIS.flatMap(([nivel, titulo]) =>
      linhasDoNivel(titulo, porLinha.filter((ocorrencia) => ocorrencia.nivel === nivel))
    )
  ];
}

// A importação já terminou: uma falha ao imprimir não pode virar erro nem parecer uma recusa.
function imprimirRelatorio(relatorio) {
  try {
    escrever(montarRelatorio(relatorio));
  } catch (error) {
    console.error('Falha ao imprimir o relatório da importação:', error);
  }
}

// O nome pode faltar: um corpo acima do limite é recusado antes de ser lido.
function imprimirRecusa(arquivo, falha) {
  escrever([
    'RELATÓRIO DE IMPORTAÇÃO - RECUSADA (nada foi gravado)',
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    `Arquivo: ${typeof arquivo === 'string' ? arquivo.slice(0, 255) : 'não identificado'}`,
    `Motivo: ${falha.message}`,
    ...(falha.details ?? []).map((detalhe) => `  ${detalhe}`)
  ]);
}

module.exports = {
  imprimirRelatorio,
  imprimirRecusa
};
