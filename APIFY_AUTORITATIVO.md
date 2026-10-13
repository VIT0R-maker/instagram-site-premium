# Conteúdo Apify autoritativo

A pedido do proprietário, o conteúdo comercial coletado pelo Apify é aceito como fonte autoritativa. `verified` é mantido por compatibilidade com os contratos e significa aceito da coleta, não checagem independente.

## Comportamento

- Retirados os bloqueios FACT_SOURCE, FACT_NORMALIZATION, FACT_SERVICE, WHATSAPP, BRAND_NAME e OFFER_UNKNOWN da preparação factual. O nome é copiado do perfil, sem rejeição.
- Cidades, contatos e múltiplos endereços não são descartados por diferenças de citação ou conflitos. As omissões locais anteriores foram removidas.
- Bio e fontes do perfil entram integralmente no briefing, também como claims determinísticos. As fontes não são mais cortadas em 6000 caracteres.
- Posts de colaboração retornados na coleta do perfil são preservados.
- Telefones locais geram tel:, WhatsApp pode usar o DDI configurado em defaultPhoneCountryCode (padrão 55; configure conforme o país dos clientes). Números são tratados inteiros, sem juntar fontes. Links de agendamento e redirecionamentos l.instagram.com são aproveitados.
- A copy recupera linhas da bio ausentes do resumo. Claude recebe authoritativeContent e liberdade para distribuir as informações pelo design.
- A auditoria verifica presença de linhas da bio e links do perfil no conteúdo HTML, não a verdade dos dados Apify. CSS/legibilidade ainda são responsabilidade da auditoria visual. Não há verificação externa de veracidade. Dados criados fora do material fornecido continuam fora do escopo editorial.
- Retomadas em curate recuperam profile/sources dos checkpoints Apify existentes, sem novo scrape para essa recuperação. As etapas posteriores ainda podem usar APIs normalmente, incluindo a expansão de coleta quando aplicável.
- Contratos JSON, segurança de execução, limites de recursos, qualidade visual e a única geração Claude são mantidos.

O conteúdo editorial inclui bio completa e dados comerciais. Metadados técnicos do scraper (IDs internos, URLs temporárias CDN etc.) continuam privados; fotos continuam sujeitas à curadoria visual, conforme o objetivo do projeto.

## Instalação no worker existente

Faça backup dos arquivos locais alterados. Traga os arquivos desta alteração, reconstrua worker e rode start.ps1. O workflow JSON não mudou; não precisa reimportá-lo. Registre o webhook conforme start.ps1 e retome o mesmo job que falhou em curate. Não apague volumes.

## Validação realizada

64 testes Node passaram, incluindo 7 testes específicos: dados/citações divergentes aceitos, múltiplas unidades, bio integral, contato/agendamento, links, cobertura de conteúdo, textos longos e retomada sem chamadas Apify/Claude (alguns agrupados no mesmo teste). Provedores e renderização são simulados nos testes de integração. Não executado job real nem chamadas pagas.

O check geral identificou uma divergência já existente entre o JSON n8n exportado e seu gerador (metadados/configurações de nós); o JSON do usuário foi preservado. Isso não impede os testes do worker. Não se declara execução completa no Docker/n8n do usuário.
