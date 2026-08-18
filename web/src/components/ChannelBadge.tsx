// Cor determinística por channelType: canais novos ganham uma cor da
// paleta automaticamente, sem precisar tocar neste arquivo.
const PALETTE = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be185d"];

function colorFor(channelType: string): string {
  let hash = 0;
  for (let i = 0; i < channelType.length; i++) {
    hash = (hash * 31 + channelType.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length]!;
}

export function ChannelBadge({ channelType }: { channelType: string }) {
  return (
    <span className="channel-badge" style={{ backgroundColor: colorFor(channelType) }}>
      {channelType}
    </span>
  );
}
