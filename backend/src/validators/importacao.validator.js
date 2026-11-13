const ApiError = require('../utils/ApiError');
const { isNonEmptyString } = require('./rules');

const MAX_LINHAS = 50000;

const BYTES_POR_MB = 1024 * 1024;

// O navegador lê o arquivo e envia só as células, como texto: a interpretação é feita no backend.
// Arquivo em outro formato ou acima do limite chega só com o nome (e o tamanho), para ser recusado aqui.
function validateImportacao(req, res, next) {
  const { arquivo, linhas, tamanho } = req.body;
  const errors = [];

  if (!isNonEmptyString(arquivo, 255)) {
    errors.push('arquivo é obrigatório e deve ter no máximo 255 caracteres');
  } else if (!arquivo.toLowerCase().endsWith('.csv')) {
    return next(new ApiError(400, 'Formato inválido', ['Envie a planilha em .csv (no Excel: Salvar como > CSV)']));
  }

  if (Number.isFinite(tamanho)) {
    return next(new ApiError(413, `Arquivo de ${(tamanho / BYTES_POR_MB).toFixed(1)} MB acima do limite de 4 MB`));
  }

  const isMatriz =
    Array.isArray(linhas) &&
    linhas.every((linha) => Array.isArray(linha) && linha.every((celula) => typeof celula === 'string'));

  if (!isMatriz || linhas.length === 0) {
    errors.push('linhas é obrigatório e deve ser uma lista de linhas com células em texto');
  } else if (linhas.length > MAX_LINHAS) {
    errors.push(`A planilha deve ter no máximo ${MAX_LINHAS} linhas`);
  }

  if (errors.length > 0) {
    return next(new ApiError(400, 'Dados inválidos', errors));
  }

  next();
}

module.exports = {
  validateImportacao
};
