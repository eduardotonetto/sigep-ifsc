const withTransaction = require('../utils/transaction');
const ApiError = require('../utils/ApiError');
const { isDuplicateEntry } = require('../utils/dbErrors');
const {
  CARACTERE_ILEGIVEL,
  erro,
  conflito,
  aviso,
  normalizar,
  mesmoTexto,
  lerPlanilha
} = require('../utils/planilhaConselho');

// Regras da importação da planilha do conselho:
// - o aluno é identificado pela matrícula; curso e disciplina, pelo código e depois pelo nome;
// - o que falta no cadastro é preenchido, mas o que já existe não é sobrescrito: a divergência vira
//   uma ocorrência no relatório (notas e frequências são a exceção: o SIGAA é a fonte delas);
// - "sem valor" na planilha nunca apaga um dado que já está no sistema;
// - consultas e gravações são em lote: o banco de produção (TiDB Cloud) é remoto e a função da
//   Vercel tem tempo limitado, então nada aqui faz uma consulta por linha da planilha.

const TAMANHO_LOTE = 1000;

function lotes(itens) {
  const resultado = [];
  for (let i = 0; i < itens.length; i += TAMANHO_LOTE) {
    resultado.push(itens.slice(i, i + TAMANHO_LOTE));
  }
  return resultado;
}

async function inserirEmLotes(connection, sql, valores) {
  for (const lote of lotes(valores)) {
    await connection.query(sql, [lote]);
  }
}

// O "IN (?)" recebe a lista por último, depois dos demais parâmetros.
async function selecionarEmLotes(connection, sql, lista, parametros = []) {
  const linhas = [];
  for (const lote of lotes(lista)) {
    const [resultado] = await connection.query(sql, [...parametros, lote]);
    linhas.push(...resultado);
  }
  return linhas;
}

const faseOferta = (fase) => (fase ? `${fase}ª Fase` : null);

const temTextoIlegivel = (texto) => texto.includes(CARACTERE_ILEGIVEL);

function novoRelatorio({ contexto, totalLinhas, ocorrencias }, arquivo, simulacao) {
  const contagem = () => ({ novos: 0, atualizados: 0, inalterados: 0 });

  return {
    arquivo,
    simulacao,
    contexto: { curso: contexto.curso.nome ?? contexto.curso.codigo, ano: contexto.ano, semestre: contexto.semestre },
    linhas: { total: totalLinhas, importadas: 0, ignoradas: totalLinhas },
    resumo: {
      periodos: contagem(),
      cursos: contagem(),
      alunos: contagem(),
      disciplinas: contagem(),
      turmas: contagem(),
      diarios: contagem(),
      matriculas: contagem(),
      notas: { ...contagem(), semDados: 0, mantidos: 0 }
    },
    ocorrencias
  };
}

async function resolverPeriodo(connection, { ano, semestre }, { resumo }) {
  const [[periodo]] = await connection.query('SELECT id FROM periodos WHERE ano = ? AND semestre = ?', [ano, semestre]);

  if (periodo) {
    resumo.periodos.inalterados += 1;
    return periodo;
  }

  // O período ativo é escolha do usuário: o criado aqui fica inativo.
  const [resultado] = await connection.query('INSERT INTO periodos (ano, semestre, ativo) VALUES (?, ?, 0)', [ano, semestre]);
  resumo.periodos.novos += 1;
  return { id: resultado.insertId };
}

