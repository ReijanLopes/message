import type { ChannelConnector } from "./channel-connector.js";

/**
 * Registro central de conectores. É o único ponto onde o núcleo "conhece"
 * quais canais existem — e mesmo assim só por `channelType` (string), nunca
 * por import direto de um conector específico dentro de api/ ou workers/.
 *
 * Adicionar um canal novo = implementar ChannelConnector + chamar
 * `registry.register(new MeuConnector())` no bootstrap. Nada mais muda.
 */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, ChannelConnector>();

  register(connector: ChannelConnector): void {
    if (this.connectors.has(connector.channelType)) {
      throw new Error(`Conector já registrado para o canal "${connector.channelType}"`);
    }
    this.connectors.set(connector.channelType, connector);
  }

  get(channelType: string): ChannelConnector {
    const connector = this.connectors.get(channelType);
    if (!connector) {
      throw new Error(`Nenhum conector registrado para o canal "${channelType}"`);
    }
    return connector;
  }

  has(channelType: string): boolean {
    return this.connectors.has(channelType);
  }

  list(): string[] {
    return [...this.connectors.keys()];
  }
}

export const connectorRegistry = new ConnectorRegistry();
