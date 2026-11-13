export interface PlanilhaLida {
  arquivo: string;
  linhas: string[][];
}

const isCsv = (nomeArquivo: string) => nomeArquivo.toLowerCase().endsWith(".csv");

// O SIGAA exporta em UTF-8; salvo pelo Excel, o mesmo CSV vira Windows-1252.
function decodificar(dados: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(dados);
  } catch {
    return new TextDecoder("windows-1252").decode(dados);
  }
}

function contarForaDeAspas(linha: string, separador: string): number {
  let total = 0;
  let entreAspas = false;
  for (const caractere of linha) {
    if (caractere === '"') entreAspas = !entreAspas;
    else if (caractere === separador && !entreAspas) total++;
  }
  return total;
}

// O Excel em português separa as colunas com ";" (a vírgula é o separador decimal). A primeira linha
// pode ser um título ou estar vazia, então vale a linha com mais separadores entre as primeiras.
function detectarSeparador(texto: string): string {
  const linhas = texto.split("\n", 50);
  const maximo = (separador: string) => Math.max(...linhas.map((linha) => contarForaDeAspas(linha, separador)));
  return maximo(";") > maximo(",") ? ";" : ",";
}

function lerCsv(texto: string): string[][] {
  const separador = detectarSeparador(texto);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const caractere = texto[i];

    if (entreAspas) {
      if (caractere === '"' && texto[i + 1] === '"') {
        celula += '"';
        i++;
      } else if (caractere === '"') {
        entreAspas = false;
      } else {
        celula += caractere;
      }
    } else if (caractere === '"') {
      entreAspas = true;
    } else if (caractere === separador) {
      linha.push(celula);
      celula = "";
    } else if (caractere === "\n") {
      linhas.push([...linha, celula.replace(/\r$/, "")]);
      linha = [];
      celula = "";
    } else {
      celula += caractere;
    }
  }

  if (celula || linha.length > 0) {
    linhas.push([...linha, celula]);
  }
  return linhas;
}

// Outros formatos não são lidos: vão só com o nome, e o backend recusa e registra o motivo no relatório.
export async function lerPlanilha(arquivo: File): Promise<PlanilhaLida> {
  if (!isCsv(arquivo.name)) return { arquivo: arquivo.name, linhas: [] };

  const dados = await arquivo.arrayBuffer();
  return { arquivo: arquivo.name, linhas: lerCsv(decodificar(dados)) };
}