async function resolverCurso(connection, dados, { resumo, ocorrencias }) {
  const [cursos] = await connection.query('SELECT id, codigo, nome, tipo, grau, modalidade, fases FROM cursos');
  const porCodigo = dados.codigo && cursos.find((curso) => normalizar(curso.codigo) === normalizar(dados.codigo));
  const porNome = dados.nome && cursos.find((curso) => mesmoTexto(curso.nome, dados.nome));
  const curso = porCodigo ?? porNome;

  if (!curso) {
    if (!dados.codigo || !dados.nome) {
      throw new ApiError(400, 'Não foi possível identificar a planilha', [
        `Curso "${dados.nome ?? dados.codigo}" não cadastrado, e a planilha não traz o código e o nome para criá-lo`
      ]);
    }
    const [resultado] = await connection.query(
      'INSERT INTO cursos (codigo, nome, tipo, grau, modalidade) VALUES (?, ?, ?, ?, ?)',
      [dados.codigo, dados.nome, dados.tipo ?? null, dados.grau ?? null, dados.modalidade ?? null]
    );
    resumo.cursos.novos += 1;
    ocorrencias.push(aviso(`Curso "${dados.nome}" criado sem o número de fases e sem coordenador: complete em Cadastros`));
    return { id: resultado.insertId, ...dados, fases: null };
  }

  if (dados.codigo && normalizar(curso.codigo) !== normalizar(dados.codigo)) {
    ocorrencias.push(conflito(`Curso "${curso.nome}": código "${curso.codigo}" no sistema e "${dados.codigo}" na planilha. Mantido o do sistema`));
  }
  if (dados.nome && !mesmoTexto(curso.nome, dados.nome)) {
    ocorrencias.push(conflito(`Curso ${curso.codigo}: nome "${curso.nome}" no sistema e "${dados.nome}" na planilha. Mantido o do sistema`));
  }

  const preencher = {};
  for (const [campo, rotulo] of [['tipo', 'tipo'], ['grau', 'grau'], ['modalidade', 'modalidade']]) {
    if (dados[campo] && !curso[campo]) {
      preencher[campo] = dados[campo];
    } else if (dados[campo] && !mesmoTexto(curso[campo], dados[campo])) {
      ocorrencias.push(conflito(`Curso "${curso.nome}": ${rotulo} "${curso[campo]}" no sistema e "${dados[campo]}" na planilha. Mantido o do sistema`));
    }
  }

  if (Object.keys(preencher).length > 0) {
    await connection.query('UPDATE cursos SET ? WHERE id = ?', [preencher, curso.id]);
    resumo.cursos.atualizados += 1;
  } else {
    resumo.cursos.inalterados += 1;
  }
  return curso;
}

async function criarDisciplina(connection, dados, curso) {
  const fase = faseOferta(dados.faseDisciplina ?? dados.fase);
  const [resultado] = await connection.query(
    'INSERT INTO disciplinas (codigo, sigla, nome, fase_oferta, curso_id) VALUES (?, ?, ?, ?, ?)',
    [dados.disciplinaCodigo, dados.disciplinaSigla, dados.disciplinaNome, fase, curso.id]
  );
  return {
    id: resultado.insertId,
    codigo: dados.disciplinaCodigo,
    sigla: dados.disciplinaSigla,
    nome: dados.disciplinaNome,
    fase_oferta: fase,
    curso_id: curso.id,
    nova: true
  };
}

// Completa o que falta e registra o que diverge; devolve se algo foi alterado.
async function conciliarDisciplina(connection, disciplina, dados, ocorrencias) {
  const { disciplinaCodigo: codigo, disciplinaNome: nome, disciplinaSigla: sigla, linha } = dados;
  const preencher = {};

  if (codigo && normalizar(disciplina.codigo) !== normalizar(codigo)) {
    ocorrencias.push(conflito(`Disciplina "${disciplina.nome}": código "${disciplina.codigo}" no sistema e "${codigo}" na planilha. Mantido o do sistema`, linha));
  }

  if (nome && temTextoIlegivel(disciplina.nome) && !temTextoIlegivel(nome)) {
    preencher.nome = nome;
    ocorrencias.push(aviso(`Disciplina ${disciplina.codigo}: nome com caracteres ilegíveis corrigido para "${nome}"`, linha));
  } else if (nome && !mesmoTexto(disciplina.nome, nome)) {
    ocorrencias.push(conflito(`Disciplina ${disciplina.codigo}: nome "${disciplina.nome}" no sistema e "${nome}" na planilha. Mantido o do sistema`, linha));
  }

  if (sigla && !disciplina.sigla) {
    preencher.sigla = sigla;
  }
  if (!disciplina.fase_oferta && (dados.faseDisciplina ?? dados.fase)) {
    preencher.fase_oferta = faseOferta(dados.faseDisciplina ?? dados.fase);
  }

  if (Object.keys(preencher).length === 0) {
    return false;
  }
  await connection.query('UPDATE disciplinas SET ? WHERE id = ?', [preencher, disciplina.id]);
  return true;
}

