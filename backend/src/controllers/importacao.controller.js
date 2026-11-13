const importacaoModel = require('../models/importacao.model');
const asyncHandler = require('../utils/asyncHandler');
const { registrarLog } = require('../utils/auditoria');
const { imprimirRelatorio } = require('../utils/relatorioImportacao');

// Erros e conflitos ficam só no terminal do backend: as ocorrências não vão na resposta.
// As recusas são tratadas em middlewares/recusaImportacao.js.
async function importar(req, simular) {
  const relatorio = await importacaoModel.importarConselho(req.body, { simular });
  imprimirRelatorio(relatorio);
  return { ...relatorio, ocorrencias: undefined };
}

// Só relata o que a importação faria: nada é gravado.
const previa = asyncHandler(async (req, res) => {
  const relatorio = await importar(req, true);
  res.json({ success: true, data: relatorio });
});

// O log guarda quem importou e os totais, não o conteúdo da planilha (notas de alunos).
const confirmar = asyncHandler(async (req, res) => {
  const relatorio = await importar(req, false);
  const { arquivo, contexto, linhas, resumo } = relatorio;

  await registrarLog(req, {
    acao: 'IMPORTAR',
    tabela: 'importacoes',
    registroId: 'conselho',
    novos: { arquivo, contexto, linhas, resumo }
  });
  res.json({ success: true, data: relatorio });
});

module.exports = {
  previa,
  confirmar
};
