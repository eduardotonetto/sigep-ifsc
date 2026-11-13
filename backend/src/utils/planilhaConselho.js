const ApiError = require('./ApiError');

// Interpreta a planilha "Conselho de Classe" exportada do SIGAA: o bloco CURSO / ANO / PERÍODO seguido
// da tabela com uma linha por aluno e disciplina. Só lê e valida: nada aqui acessa o banco.

// O SIGAA exporta alguns acentos já corrompidos ("Infrequ�ncia", "COMUNICA��O"): o caractere original
// não existe mais no arquivo, então ele vale como curinga nas comparações.
const CARACTERE_ILEGIVEL = '�';

const OBRIGATORIA = 'Matrícula';

// Campo do registro -> título da coluna. As colunas são achadas pelo título, em qualquer ordem.
const COLUNAS = {
  fase: 'Período',
  matricula: OBRIGATORIA,
  nomeAluno: 'Nome discente',
  situacao: 'Situação',
  disciplinaCodigo: 'Código',
  disciplinaNome: 'Nome',
  nota: 'Nota',
  frequencia: 'Frequência Consolidada',
  infrequencia: 'Percentual de Infrequência (parcial)',
  anp: 'ANP - Não participação'
};

// "APS203902": sigla da disciplina, código do curso e fase em que ela é ofertada.
const CODIGO_DISCIPLINA = /^([A-Z]+)(\d{4})(\d{2})$/;

const SITUACAO_ATIVA = /^(ativo|formando|graduando)/;
const SITUACAO_INATIVA = /^(cancelad|conclu|defendid|desistent|evadid|excluid|falecid|formado|integralizad|jubilad|trancad|transferid)/;

const ocorrencia = (nivel) => (mensagem, linha) => ({ nivel, mensagem, linha });
const erro = ocorrencia('erro');
const conflito = ocorrencia('conflito');
const aviso = ocorrencia('aviso');

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mesmoTexto(a, b) {
  const [x, y] = [normalizar(a), normalizar(b)];
  if (x.length !== y.length) {
    return false;
  }
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] !== y[i] && x[i] !== CARACTERE_ILEGIVEL && y[i] !== CARACTERE_ILEGIVEL) {
      return false;
    }
  }
  return true;
}

// "-" é como o SIGAA escreve "ainda não lançado": é falta de informação, não zero.
const semValor = (texto) => /^(-+|–|—|n\/?a)?$/i.test(texto);

function paraNumero(texto) {
  return Number(texto.replace('%', '').replace(',', '.').trim());
}

const duasCasas = (valor) => Math.round(valor * 100) / 100;

function lerNota(texto, linha, ocorrencias) {
  if (semValor(texto)) {
    return null;
  }
  const nota = paraNumero(texto);
  if (Number.isNaN(nota) || nota < 0 || nota > 10) {
    ocorrencias.push(erro(`Nota "${texto}" inválida (esperado de 0 a 10): valor não importado`, linha));
    return null;
  }
  return duasCasas(nota);
}

function lerPercentual(texto, rotulo, linha, ocorrencias) {
  if (semValor(texto)) {
    return null;
  }
  const percentual = paraNumero(texto);
  if (Number.isNaN(percentual) || percentual < 0 || percentual > 100) {
    ocorrencias.push(erro(`${rotulo} "${texto}" inválida (esperado de 0% a 100%): valor não importado`, linha));
    return null;
  }
  return duasCasas(percentual);
}

// A infrequência parcial vale primeiro. A "consolidada" fica em 0% até o fechamento (inclusive para
// quem tem presença total), então 0% ali significa "ainda não consolidada", não 100% de faltas.
function lerInfrequencia(celulas, linha, ocorrencias) {
  const parcial = lerPercentual(celulas.infrequencia, 'Infrequência', linha, ocorrencias);
  if (parcial !== null) {
    return parcial;
  }
  const frequencia = lerPercentual(celulas.frequencia, 'Frequência', linha, ocorrencias);
  return frequencia ? duasCasas(100 - frequencia) : null;
}

function lerFase(texto, linha, ocorrencias) {
  if (semValor(texto)) {
    return null;
  }
  const fase = Number(texto);
  if (!Number.isInteger(fase) || fase < 1 || fase > 255) {
    ocorrencias.push(aviso(`Período "${texto}" inválido: a fase será deduzida da disciplina ou do aluno`, linha));
    return null;
  }
  return fase;
}