// Devolve as disciplinas por chave do registro. Disciplina que não pôde ser resolvida fica de fora,
// e as linhas dela não geram nota.
async function resolverDisciplinas(connection, registros, curso, { resumo, ocorrencias }) {
  const distintas = new Map();
  for (const registro of registros) {
    if (registro.disciplinaChave && !distintas.has(registro.disciplinaChave)) {
      distintas.set(registro.disciplinaChave, registro);
    }
  }

  const codigos = [...distintas.values()].map((dados) => dados.disciplinaCodigo).filter(Boolean);
  const [existentes] = await connection.query(
    'SELECT id, codigo, sigla, nome, fase_oferta, curso_id FROM disciplinas WHERE curso_id = ? OR codigo IN (?)',
    [curso.id, codigos.length > 0 ? codigos : ['']]
  );

  const disciplinas = new Map();

  for (const [chave, dados] of distintas) {
    const { disciplinaCodigo: codigo, disciplinaNome: nome, linha } = dados;
    const porCodigo = codigo && existentes.find((disciplina) => normalizar(disciplina.codigo) === normalizar(codigo));

    if (porCodigo && porCodigo.curso_id !== curso.id) {
      ocorrencias.push(erro(`Código ${codigo} já pertence à disciplina "${porCodigo.nome}" de outro curso: linhas dela não importadas`, linha));
      continue;
    }

    const disciplina =
      porCodigo ||
      (nome && existentes.find((item) => item.curso_id === curso.id && mesmoTexto(item.nome, nome)));

    // O curso não aceita duas disciplinas de mesmo nome: a segunda vira a que acabou de ser criada.
    if (disciplina?.nova) {
      if (codigo) {
        ocorrencias.push(conflito(`Disciplina "${disciplina.nome}" com os códigos ${disciplina.codigo} e ${codigo} na planilha: o curso não aceita nomes repetidos. Linhas lançadas em ${disciplina.codigo}`, linha));
      }
      disciplinas.set(chave, disciplina);
    } else if (disciplina) {
      const alterada = await conciliarDisciplina(connection, disciplina, dados, ocorrencias);
      resumo.disciplinas[alterada ? 'atualizados' : 'inalterados'] += 1;
      disciplinas.set(chave, disciplina);
    } else if (!codigo || !nome) {
      ocorrencias.push(erro(`Disciplina "${codigo || nome}" não cadastrada, e a planilha não traz código e nome para criá-la: linhas dela não importadas`, linha));
    } else {
      const nova = await criarDisciplina(connection, dados, curso);
      existentes.push(nova);
      disciplinas.set(chave, nova);
      resumo.disciplinas.novos += 1;
      if (temTextoIlegivel(nome)) {
        ocorrencias.push(aviso(`Disciplina ${codigo}: o nome veio do SIGAA com caracteres ilegíveis ("${nome}"). Corrija em Cadastros`, linha));
      }
    }
  }
  return disciplinas;
}

