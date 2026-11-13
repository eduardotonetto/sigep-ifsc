const { Router } = require('express');

const controller = require('../controllers/importacao.controller');
const { validateImportacao } = require('../validators/importacao.validator');

const router = Router();

router.post('/conselho/previa', validateImportacao, controller.previa);
router.post('/conselho', validateImportacao, controller.confirmar);

module.exports = router;