function lerStatus(situacao, situacoesDesconhecidas) {
  const texto = normalizar(situacao);
  if (SITUACAO_ATIVA.test(texto)) {
    return 'Ativo';
  }
  if (SITUACAO_INATIVA.test(texto)) {
    return 'Inativo';
  }
  if (texto && !semValor(texto)) {
    situacoesDesconhecidas.add(situacao);
  }
  return null;
}

// Texto acima do limite da coluna é tratado como informação ausente, em vez de ser cortado.
function limitado(texto, tamanho, rotulo, linha, ocorrencias) {
  if (texto.length <= tamanho) {
    return texto;
  }
  ocorrencias.push(erro(`${rotulo} com mais de ${tamanho} caracteres: valor não importado`, linha));
  return '';
}

function acharColunas(cabecalho, ocorrencias) {
  const indices = {};

  for (const [campo, titulo] of Object.entries(COLUNAS)) {
    indices[campo] = cabecalho.findIndex((celula) => mesmoTexto(celula, titulo));
    if (indices[campo] === -1) {
      ocorrencias.push(aviso(`Coluna "${titulo}" não encontrada: a informação dela não será importada`));
    }
  }
  return indices;
}

function lerMetadados(linhas) {
  const metadados = {};

  for (const [chave, valor] of linhas) {
    for (const campo of ['CURSO', 'ANO', 'PERÍODO']) {
      if (mesmoTexto(chave, campo) && valor?.trim()) {
        metadados[campo] = valor.trim();
      }
    }
  }
  return metadados;
}

// "NOME [2039]/LGS - Técnico - Subsequente - Lages - EAD" (tipo, grau, câmpus e modalidade).
function lerCurso(texto, ocorrencias) {
  if (!texto) {
    return {};
  }
  const [nomeEcodigo, ...partes] = texto.split(' - ').map((parte) => parte.trim());
  const [, nome = nomeEcodigo, codigo] = /^(.*?)\s*\[([^\]]+)\]/.exec(nomeEcodigo) ?? [];
  const [tipo, grau, , modalidade] = partes.length === 4 ? partes : [];
  const campo = (valor, tamanho, rotulo) => (valor && limitado(valor, tamanho, rotulo, undefined, ocorrencias)) || undefined;

  return {
    nome: campo(nome, 150, 'Nome do curso'),
    codigo: campo(codigo, 20, 'Código do curso'),
    tipo: campo(tipo, 50, 'Tipo do curso'),
    grau: campo(grau, 50, 'Grau do curso'),
    modalidade: campo(modalidade, 50, 'Modalidade do curso')
  };
}

function lerContexto(linhasAcima, registros, ocorrencias) {
  const metadados = lerMetadados(linhasAcima);
  const { ANO: ano, PERÍODO: semestre } = metadados;
  const curso = lerCurso(metadados.CURSO, ocorrencias);

  // Sem o bloco CURSO, o código do curso ainda pode vir do código das disciplinas.
  if (!curso.codigo) {
    const codigos = new Set(registros.map((r) => CODIGO_DISCIPLINA.exec(r.disciplinaCodigo)?.[2]).filter(Boolean));
    curso.codigo = codigos.size === 1 ? [...codigos][0] : undefined;
  }

  const faltando = [];
  if (!curso.codigo && !curso.nome) {
    faltando.push('Informe o curso na linha "CURSO" do início da planilha');
  }
  if (!/^\d{4}$/.test(ano ?? '')) {
    faltando.push('Informe o ano letivo na linha "ANO" do início da planilha');
  }
  if (!/^[12]$/.test(semestre ?? '')) {
    faltando.push('Informe o semestre (1 ou 2) na linha "PERÍODO" do início da planilha');
  }
  if (faltando.length > 0) {
    throw new ApiError(400, 'Não foi possível identificar a planilha', faltando);
  }

  return { curso, ano, semestre };
}

// Para um registro sem o "Período" da linha: vale a fase do código da disciplina ou, se o aluno
// aparecer em uma única fase nas outras linhas, essa fase.
function preencherFases(registros, ocorrencias) {
  const fasesDoAluno = new Map();

  for (const registro of registros) {
    registro.fase ??= registro.faseDisciplina;
    if (registro.fase) {
      if (!fasesDoAluno.has(registro.matricula)) fasesDoAluno.set(registro.matricula, new Set());
      fasesDoAluno.get(registro.matricula).add(registro.fase);
    }
  }

  for (const registro of registros) {
    const fases = fasesDoAluno.get(registro.matricula);
    if (!registro.fase && fases?.size === 1) {
      [registro.fase] = fases;
    }
    if (!registro.fase) {
      ocorrencias.push(erro(`Matrícula ${registro.matricula}: fase não identificada, sem turma para esta linha`, registro.linha));
    }
  }
}