// Preenche aluno.id. Aluno novo sem nome não pode ser criado e fica sem id: as linhas dele são ignoradas.
async function resolverAlunos(connection, alunos, { resumo, ocorrencias }) {
  const buscar = () => selecionarEmLotes(
    connection,
    'SELECT id, matricula, nome, status FROM alunos WHERE matricula IN (?)',
    alunos.map((aluno) => aluno.matricula)
  );

  const existentes = new Map((await buscar()).map((aluno) => [aluno.matricula, aluno]));
  const novos = [];
  const statusNovo = { Ativo: [], Inativo: [] };

  for (const aluno of alunos) {
    const existente = existentes.get(aluno.matricula);

    if (!existente) {
      if (aluno.nome) {
        novos.push([aluno.matricula, aluno.nome, aluno.status ?? 'Ativo']);
        resumo.alunos.novos += 1;
        if (temTextoIlegivel(aluno.nome)) {
          ocorrencias.push(aviso(`Matrícula ${aluno.matricula}: o nome veio do SIGAA com caracteres ilegíveis ("${aluno.nome}"). Corrija em Cadastros`, aluno.linha));
        }
      } else {
        ocorrencias.push(erro(`Matrícula ${aluno.matricula} não cadastrada e sem nome na planilha: linhas ignoradas`, aluno.linha));
      }
      continue;
    }

    let alterado = false;

    if (aluno.nome && temTextoIlegivel(existente.nome) && !temTextoIlegivel(aluno.nome)) {
      await connection.query('UPDATE alunos SET nome = ? WHERE id = ?', [aluno.nome, existente.id]);
      alterado = true;
    } else if (aluno.nome && !mesmoTexto(existente.nome, aluno.nome)) {
      ocorrencias.push(conflito(`Matrícula ${aluno.matricula}: "${existente.nome}" no sistema e "${aluno.nome}" na planilha. Mantido o nome do sistema; confira se a matrícula é mesmo desse aluno`, aluno.linha));
    }

    if (aluno.status && aluno.status !== existente.status) {
      statusNovo[aluno.status].push(existente.id);
      ocorrencias.push(aviso(`${existente.nome}: status alterado de ${existente.status} para ${aluno.status}`, aluno.linha));
      alterado = true;
    }
    resumo.alunos[alterado ? 'atualizados' : 'inalterados'] += 1;
  }

  await inserirEmLotes(connection, 'INSERT INTO alunos (matricula, nome, status) VALUES ?', novos);
  for (const [status, ids] of Object.entries(statusNovo)) {
    for (const lote of lotes(ids)) {
      await connection.query('UPDATE alunos SET status = ? WHERE id IN (?)', [status, lote]);
    }
  }

  // O id dos novos só vem da releitura: em lote, o TiDB não garante ids consecutivos.
  const ids = new Map((await buscar()).map((aluno) => [aluno.matricula, aluno.id]));
  for (const aluno of alunos) {
    aluno.id = ids.get(aluno.matricula);
  }
}

async function criarTurma(connection, curso, periodo, fase, turmasDoPeriodo) {
  const base = `${curso.nome.slice(0, 85)} - ${fase}ª Fase`;
  // O nome é único por período, mesmo entre cursos diferentes.
  const nome = turmasDoPeriodo.some((turma) => mesmoTexto(turma.nome, base)) ? `${base} (${curso.codigo})` : base;

  const [resultado] = await connection.query(
    'INSERT INTO turmas (nome, curso_id, periodo_id, fase) VALUES (?, ?, ?, ?)',
    [nome, curso.id, periodo.id, fase]
  );
  return { id: resultado.insertId, nome, curso_id: curso.id, fase };
}

// A planilha não traz turma: ela é deduzida do curso, período e fase. Com mais de uma turma assim,
// vale aquela em que o aluno já está matriculado; sem isso não há como escolher.
async function resolverTurmas(connection, alunos, curso, periodo, { resumo, ocorrencias }) {
  const [turmas] = await connection.query('SELECT id, nome, curso_id, fase FROM turmas WHERE periodo_id = ?', [periodo.id]);
  const vinculos = await selecionarEmLotes(
    connection,
    `SELECT m.id, m.aluno_id, m.turma_id, m.status
     FROM matriculas m
     JOIN turmas t ON t.id = m.turma_id
     WHERE t.curso_id = ? AND t.periodo_id = ? AND m.aluno_id IN (?)`,
    alunos.map((aluno) => aluno.id),
    [curso.id, periodo.id]
  );

  const turmasUsadas = new Set();
  const fasesForaDoCurso = new Set();
  const usadasNovas = new Set();

  for (const aluno of alunos) {
    aluno.turmas = new Map();

    for (const fase of aluno.fases) {
      const candidatas = turmas.filter((turma) => turma.curso_id === curso.id && turma.fase === fase);
      let turma = candidatas[0];

      if (candidatas.length > 1) {
        turma = candidatas.find((candidata) =>
          vinculos.some((vinculo) => vinculo.aluno_id === aluno.id && vinculo.turma_id === candidata.id)
        );
        if (!turma) {
          ocorrencias.push(erro(`${aluno.nome || aluno.matricula}: há ${candidatas.length} turmas na ${fase}ª fase e o aluno não está em nenhuma. Matricule-o e importe de novo`, aluno.linha));
          continue;
        }
      }

      if (!turma) {
        turma = await criarTurma(connection, curso, periodo, fase, turmas);
        turmas.push(turma);
        usadasNovas.add(turma.id);
      }

      if (curso.fases && fase > curso.fases && !fasesForaDoCurso.has(fase)) {
        fasesForaDoCurso.add(fase);
        ocorrencias.push(conflito(`A planilha traz a ${fase}ª fase, mas o curso tem ${curso.fases} fases cadastradas. Turma importada mesmo assim`, aluno.linha));
      }

      turmasUsadas.add(turma);
      aluno.turmas.set(fase, turma);
    }
  }

  resumo.turmas.novos = usadasNovas.size;
  resumo.turmas.inalterados = turmasUsadas.size - usadasNovas.size;
  return { turmasUsadas: [...turmasUsadas], vinculos };
}

