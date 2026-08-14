import { connectorRegistry } from "../core/connector-registry.js";

/**
 * Ponto único de registro de conectores. Adicionar um canal novo = importar
 * a classe do conector aqui e chamar `connectorRegistry.register(...)`.
 * Nenhum outro arquivo do núcleo precisa mudar.
 *
 * Vazio por enquanto — o MockConnector entra no próximo bloco.
 */
export function registerConnectors(): void {
  void connectorRegistry;
}