// A mesma disciplina com nomes diferentes entre as linhas: vale o primeiro, e cada nome é apontado uma vez.
function apontarNomesDeDisciplina(registros, ocorrencias) {
  const primeiros = new Map();
  const apontados = new Set();

  for (const { disciplinaChave: chave, disciplinaCodigo: codigo, disciplinaNome: nome, linha } of registros) {
    if (!chave || !nome) {
      continue;
    }

    const primeiro = primeiros.get(chave);
    const marca = `${chave}|${normalizar(nome)}`;

    if (!primeiro) {
      primeiros.set(chave, { nome, linha });
    } else if (!mesmoTexto(primeiro.nome, nome) && !apontados.has(marca)) {
      apontados.add(marca);
      ocorrencias.push(
        conflito(`Disciplina ${codigo}: nomes diferentes nas linhas ${primeiro.linha} e ${linha} ("${primeiro.nome}" e "${nome}"). Vale o primeiro`, linha)
      );
    }
  }
}

// Duas linhas do mesmo aluno e disciplina viram uma: o valor que só uma delas tem é aproveitado.
// Valores diferentes não são escolhidos no escuro: ficam de fora e o que estiver no sistema é mantido.
function unirDuplicados(registros, ocorrencias) {
  const porChave = new Map();
  const divergentes = new Set();
  const unicos = [];

  for (const registro of registros) {
    const chave = `${registro.matricula}|${registro.disciplinaChave}`;
    const primeiro = porChave.get(chave);

    if (!registro.disciplinaChave || !primeiro) {
      if (registro.disciplinaChave) porChave.set(chave, registro);
      unicos.push(registro);
      continue;
    }

    primeiro.repetidas += 1;
    ocorrencias.push(
      aviso(`Matrícula ${registro.matricula} repetida na disciplina ${registro.disciplinaCodigo || registro.disciplinaNome}`, registro.linha)
    );

    for (const [campo, rotulo] of [['media', 'nota'], ['infrequencia', 'infrequência']]) {
      const marca = `${chave}|${campo}`;
      if (registro[campo] === null || divergentes.has(marca)) {
        continue;
      }
      if (primeiro[campo] === null) {
        primeiro[campo] = registro[campo];
      } else if (primeiro[campo] !== registro[campo]) {
        ocorrencias.push(
          conflito(
            `Matrícula ${registro.matricula}: ${rotulo} diferente nas linhas ${primeiro.linha} e ${registro.linha} (${primeiro[campo]} e ${registro[campo]}). Valor não importado`,
            registro.linha
          )
        );
        primeiro[campo] = null;
        divergentes.add(marca);
      }
    }
  }
  return unicos;
}

function agruparAlunos(registros, ocorrencias) {
  const alunos = new Map();

  for (const { matricula, nomeAluno, status, fase, linha } of registros) {
    if (!alunos.has(matricula)) {
      alunos.set(matricula, { matricula, nome: '', status: null, fases: new Set(), linha });
    }
    const aluno = alunos.get(matricula);

    if (nomeAluno && !aluno.nome) {
      aluno.nome = nomeAluno;
    } else if (nomeAluno && !aluno.nomeDivergente && !mesmoTexto(nomeAluno, aluno.nome)) {
      aluno.nomeDivergente = true;
      ocorrencias.push(conflito(`Matrícula ${matricula} com nomes diferentes: "${aluno.nome}" e "${nomeAluno}". Vale o primeiro`, linha));
    }

    if (status && aluno.status && status !== aluno.status) {
      aluno.statusDivergente = true;
    }
    aluno.status ??= status;
    if (fase) {
      aluno.fases.add(fase);
    }
  }

  for (const aluno of alunos.values()) {
    if (aluno.statusDivergente) {
      aluno.status = null;
      ocorrencias.push(conflito(`Matrícula ${aluno.matricula} com situações diferentes entre as linhas: situação não alterada`, aluno.linha));
    }
    if (aluno.fases.size > 1) {
      ocorrencias.push(aviso(`${aluno.nome || aluno.matricula} aparece nas fases ${[...aluno.fases].join(' e ')}: será matriculado nas duas turmas`, aluno.linha));
    }
  }

  return [...alunos.values()];
}