async function resolverMatriculas(connection, alunos, vinculos, { resumo, ocorrencias }) {
  const atuais = new Map(vinculos.map((vinculo) => [`${vinculo.aluno_id}|${vinculo.turma_id}`, vinculo]));
  const novas = [];
  const mudarStatus = { Ativo: [], Inativo: [] };

  for (const aluno of alunos) {
    for (const turma of aluno.turmas.values()) {
      const vinculo = atuais.get(`${aluno.id}|${turma.id}`);
      const status = aluno.status ?? vinculo?.status ?? 'Ativo';

      if (!vinculo) {
        novas.push([aluno.id, turma.id, status]);
        resumo.matriculas.novos += 1;
      } else if (vinculo.status !== status) {
        mudarStatus[status].push(vinculo.id);
        resumo.matriculas.atualizados += 1;
        if (status === 'Ativo') {
          ocorrencias.push(aviso(`${aluno.nome || aluno.matricula}: matrícula reativada na turma ${turma.nome}`, aluno.linha));
        }
      } else {
        resumo.matriculas.inalterados += 1;
      }
    }

    // A planilha não diz que o aluno saiu de outra turma: a matrícula fica como está.
    const destino = new Set([...aluno.turmas.values()].map((turma) => turma.id));
    if (destino.size > 0 && vinculos.some((v) => v.aluno_id === aluno.id && v.status === 'Ativo' && !destino.has(v.turma_id))) {
      ocorrencias.push(aviso(`${aluno.nome || aluno.matricula} segue ativo em outra turma deste curso e período`, aluno.linha));
    }
  }

  await inserirEmLotes(connection, 'INSERT INTO matriculas (aluno_id, turma_id, status) VALUES ?', novas);
  for (const [status, ids] of Object.entries(mudarStatus)) {
    for (const lote of lotes(ids)) {
      await connection.query('UPDATE matriculas SET status = ? WHERE id IN (?)', [status, lote]);
    }
  }

  const turmaIds = [...new Set(alunos.flatMap((aluno) => [...aluno.turmas.values()].map((turma) => turma.id)))];
  if (turmaIds.length === 0) {
    return new Map();
  }

  const linhas = await selecionarEmLotes(
    connection,
    'SELECT id, aluno_id, turma_id FROM matriculas WHERE turma_id IN (?) AND aluno_id IN (?)',
    alunos.map((aluno) => aluno.id),
    [turmaIds]
  );
  return new Map(linhas.map((linha) => [`${linha.aluno_id}|${linha.turma_id}`, linha.id]));
}

