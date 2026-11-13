const ApiError = require('../utils/ApiError');
const { imprimirRecusa } = require('../utils/relatorioImportacao');

// Erros do body-parser, que acontecem antes das rotas.
const MOTIVOS = {
  'entity.too.large': 'Arquivo acima do limite de 4 MB',
  'entity.parse.failed': 'JSON inválido'
};

// Toda recusa da importação passa por aqui: o motivo fica só no terminal do backend. O 401 segue
// intacto, porque a tela depende dele para encerrar a sessão expirada.
function recusaImportacao(err, req, res, next) {
  if (err.statusCode === 401) {
    return next(err);
  }

  imprimirRecusa(req.body?.arquivo, { message: MOTIVOS[err.type] ?? err.message, details: err.details });

  const status = err.statusCode ?? err.status;
  if (status >= 400 && status < 500) {
    return next(new ApiError(status, 'A planilha não foi importada. Veja o relatório no terminal do backend'));
  }
  next(err);
}

module.exports = recusaImportacao;