function lerRegistros(linhas, inicio, colunas, ocorrencias) {
  const registros = [];
  const situacoesDesconhecidas = new Set();
  let totalLinhas = 0;
  let comAnp = 0;

  for (let i = inicio; i < linhas.length; i += 1) {
    const linhaArquivo = i + 1;
    const celulas = Object.fromEntries(
      Object.entries(colunas).map(([campo, indice]) => [campo, (linhas[i][indice] ?? '').trim()])
    );

    if (linhas[i].every((celula) => !celula.trim())) {
      continue;
    }
    totalLinhas += 1;

    if (!/^\d{1,20}$/.test(celulas.matricula)) {
      const motivo = celulas.matricula ? `Matrícula "${celulas.matricula}" inválida` : 'Linha sem matrícula';
      ocorrencias.push(erro(`${motivo}: linha ignorada`, linhaArquivo));
      continue;
    }

    if (!semValor(celulas.anp)) {
      comAnp += 1;
    }

    const disciplinaCodigo = limitado(celulas.disciplinaCodigo.toUpperCase(), 20, 'Código da disciplina', linhaArquivo, ocorrencias);
    const disciplinaNome = limitado(celulas.disciplinaNome, 150, 'Nome da disciplina', linhaArquivo, ocorrencias);
    const [, sigla, , faseCodigo] = CODIGO_DISCIPLINA.exec(disciplinaCodigo) ?? [];

    const temColunaDisciplina = colunas.disciplinaCodigo !== -1 || colunas.disciplinaNome !== -1;
    if (temColunaDisciplina && !disciplinaCodigo && !disciplinaNome) {
      ocorrencias.push(erro('Linha sem disciplina: só o aluno será importado', linhaArquivo));
    }

    registros.push({
      linha: linhaArquivo,
      matricula: celulas.matricula,
      nomeAluno: limitado(celulas.nomeAluno, 150, 'Nome do aluno', linhaArquivo, ocorrencias),
      status: lerStatus(celulas.situacao, situacoesDesconhecidas),
      fase: lerFase(celulas.fase, linhaArquivo, ocorrencias),
      faseDisciplina: faseCodigo ? Number(faseCodigo) || null : null,
      disciplinaChave: normalizar(disciplinaCodigo || disciplinaNome),
      disciplinaCodigo,
      disciplinaNome,
      disciplinaSigla: sigla ?? null,
      media: lerNota(celulas.nota, linhaArquivo, ocorrencias),
      infrequencia: lerInfrequencia(celulas, linhaArquivo, ocorrencias),
      repetidas: 0
    });
  }

  for (const situacao of situacoesDesconhecidas) {
    ocorrencias.push(aviso(`Situação "${situacao}" desconhecida: o status dos alunos com ela não foi alterado`));
  }
  if (comAnp > 0) {
    ocorrencias.push(aviso(`${comAnp} linha(s) com "ANP - Não participação" preenchida: o sistema ainda não guarda essa informação`));
  }

  return { registros, totalLinhas };
}

// Rejeita a planilha só quando não há como saber o que ela é. Daí em diante cada problema vira uma
// ocorrência, e o restante das linhas segue.
function lerPlanilha(linhas) {
  const ocorrencias = [];
  const cabecalho = linhas.findIndex((linha) => linha.some((celula) => mesmoTexto(celula, OBRIGATORIA)));

  if (cabecalho === -1) {
    throw new ApiError(400, 'Planilha fora do modelo esperado', [
      `Coluna "${OBRIGATORIA}" não encontrada. Colunas esperadas: ${Object.values(COLUNAS).join(', ')}`
    ]);
  }

  const colunas = acharColunas(linhas[cabecalho], ocorrencias);
  const { registros, totalLinhas } = lerRegistros(linhas, cabecalho + 1, colunas, ocorrencias);

  if (registros.length === 0) {
    throw new ApiError(400, 'Nenhuma linha válida encontrada na planilha');
  }

  const contexto = lerContexto(linhas.slice(0, cabecalho), registros, ocorrencias);
  preencherFases(registros, ocorrencias);
  apontarNomesDeDisciplina(registros, ocorrencias);
  const unicos = unirDuplicados(registros, ocorrencias);

  return { contexto, totalLinhas, registros: unicos, alunos: agruparAlunos(unicos, ocorrencias), ocorrencias };
}

module.exports = {
  CARACTERE_ILEGIVEL,
  erro,
  conflito,
  aviso,
  normalizar,
  mesmoTexto,
  lerPlanilha
};