// O diário é a disciplina na turma. Criado aqui ele fica sem professor: a planilha não informa.
async function resolverDiarios(connection, pares, { ano, semestre }, { resumo, ocorrencias }) {
  const turmaIds = [...new Set(pares.map(({ turma }) => turma.id))];
  const [existentes] = await connection.query(
    'SELECT id, codigo, disciplina_id, turma_id FROM diarios WHERE turma_id IN (?) ORDER BY id',
    [turmaIds]
  );

  const diarios = new Map();

  for (const { disciplina, turma } of pares) {
    const chave = `${disciplina.id}|${turma.id}`;
    const encontrados = existentes.filter((diario) => diario.disciplina_id === disciplina.id && diario.turma_id === turma.id);

    if (encontrados.length > 0) {
      resumo.diarios.inalterados += 1;
      diarios.set(chave, encontrados[0].id);
      if (encontrados.length > 1) {
        ocorrencias.push(aviso(`Há ${encontrados.length} diários de "${disciplina.nome}" na turma ${turma.nome}: notas lançadas no ${encontrados[0].codigo}`));
      }
      continue;
    }

    const codigo = `${disciplina.codigo.slice(0, 14)}-${ano}.${semestre}-T${turma.id}`;
    const [resultado] = await connection.query(
      'INSERT INTO diarios (codigo, disciplina_id, turma_id) VALUES (?, ?, ?)',
      [codigo, disciplina.id, turma.id]
    );
    resumo.diarios.novos += 1;
    diarios.set(chave, resultado.insertId);
  }
  return diarios;
}

// Monta os lançamentos que têm todos os vínculos resolvidos; o restante conta como linha ignorada.
function montarLancamentos(registros, alunosPorMatricula, disciplinas, matriculas) {
  const lancamentos = [];

  for (const registro of registros) {
    const aluno = alunosPorMatricula.get(registro.matricula);
    const turma = aluno.turmas.get(registro.fase);
    const disciplina = disciplinas.get(registro.disciplinaChave);
    const matriculaId = aluno.id && turma && matriculas.get(`${aluno.id}|${turma.id}`);

    if (matriculaId && disciplina) {
      lancamentos.push({ registro, aluno, disciplina, turma, matriculaId });
    }
  }
  return lancamentos;
}

async function gravarNotas(connection, lancamentos, diarios, relatorio) {
  const { resumo, ocorrencias } = relatorio;
  const existentes = await selecionarEmLotes(
    connection,
    'SELECT matricula_id, diario_id, media, infrequencia FROM notas_frequencias WHERE matricula_id IN (?)',
    [...new Set(lancamentos.map(({ matriculaId }) => matriculaId))]
  );
  const atuais = new Map(existentes.map((nota) => [`${nota.matricula_id}|${nota.diario_id}`, nota]));
  const gravar = [];
  const lancados = new Set();
  let importadas = 0;

  for (const { registro, aluno, disciplina, turma, matriculaId } of lancamentos) {
    const diarioId = diarios.get(`${disciplina.id}|${turma.id}`);
    const chave = `${matriculaId}|${diarioId}`;
    const atual = atuais.get(chave);

    // Códigos diferentes podem levar à mesma disciplina: uma linha não sobrescreve a outra no escuro.
    if (lancados.has(chave)) {
      ocorrencias.push(conflito(`${aluno.nome || aluno.matricula} já tem lançamento de "${disciplina.nome}" em outra linha: esta linha não foi importada`, registro.linha));
      continue;
    }
    lancados.add(chave);
    importadas += 1 + registro.repetidas;

    if (registro.media === null && registro.infrequencia === null) {
      resumo.notas.semDados += 1;
    }

    if (!atual) {
      gravar.push([matriculaId, diarioId, registro.media, registro.infrequencia]);
      resumo.notas.novos += 1;
      continue;
    }

    const media = registro.media ?? atual.media;
    const infrequencia = registro.infrequencia ?? atual.infrequencia;

    if (
      (registro.media === null && atual.media !== null) ||
      (registro.infrequencia === null && atual.infrequencia !== null)
    ) {
      resumo.notas.mantidos += 1;
    }

    if (media === atual.media && infrequencia === atual.infrequencia) {
      resumo.notas.inalterados += 1;
      continue;
    }

    gravar.push([matriculaId, diarioId, media, infrequencia]);
    resumo.notas.atualizados += 1;

    for (const [rotulo, anterior, novo, sufixo] of [
      ['nota', atual.media, media, ''],
      ['infrequência', atual.infrequencia, infrequencia, '%']
    ]) {
      if (anterior !== null && anterior !== novo) {
        ocorrencias.push(
          conflito(`${aluno.nome || aluno.matricula} em "${disciplina.nome}": ${rotulo} ${anterior}${sufixo} no sistema substituída por ${novo}${sufixo}`, registro.linha)
        );
      }
    }
  }

  await inserirEmLotes(
    connection,
    `INSERT INTO notas_frequencias (matricula_id, diario_id, media, infrequencia) VALUES ?
     ON DUPLICATE KEY UPDATE media = VALUES(media), infrequencia = VALUES(infrequencia)`,
    gravar
  );

  relatorio.linhas.importadas = importadas;
  relatorio.linhas.ignoradas = relatorio.linhas.total - importadas;
  if (resumo.notas.mantidos > 0) {
    ocorrencias.push(aviso(`${resumo.notas.mantidos} registro(s) sem valor na planilha mantiveram a nota ou a frequência do sistema`));
  }
}

async function atualizarTurmas(connection, turmas, alunos, { ocorrencias }) {
  const turmaIds = turmas.map((turma) => turma.id);

  await connection.query(
    `UPDATE turmas t
     SET alunos_qtd = (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'Ativo')
     WHERE t.id IN (?)`,
    [turmaIds]
  );

  const [ausentes] = await connection.query(
    `SELECT t.nome, COUNT(*) AS quantidade
     FROM matriculas m
     JOIN turmas t ON t.id = m.turma_id
     WHERE m.status = 'Ativo' AND m.turma_id IN (?) AND m.aluno_id NOT IN (?)
     GROUP BY t.id, t.nome`,
    [turmaIds, alunos.map((aluno) => aluno.id)]
  );

  for (const { nome, quantidade } of ausentes) {
    ocorrencias.push(aviso(`${quantidade} aluno(s) ativo(s) da turma ${nome} não constam da planilha: matrículas mantidas`));
  }
}

async function aplicar(connection, planilha, relatorio) {
  const { contexto, registros } = planilha;

  const periodo = await resolverPeriodo(connection, contexto, relatorio);
  const curso = await resolverCurso(connection, contexto.curso, relatorio);
  const disciplinas = await resolverDisciplinas(connection, registros, curso, relatorio);

  await resolverAlunos(connection, planilha.alunos, relatorio);
  const alunos = planilha.alunos.filter((aluno) => aluno.id);
  for (const aluno of planilha.alunos) {
    aluno.turmas ??= new Map();
  }
  if (alunos.length === 0) {
    return;
  }

  const { turmasUsadas, vinculos } = await resolverTurmas(connection, alunos, curso, periodo, relatorio);
  const matriculas = await resolverMatriculas(connection, alunos, vinculos, relatorio);

  const alunosPorMatricula = new Map(planilha.alunos.map((aluno) => [aluno.matricula, aluno]));
  const lancamentos = montarLancamentos(registros, alunosPorMatricula, disciplinas, matriculas);

  if (lancamentos.length > 0) {
    const pares = new Map(lancamentos.map(({ disciplina, turma }) => [`${disciplina.id}|${turma.id}`, { disciplina, turma }]));
    const diarios = await resolverDiarios(connection, [...pares.values()], contexto, relatorio);
    await gravarNotas(connection, lancamentos, diarios, relatorio);
  }

  if (turmasUsadas.length > 0) {
    await atualizarTurmas(connection, turmasUsadas, alunos, relatorio);
  }
}

// Com `simular`, executa tudo e desfaz no final: a prévia mostra exatamente o que a importação faria,
// pelo mesmo caminho de código. A confirmação relê a planilha e aplica de uma vez só (tudo ou nada).
async function importarConselho({ linhas, arquivo }, { simular }) {
  const planilha = lerPlanilha(linhas);
  const relatorio = novoRelatorio(planilha, arquivo, simular);

  try {
    await withTransaction(async (connection) => {
      await aplicar(connection, planilha, relatorio);
      if (simular) {
        await connection.rollback();
      }
    });
  } catch (error) {
    if (isDuplicateEntry(error)) {
      throw new ApiError(409, 'Registro duplicado durante a importação. Tente novamente', [error.sqlMessage]);
    }
    throw error;
  }

  return relatorio;
}

module.exports = {
  importarConselho
};
